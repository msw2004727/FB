// /api/npcRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIChatResponse, getAIGiveItemResponse, getAINarrativeForGive, getAISummary, getAISuggestion } = require('../services/aiService');
const { getFriendlinessLevel, getInventoryState, updateInventory, invalidateNovelCache, updateLibraryNovel, getMergedNpcProfile, getRawInventory } = require('./gameHelpers');

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

// --- 新增的程式碼開始 ---
// 獲取交易初始化數據的路由
router.get('/start-trade/:npcName', async (req, res) => {
    const userId = req.user.id;
    const { npcName } = req.params;

    try {
        // 並行獲取玩家背包和NPC資料
        const [playerInventory, npcProfile] = await Promise.all([
            getRawInventory(userId),
            getMergedNpcProfile(userId, npcName)
        ]);

        if (!npcProfile) {
            return res.status(404).json({ message: '找不到交易對象。' });
        }

        // 從玩家背包中分離出銀兩
        let playerMoney = 0;
        const playerItems = {};
        for (const [key, item] of Object.entries(playerInventory)) {
            if (item.templateId === '銀兩') {
                playerMoney = item.quantity || 0;
            } else {
                playerItems[key] = item;
            }
        }

        // 從NPC背包中分離出銀兩
        let npcMoney = 0;
        const npcItems = {};
        if (npcProfile.inventory) {
            for (const [key, item] of Object.entries(npcProfile.inventory)) {
                if (key === '銀兩') {
                    npcMoney = item || 0;
                } else {
                    // 這裡假設NPC庫存中儲存的是物品名稱和數量
                    // 我們需要獲取物品的完整模板資訊
                    const itemTemplate = await db.collection('items').doc(key).get();
                    if(itemTemplate.exists) {
                        npcItems[key] = {
                            ...itemTemplate.data(),
                            quantity: item
                        };
                    }
                }
            }
        }

        const tradeData = {
            player: {
                money: playerMoney,
                items: playerItems
            },
            npc: {
                name: npcProfile.name,
                money: npcMoney,
                items: npcItems,
                personality: npcProfile.personality, // 為動態定價做準備
                goals: npcProfile.goals // 為動態定價做準備
            }
        };

        res.json(tradeData);

    } catch (error) {
        console.error(`[交易系統] /start-trade/${npcName} 錯誤:`, error);
        res.status(500).json({ message: '開啟交易時發生內部錯誤。' });
    }
});
// --- 新增的程式碼結束 ---


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

// 處理贈予物品的路由
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
        
        if (friendlinessChange > 0) {
            const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);
            const itemKey = type === 'money' ? '銀兩' : itemName;
            const quantityToAdd = type === 'money' ? amount : (amount || 1);
            
            const fieldPath = `inventory.${itemKey}`;
            const updatePayload = {
                [fieldPath]: admin.firestore.FieldValue.increment(quantityToAdd)
            };

            updatePromises.push(npcStateRef.set(updatePayload, { merge: true }));
            
            const itemToRemove = {
                action: 'remove',
                itemName: itemKey,
                quantity: quantityToAdd
            };
            updatePromises.push(updateInventory(userId, [itemToRemove]));
        }
        
        if(friendlinessChange) {
            const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);
            updatePromises.push(npcStateRef.set({ 
                friendlinessValue: admin.firestore.FieldValue.increment(friendlinessChange) 
            }, { merge: true }));
        }
        
        let giftNarrative = "";
        if (itemChanges && itemChanges.length > 0) {
            updatePromises.push(updateInventory(userId, itemChanges));

            itemChanges.forEach(gift => {
                giftNarrative += ` 你收到了來自${npcName}的回禮：${gift.itemName}。`;
            });
        }
        
        await Promise.all(updatePromises);
        
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
            getAISummary(longTermSummary, newRoundData),
            getAISuggestion(newRoundData)
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
