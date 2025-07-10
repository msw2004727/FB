// /api/npcRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIChatResponse, getAIGiveItemResponse, getAINarrativeForGive, getAISummary, getAISuggestion } = require('../services/aiService');
const { getFriendlinessLevel, getInventoryState, updateInventory, invalidateNovelCache, updateLibraryNovel, getMergedNpcProfile, getRawInventory, getOrGenerateItemTemplate } = require('./gameHelpers');

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

        const playerItems = Object.values(playerInventory);

        // --- 【核心修改】重寫NPC物品處理邏輯 ---
        const npcItems = [];
        if (npcProfile.inventory && typeof npcProfile.inventory === 'object') {
            const itemPromises = Object.entries(npcProfile.inventory).map(async ([itemName, quantity]) => {
                const itemTemplate = await getOrGenerateItemTemplate(itemName);
                if (itemTemplate && itemTemplate.template) {
                     const itemData = {
                        ...itemTemplate.template,
                        quantity: quantity,
                        instanceId: itemName, // 使用物品名作為唯一ID
                        templateId: itemName,
                        itemName: itemName
                    };
                    // 如果不是可堆疊的，則拆分成多個
                    if (!itemTemplate.template.stackable && quantity > 1) {
                        return Array(quantity).fill(null).map((_, i) => ({
                            ...itemData,
                            quantity: 1,
                            instanceId: `${itemName}_${i}` // 給每個實例一個唯一的ID
                        }));
                    }
                    return itemData;
                }
                return null;
            });

            const resolvedItems = (await Promise.all(itemPromises)).flat().filter(item => item !== null);
            npcItems.push(...resolvedItems);
        }
        
        const tradeData = {
            player: {
                items: playerItems,
                money: playerInventory.銀兩 ? playerInventory.銀兩.quantity : 0
            },
            npc: {
                name: npcProfile.name,
                items: npcItems, 
                money: npcProfile.inventory && npcProfile.inventory.銀兩 ? npcProfile.inventory.銀兩 : 0,
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
        const [npcProfile, summaryDoc, allNpcsSnapshot] = await Promise.all([
            getMergedNpcProfile(userId, npcName),
            db.collection('users').doc(userId).collection('game_state').doc('summary').get(),
            db.collection('npcs').get()
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
        
        let mentionedNpcContext = null;
        const knownNpcNames = allNpcsSnapshot.docs.map(doc => doc.id);
        
        for (const knownName of knownNpcNames) {
            if (playerMessage.includes(knownName) && knownName !== npcName) {
                mentionedNpcContext = await getMergedNpcProfile(userId, knownName);
                if (mentionedNpcContext) {
                    console.log(`[情報網系統] 偵測到玩家詢問關於NPC「${knownName}」的情報。`);
                    break; 
                }
            }
        }

        const aiReply = await getAIChatResponse(model, npcProfile, chatHistory, playerMessage, longTermSummary, localLocationContext, mentionedNpcContext);
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
    
    try {
        await db.runTransaction(async (transaction) => {
            const playerInventoryRef = db.collection('users').doc(userId).collection('inventory_items');
            const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);

            const handleItems = async (items, owner) => {
                for (const item of items) {
                    const docRef = owner === 'player' ? playerInventoryRef.doc(item.id) : null;
                    const doc = docRef ? await transaction.get(docRef) : null;
                    
                    if (owner === 'player') {
                        // 從玩家移除
                        if (doc && doc.exists) {
                            const currentQty = doc.data().quantity || 0;
                            if (currentQty > item.quantity) {
                                transaction.update(docRef, { quantity: admin.firestore.FieldValue.increment(-item.quantity) });
                            } else {
                                transaction.delete(docRef);
                            }
                        }
                         // 添加到NPC
                        const npcFieldPath = `inventory.${item.name}`;
                        transaction.set(npcStateRef, { [npcFieldPath]: admin.firestore.FieldValue.increment(item.quantity) }, { merge: true });

                    } else { // NPC -> Player
                        // 從NPC移除
                        const npcFieldPath = `inventory.${item.name}`;
                        transaction.set(npcStateRef, { [npcFieldPath]: admin.firestore.FieldValue.increment(-item.quantity) }, { merge: true });
                        // 添加到玩家
                        await updateInventory(userId, [{ action: 'add', itemName: item.name, quantity: item.quantity }], {});
                    }
                }
            };

            await handleItems(tradeState.player.offer.items, 'player');
            await handleItems(tradeState.npc.offer.items, 'npc');
        });

        console.log(`[交易系統] 玩家 ${username} 與 ${npcName} 的交易成功完成。`);

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

module.exports = router;
