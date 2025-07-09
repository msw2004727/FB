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

// 獲取交易初始化數據的路由
router.get('/start-trade/:npcName', async (req, res) => {
    const userId = req.user.id;
    const { npcName } = req.params;

    try {
        const [playerInventory, npcProfile] = await Promise.all([
            getRawInventory(userId),
            getMergedNpcProfile(userId, npcName)
        ]);

        if (!npcProfile) {
            return res.status(404).json({ message: '找不到交易對象。' });
        }

        let playerMoney = 0;
        const playerItems = {};
        for (const [key, item] of Object.entries(playerInventory)) {
            if (item.templateId === '銀兩') {
                playerMoney = item.quantity || 0;
            } else {
                playerItems[key] = item;
            }
        }

        let npcMoney = 0;
        const npcItems = {};
        if (npcProfile.inventory) {
            for (const [key, itemData] of Object.entries(npcProfile.inventory)) {
                 if (key === '銀兩') {
                    npcMoney = itemData || 0;
                } else {
                    const itemTemplate = await db.collection('items').doc(key).get();
                    if(itemTemplate.exists) {
                        npcItems[key] = {
                            ...itemTemplate.data(),
                            quantity: itemData
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
                personality: npcProfile.personality,
                goals: npcProfile.goals
            }
        };

        res.json(tradeData);

    } catch (error) {
        console.error(`[交易系統] /start-trade/${npcName} 錯誤:`, error);
        res.status(500).json({ message: '開啟交易時發生內部錯誤。' });
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
            updatePromises.push(updateInventory(userId, [itemToRemove], lastRoundData));
        }
        
        if(friendlinessChange) {
            const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);
             updatePromises.push(npcStateRef.set({ 
                friendlinessValue: admin.firestore.FieldValue.increment(friendlinessChange) 
            }, { merge: true }));
        }
        
        let giftNarrative = "";
        if (itemChanges && itemChanges.length > 0) {
            updatePromises.push(updateInventory(userId, itemChanges, lastRoundData));

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

// --- 【核心新增】確認並執行交易的路由 ---
router.post('/confirm-trade', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const { tradeState, npcName } = req.body;

    if (!tradeState || !npcName) {
        return res.status(400).json({ message: '交易數據不完整。' });
    }

    const playerInventoryRef = db.collection('users').doc(userId).collection('inventory_items');
    const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);
    
    try {
        // 使用資料庫事務來保證數據一致性
        await db.runTransaction(async (transaction) => {
            
            // 處理玩家給出的物品
            const playerItemChanges = [];
            for (const item of tradeState.player.offer.items) {
                playerItemChanges.push({ action: 'remove', itemName: item.name, quantity: item.quantity || 1 });
            }
            // 處理NPC給出的物品
            for (const item of tradeState.npc.offer.items) {
                playerItemChanges.push({ action: 'add', itemName: item.name, quantity: item.quantity || 1 });
            }

            // 一次性更新玩家庫存
            if (playerItemChanges.length > 0) {
                 await updateInventory(userId, playerItemChanges, {});
            }
        });

        console.log(`[交易系統] 玩家 ${username} 與 ${npcName} 的交易成功完成。`);

        // 交易成功後，產生新的回合數據
        const lastSaveSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const lastRoundData = lastSaveSnapshot.docs[0].data();
        const newRoundNumber = lastRoundData.R + 1;

        const inventoryState = await getInventoryState(userId);

        const finalRoundData = {
            ...lastRoundData,
            R: newRoundNumber,
            story: `你與${npcName}完成了一筆公平的交易，雙方各取所需，皆大歡喜。`,
            PC: '完成了一筆交易。',
            EVT: `與${npcName}交易`,
            ITM: inventoryState.itemsString,
            money: inventoryState.money,
        };

        await db.collection('users').doc(userId).collection('game_saves').doc(`R${newRoundNumber}`).set(finalRoundData);
        await invalidateNovelCache(userId);

        res.json({
            message: '交易成功！',
            newRound: {
                story: finalRoundData.story,
                roundData: finalRoundData,
                suggestion: "江湖之大，何處不可去得？"
            }
        });

    } catch (error) {
        console.error(`[交易系統] /confirm-trade 錯誤:`, error);
        res.status(500).json({ message: '交易過程中發生意外，交換失敗。' });
    }
});
// --- 新增的程式碼結束 ---

module.exports = router;
