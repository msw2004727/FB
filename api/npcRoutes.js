// /api/npcRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIChatResponse, getAIGiveItemResponse, getAINarrativeForGive, getAISummary, getAISuggestion } = require('../services/aiService');
const { getFriendlinessLevel, getInventoryState, updateInventory, invalidateNovelCache, updateLibraryNovel, getMergedNpcProfile } = require('./gameHelpers');

const db = admin.firestore();

// 獲取NPC公開資料的路由
router.get('/npc-profile/:npcName', async (req, res) => {
    const userId = req.user.id;
    const { npcName } = req.params;
    try {
        const npcProfile = await getMergedNpcProfile(userId, npcName);

        if (!npcProfile) {
            return res.status(404).json({ message: '找不到該人物的檔案。' });
        }
        
        const latestSaveSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get();
        if (latestSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到玩家位置資訊。' });
        }
        const playerLocation = latestSaveSnapshot.docs[0].data().LOC[0];

        if (playerLocation !== npcProfile.currentLocation) {
            return res.status(403).json({ message: `你環顧四周，並未見到 ${npcName} 的身影。` });
        }

        const publicProfile = {
            name: npcProfile.name,
            appearance: npcProfile.appearance,
            friendliness: getFriendlinessLevel(npcProfile.friendlinessValue || 0),
            romanceValue: npcProfile.romanceValue || 0,
            friendlinessValue: npcProfile.friendlinessValue || 0
        };

        res.json(publicProfile);

    } catch (error) {
        console.error(`[NPC路由] /npc-profile/${npcName} 錯誤:`, error);
        res.status(500).json({ message: '讀取人物檔案時發生內部錯誤。' });
    }
});

// 處理NPC聊天的路由
router.post('/npc-chat', async (req, res) => {
    const userId = req.user.id;
    const { npcName, chatHistory, playerMessage, model = 'gemini' } = req.body;
    try {
        const [npcProfile, summaryDoc, allLocationsSnapshot] = await Promise.all([
            getMergedNpcProfile(userId, npcName),
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

// 【核心修改】處理贈予物品的路由
router.post('/give-item', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const { giveData, model = 'gemini' } = req.body;
    const { target: npcName, itemName, amount, type } = giveData;

    try {
        const [playerProfile, npcProfile, latestSaveSnapshot, summaryDoc] = await Promise.all([
            db.collection('users').doc(userId).get().then(doc => doc.data()),
            getMergedNpcProfile(userId, npcName),
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
        
        const updatePromises = [];
        
        // --- 新增的程式碼開始 ---
        // 只有在友好度為正向變化時，才將物品真正給予NPC
        if (friendlinessChange > 0) {
            const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);
            const itemKey = type === 'money' ? '銀兩' : itemName;
            const quantityToAdd = type === 'money' ? amount : (amount || 1);
            
            // 使用點記法來安全地更新或增加 inventory 中的物品數量
            const fieldPath = `inventory.${itemKey}`;
            const updatePayload = {
                [fieldPath]: admin.firestore.FieldValue.increment(quantityToAdd)
            };

            // 將更新NPC庫存的操作加入異步隊列
            updatePromises.push(npcStateRef.set(updatePayload, { merge: true }));
            
            // 同時，從玩家背包中移除對應的物品
            const itemToRemove = {
                action: 'remove',
                itemName: itemKey,
                quantity: quantityToAdd
            };
            updatePromises.push(updateInventory(userId, [itemToRemove]));
        }
        // --- 新增的程式碼結束 ---
        
        // 更新友好度
        if(friendlinessChange) {
            updatePromises.push(updateFriendlinessValues(userId, [{ name: npcName, friendlinessChange }]));
        }
        
        // 處理NPC的回禮
        let giftNarrative = "";
        if (itemChanges && itemChanges.length > 0) {
            // 將回禮物品加入玩家背包
            updatePromises.push(updateInventory(userId, itemChanges));

            itemChanges.forEach(gift => {
                giftNarrative += ` 你收到了來自${npcName}的回禮：${gift.itemName}。`;
            });
        }
        
        // 等待所有資料庫操作完成
        await Promise.all(updatePromises);
        
        // 構造新的回合數據
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
        
        const baseNarrative = await getAINarrativeForGive(lastRoundData, username, npcName, itemName || `${amount}文錢`, npc_response);
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
