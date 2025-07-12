// /api/npcRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIChatResponse, getAIGiveItemResponse, getAINarrativeForGive, getAIChatSummary, getAISuggestion, getAISummary, getAIPerNpcSummary } = require('../services/aiService');
const { getMergedNpcProfile, getFriendlinessLevel, updateNpcMemoryAfterInteraction } = require('./npcHelpers');
const { getRawInventory, getInventoryState, updateInventory, getOrGenerateItemTemplate } = require('./playerStateHelpers');
const { invalidateNovelCache, updateLibraryNovel } = require('./worldStateHelpers');
const { getKnownNpcNames } = require('./cacheManager');

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

        // 【位置檢查】
        if (playerLocation !== npcProfile.currentLocation) {
            return res.status(403).json({ message: `你環顧四周，並未見到 ${npcName} 的身影。` });
        }

        const publicProfile = {
            name: npcProfile.name,
            appearance: npcProfile.appearance,
            friendliness: getFriendlinessLevel(npcProfile.friendlinessValue || 0),
            romanceValue: npcProfile.romanceValue || 0,
            friendlinessValue: npcProfile.friendlinessValue || 0,
            age: npcProfile.age || '年齡不詳'
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
        const [playerInventory, npcProfile, latestSaveSnapshot] = await Promise.all([
            getRawInventory(userId),
            getMergedNpcProfile(userId, npcName),
            db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get()
        ]);

        if (!npcProfile) {
            return res.status(404).json({ message: '找不到交易對象。' });
        }
        
        if (latestSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到玩家位置資訊，無法開啟交易。' });
        }
        const playerLocation = latestSaveSnapshot.docs[0].data().LOC[0];
        if (playerLocation !== npcProfile.currentLocation) {
            return res.status(403).json({ message: `你必須和 ${npcName} 在同一個地方才能與其交易。` });
        }

        const playerItems = Object.values(playerInventory);
        
        const npcItems = [];
        if (npcProfile.inventory && typeof npcProfile.inventory === 'object') {
            const itemPromises = Object.entries(npcProfile.inventory).map(async ([itemName, quantity]) => {
                if (quantity > 0 && itemName !== '銀兩') {
                    const itemTemplateResult = await getOrGenerateItemTemplate(itemName);
                    if (itemTemplateResult && itemTemplateResult.template) {
                        const itemData = {
                            ...itemTemplateResult.template,
                            quantity: quantity,
                            instanceId: itemName,
                            templateId: itemName,
                            itemName: itemName
                        };
                        if (itemTemplateResult.template.itemType !== '材料' && itemTemplateResult.template.itemType !== '道具' && quantity > 1) {
                             return Array(quantity).fill(null).map((_, i) => ({
                                ...itemData,
                                quantity: 1,
                                instanceId: `${itemName}_${Date.now()}_${i}`
                            }));
                        }
                        return itemData;
                    }
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
        const [npcProfile, summaryDoc] = await Promise.all([
            getMergedNpcProfile(userId, npcName),
            db.collection('users').doc(userId).collection('game_state').doc('summary').get(),
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
        const knownNpcNames = getKnownNpcNames();
        
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
        
        await updateNpcMemoryAfterInteraction(userId, npcName, `你贈予了我「${itemName || amount + '文錢'}」，我的反應是：「${npc_response}」。`);
        
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

// 【核心修正】確認並執行交易的路由 (重構版)
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
            const playerMoneyRef = playerInventoryRef.doc('銀兩');

            // --- 處理金錢交換 ---
            const playerMoneyOffer = tradeState.player.offer.money || 0;
            const npcMoneyOffer = tradeState.npc.offer.money || 0;
            
            // 驗證玩家是否有足夠的錢
            if (playerMoneyOffer > 0) {
                 const playerMoneyDoc = await transaction.get(playerMoneyRef);
                 if (!playerMoneyDoc.exists || (playerMoneyDoc.data().quantity || 0) < playerMoneyOffer) {
                     throw new Error('你的錢不夠！');
                 }
            }

            // 更新玩家金錢
            if (playerMoneyOffer > 0 || npcMoneyOffer > 0) {
                const totalMoneyChange = npcMoneyOffer - playerMoneyOffer;
                transaction.set(playerMoneyRef, { 
                    quantity: admin.firestore.FieldValue.increment(totalMoneyChange),
                    templateId: '銀兩', itemType: '財寶' 
                }, { merge: true });
            }

            // 更新 NPC 金錢
            const npcMoneyField = `inventory.銀兩`;
            transaction.set(npcStateRef, {
                inventory: { '銀兩': admin.firestore.FieldValue.increment(playerMoneyOffer - npcMoneyOffer) }
            }, { merge: true });


            // --- 處理玩家給予NPC的物品 ---
            for (const item of tradeState.player.offer.items) {
                const docRef = playerInventoryRef.doc(item.id);
                const doc = await transaction.get(docRef);
                if (!doc.exists) throw new Error(`找不到你背包中的物品「${item.name}」`);
                
                const currentQty = doc.data().quantity || 1;
                if (currentQty > item.quantity) {
                    transaction.update(docRef, { quantity: admin.firestore.FieldValue.increment(-item.quantity) });
                } else {
                    transaction.delete(docRef);
                }

                const npcItemField = `inventory.${item.name}`;
                transaction.set(npcStateRef, { inventory: { [item.name]: admin.firestore.FieldValue.increment(item.quantity) } }, { merge: true });
            }
            
            // --- 處理NPC給予玩家的物品 ---
            for (const item of tradeState.npc.offer.items) {
                 const npcItemField = `inventory.${item.name}`;
                 transaction.set(npcStateRef, { inventory: { [item.name]: admin.firestore.FieldValue.increment(-item.quantity) } }, { merge: true });
                 
                 // 因為 templateId 和 itemName 相同，可以直接用
                 const playerItemRef = playerInventoryRef.doc(item.name);
                 transaction.set(playerItemRef, { 
                     quantity: admin.firestore.FieldValue.increment(item.quantity),
                     templateId: item.name,
                     // 這裡可以從物品模板中獲取更多資訊，但為簡化，先這樣處理
                 }, { merge: true });
            }
        });

        console.log(`[交易系統] 玩家 ${username} 與 ${npcName} 的交易成功完成。`);

        const lastSaveSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const lastRoundData = lastSaveSnapshot.docs[0].data();
        const newRoundNumber = lastRoundData.R + 1;

        const inventoryState = await getInventoryState(userId);
        const playerItems = tradeState.player.offer.items.map(i => i.name).join('、') || '無';
        const npcItems = tradeState.npc.offer.items.map(i => i.name).join('、') || '無';
        const playerMoneyOffer = tradeState.player.offer.money || 0;
        const npcMoneyOffer = tradeState.npc.offer.money || 0;
        
        let tradeNarrative = `我用「${playerItems}」` + (playerMoneyOffer > 0 ? `和 ${playerMoneyOffer} 文錢` : '') + `換來了你的「${npcItems}」` + (npcMoneyOffer > 0 ? `和 ${npcMoneyOffer} 文錢` : '') + `。`;


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
        
        await updateNpcMemoryAfterInteraction(userId, npcName, tradeNarrative);

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
        res.status(500).json({ message: error.message || '交易過程中發生意外，交換失敗。' });
    }
});

router.post('/end-chat', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const { npcName, fullChatHistory, model: playerModelChoice } = req.body;

    if (!npcName || !fullChatHistory) {
        return res.status(400).json({ message: '缺少必要的對話數據。' });
    }

    try {
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        
        const [summaryDoc, lastSaveSnapshot] = await Promise.all([
            summaryDocRef.get(),
            db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get()
        ]);
        
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "對話發生在一個未知的時間點。";
        
        if (lastSaveSnapshot.empty) {
            return res.status(404).json({ message: "找不到玩家存檔。" });
        }
        let lastRoundData = lastSaveSnapshot.docs[0].data();
        
        const chatSummaryResult = await getAIChatSummary(playerModelChoice, username, npcName, fullChatHistory, longTermSummary);
        
        const formattedHistory = fullChatHistory.map(line => `${line.speaker}: "${line.message}"`).join('\n');
        await updateNpcMemoryAfterInteraction(userId, npcName, formattedHistory);

        const newRoundNumber = lastRoundData.R + 1;
        let newRoundData = { ...lastRoundData, R: newRoundNumber };

        newRoundData.story = chatSummaryResult.story || `你結束了與${npcName}的交談。`;
        newRoundData.EVT = chatSummaryResult.evt || `與${npcName}的一席話`;
        newRoundData.PC = `你與${npcName}深入交談了一番。`;

        const newOverallSummary = await getAISummary(longTermSummary, newRoundData);
        const suggestion = await getAISuggestion(newRoundData);
        newRoundData.suggestion = suggestion;
        
        const updatePromises = [
            db.collection('users').doc(userId).collection('game_saves').doc(`R${newRoundNumber}`).set(newRoundData),
            summaryDocRef.set({ text: newOverallSummary, lastUpdated: newRoundNumber }),
        ];
        
        await Promise.all(updatePromises);
        
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗(結束對話):", err));

        res.json({
            story: newRoundData.story,
            roundData: newRoundData,
            suggestion: newRoundData.suggestion,
        });

    } catch (error) {
        console.error(`[結束對話系統] 替玩家 ${username} 總結與 ${npcName} 的對話時出錯:`, error);
        res.status(500).json({ message: '總結對話時發生內部錯誤。' });
    }
});


module.exports = router;
