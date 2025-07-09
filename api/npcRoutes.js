// /api/npcRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIChatResponse, getAIGiveItemResponse, getAINarrativeForGive, getAISummary, getAISuggestion } = require('../services/aiService');
// 【核心修改】引入 getMergedNpcProfile
const { getFriendlinessLevel, getInventoryState, updateInventory, invalidateNovelCache, updateLibraryNovel, getMergedNpcProfile } = require('./gameHelpers');

const db = admin.firestore();

// 【核心重構】獲取NPC公開資料的路由
router.get('/npc-profile/:npcName', async (req, res) => {
    const userId = req.user.id;
    const { npcName } = req.params;
    try {
        // 使用新的輔助函式獲取合併後的完整NPC資料
        const npcProfile = await getMergedNpcProfile(userId, npcName);

        if (!npcProfile) {
            return res.status(404).json({ message: '找不到該人物的檔案。' });
        }
        
        // 檢查玩家與NPC是否在同一地點
        const latestSaveSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get();
        if (latestSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到玩家位置資訊。' });
        }
        const playerLocation = latestSaveSnapshot.docs[0].data().LOC[0];

        if (playerLocation !== npcProfile.currentLocation) {
            return res.status(403).json({ message: `你環顧四周，並未見到 ${npcName} 的身影。` });
        }

        // 回傳給前端的公開資料
        const publicProfile = {
            name: npcProfile.name,
            appearance: npcProfile.appearance,
            friendliness: getFriendlinessLevel(npcProfile.friendlinessValue || 0), // 動態計算友好度等級
            romanceValue: npcProfile.romanceValue || 0,
            friendlinessValue: npcProfile.friendlinessValue || 0
        };

        res.json(publicProfile);

    } catch (error) {
        console.error(`[NPC路由] /npc-profile/${npcName} 錯誤:`, error);
        res.status(500).json({ message: '讀取人物檔案時發生內部錯誤。' });
    }
});

// 【核心重構】處理NPC聊天的路由
router.post('/npc-chat', async (req, res) => {
    const userId = req.user.id;
    const { npcName, chatHistory, playerMessage, model = 'gemini' } = req.body;
    try {
        const [npcProfile, summaryDoc, allLocationsSnapshot] = await Promise.all([
            getMergedNpcProfile(userId, npcName), // 使用新函式獲取NPC資料
            db.collection('users').doc(userId).collection('game_state').doc('summary').get(),
            db.collection('locations').get()
        ]);

        if (!npcProfile) {
            return res.status(404).json({ message: '對話目標不存在。' });
        }
        
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : '江湖事，無人知。';

        let localLocationContext = null;
        if (npcProfile.currentLocation) {
            const locationDoc = await db.collection('locations').doc(npcProfile.currentLocation).get();
            if (locationDoc.exists) {
                localLocationContext = locationDoc.data();
            }
        }
        
        let remoteLocationContext = null;
        const knownLocationNames = allLocationsSnapshot.docs.map(doc => doc.id);
        
        for (const locName of knownLocationNames) {
            if (playerMessage.includes(locName) && locName !== npcProfile.currentLocation) {
                const remoteLocationDoc = await db.collection('locations').doc(locName).get();
                if (remoteLocationDoc.exists) {
                    remoteLocationContext = remoteLocationDoc.data();
                    console.log(`[情報網系統] 偵測到外地詢問: ${locName}`);
                    break;
                }
            }
        }

        const aiReply = await getAIChatResponse(model, npcProfile, chatHistory, playerMessage, longTermSummary, localLocationContext, remoteLocationContext);
        res.json({ reply: aiReply });
    } catch (error) {
        console.error(`[NPC路由] /npc-chat 錯誤:`, error);
        res.status(500).json({ message: '與人物交談時發生內部錯誤。' });
    }
});

// 【核心重構】處理贈予物品的路由
router.post('/give-item', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const { giveData, model = 'gemini' } = req.body;
    const { target: npcName, itemName, amount, type } = giveData;

    try {
        const [playerProfile, npcProfile, latestSaveSnapshot, summaryDoc] = await Promise.all([
            db.collection('users').doc(userId).get().then(doc => doc.data()),
            getMergedNpcProfile(userId, npcName), // 使用新函式獲取NPC資料
            db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get(),
            db.collection('users').doc(userId).collection('game_state').doc('summary').get()
        ]);

        if (!playerProfile || !npcProfile || latestSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到玩家、NPC或遊戲存檔。' });
        }
        
        let lastRoundData = latestSaveSnapshot.docs[0].data();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";

        const aiResponse = await getAIGiveItemResponse(model, playerProfile, npcProfile, giveData);
        if (!aiResponse) throw new Error('AI未能生成有效的贈予反應。');
        
        const { npc_response, friendlinessChange, itemChanges } = aiResponse;
        
        // 更新友好度
        if(friendlinessChange) {
            await updateFriendlinessValues(userId, [{ name: npcName, friendlinessChange }]);
        }
        
        const itemNameToRemove = type === 'money' ? '銀兩' : itemName;
        const quantityToRemove = type === 'money' ? amount : (amount || 1);
        
        const inventoryUpdates = [{ action: 'remove', itemName: itemNameToRemove, quantity: quantityToRemove }];
        
        let giftNarrative = "";
        if (itemChanges && itemChanges.length > 0) {
            itemChanges.forEach(gift => {
                inventoryUpdates.push(gift);
                giftNarrative += ` 你收到了來自${npcName}的回禮：${gift.itemName}。`;
            });
        }
        
        await updateInventory(userId, inventoryUpdates);
        
        const newRoundNumber = lastRoundData.R + 1;
        const inventoryState = await getInventoryState(userId);
        
        let newRoundData = { ...lastRoundData };
        newRoundData.R = newRoundNumber;
        newRoundData.ITM = inventoryState.itemsString;
        newRoundData.money = inventoryState.money;
        newRoundData.PC = `${username}將${itemName || amount + '文錢'}贈予了${npcName}。`;
        newRoundData.EVT = `贈予${npcName}物品`;
        
        const updatedNpcProfile = await getMergedNpcProfile(userId, npcName);
        const npcIndex = newRoundData.NPC.findIndex(n => n.name === npcName);
        if (npcIndex > -1) {
            newRoundData.NPC[npcIndex].friendliness = getFriendlinessLevel(updatedNpcProfile.friendlinessValue);
            newRoundData.NPC[npcIndex].status = npc_response;
        } else {
            newRoundData.NPC.push({ name: npcName, status: npc_response, friendliness: getFriendlinessLevel(updatedNpcProfile.friendlinessValue) });
        }
        
        const baseNarrative = await getAINarrativeForGive(model, lastRoundData, username, npcName, itemName || `${amount}文錢`, npc_response);
        newRoundData.story = baseNarrative + giftNarrative;
        
        const [newSummary, suggestion] = await Promise.all([
            getAISummary(model, longTermSummary, newRoundData),
            getAISuggestion(model, newRoundData)
        ]);

        newRoundData.suggestion = suggestion;
        
        await db.collection('users').doc(userId).collection('game_saves').doc(`R${newRoundNumber}`).set(newRoundData);
        await db.collection('users').doc(userId).collection('game_state').doc('summary').set({ text: newSummary, lastUpdated: newRoundNumber });
        
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗:", err));

        res.json({
            story: newRoundData.story,
            roundData: newRoundData,
            suggestion: newRoundData.suggestion
        });

    } catch (error) {
        console.error(`[贈予系統] 贈予NPC(${npcName})物品時出錯:`, error);
        res.status(500).json({ message: '贈予物品時發生內部錯誤。' });
    }
});


module.exports = router;
