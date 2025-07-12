// /api/routes/npcTradeRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getMergedNpcProfile } = require('../npcHelpers');
const { getRawInventory, getInventoryState, getOrGenerateItemTemplate } = require('../playerStateHelpers');
const { invalidateNovelCache, updateLibraryNovel, getMergedLocationData } = require('../worldStateHelpers');
const { updateNpcMemoryAfterInteraction } = require('../npcHelpers');
// 【核心新增】引入生成摘要和建議的AI服務
const { getAITradeSummary, getAISummary, getAISuggestion } = require('../../services/aiService');

const db = admin.firestore();

/**
 * @route   GET /api/game/npc/start-trade/:npcName
 * @desc    獲取交易初始化數據
 * @access  Private
 */
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

        const playerMoneyItem = playerInventory.find(item => item.templateId === '銀兩');
        const playerMoney = playerMoneyItem ? playerMoneyItem.quantity : 0;
        
        const npcInventory = npcProfile.inventory || {};
        const npcMoney = npcInventory['銀兩'] || 0;

        const npcItemPromises = Object.entries(npcInventory)
            .filter(([itemName, quantity]) => itemName !== '銀兩' && quantity > 0)
            .map(async ([itemName, quantity]) => {
                const itemTemplateResult = await getOrGenerateItemTemplate(itemName);
                if (!itemTemplateResult || !itemTemplateResult.template) return null;
                return { ...itemTemplateResult.template, quantity, instanceId: itemName, templateId: itemName, itemName };
            });

        const npcItems = (await Promise.all(npcItemPromises)).filter(Boolean);

        const tradeData = {
            player: { items: playerInventory, money: playerMoney },
            npc: { name: npcProfile.name, items: npcItems, money: npcMoney, personality: npcProfile.personality }
        };

        res.json(tradeData);

    } catch (error) {
        console.error(`[交易系統] /start-trade/${npcName} 錯誤:`, error);
        res.status(500).json({ message: '開啟交易時發生內部錯誤。' });
    }
});


/**
 * @route   POST /api/game/npc/confirm-trade
 * @desc    確認並執行交易，並推進遊戲回合
 * @access  Private
 */
router.post('/confirm-trade', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    // 【核心修改】新增 playerModelChoice 以便傳遞給AI
    const { tradeState, npcName, model: playerModelChoice } = req.body;

    if (!tradeState || !npcName) {
        return res.status(400).json({ message: '交易數據不完整。' });
    }
    
    try {
        // Step 1: 在一個事務中安全地更新庫存和金錢
        await db.runTransaction(async (transaction) => {
            const playerInventoryRef = db.collection('users').doc(userId).collection('inventory_items');
            const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);
            
            const playerMoneyOffer = tradeState.player.offer.money || 0;
            const npcMoneyOffer = tradeState.npc.offer.money || 0;
            
            // 處理玩家的金錢
            const playerMoneyRef = playerInventoryRef.doc('銀兩');
            const playerMoneyDoc = await transaction.get(playerMoneyRef);
            if ((playerMoneyDoc.data()?.quantity || 0) < playerMoneyOffer) {
                throw new Error('你的錢不夠！');
            }
            if (playerMoneyOffer > 0) transaction.set(playerMoneyRef, { quantity: admin.firestore.FieldValue.increment(-playerMoneyOffer) }, { merge: true });
            if (npcMoneyOffer > 0) transaction.set(playerMoneyRef, { quantity: admin.firestore.FieldValue.increment(npcMoneyOffer), templateId: '銀兩', itemType: '財寶' }, { merge: true });

            // 處理NPC的金錢和物品
            const npcInventoryUpdate = {};
            if (playerMoneyOffer > 0) npcInventoryUpdate['inventory.銀兩'] = admin.firestore.FieldValue.increment(playerMoneyOffer);
            if (npcMoneyOffer > 0) npcInventoryUpdate['inventory.銀兩'] = admin.firestore.FieldValue.increment(-npcMoneyOffer);

            for (const item of tradeState.player.offer.items) {
                const docRef = playerInventoryRef.doc(item.id);
                transaction.delete(docRef);
                npcInventoryUpdate[`inventory.${item.name}`] = admin.firestore.FieldValue.increment(1);
            }

            for (const item of tradeState.npc.offer.items) {
                const newItemRef = playerInventoryRef.doc(); // 為玩家創建新物品
                transaction.set(newItemRef, { templateId: item.name, quantity: 1 });
                npcInventoryUpdate[`inventory.${item.name}`] = admin.firestore.FieldValue.increment(-1);
            }
            
            if (Object.keys(npcInventoryUpdate).length > 0) {
                 transaction.set(npcStateRef, npcInventoryUpdate, { merge: true });
            }
        });

        // Step 2: 交易數據庫操作成功，開始生成劇情並推進回合
        const [lastSaveSnapshot, summaryDoc] = await Promise.all([
            db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get(),
            db.collection('users').doc(userId).collection('game_state').doc('summary').get()
        ]);
        
        const lastRoundData = lastSaveSnapshot.docs[0].data();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : '無';

        // Step 3: 呼叫AI生成交易劇情
        const tradeDetailsForAI = {
            ...tradeState,
            location: lastRoundData.LOC[0] || '未知之地'
        };
        const tradeNarrativeResult = await getAITradeSummary(playerModelChoice, username, npcName, tradeDetailsForAI, longTermSummary);

        // Step 4: 更新NPC對這次交易的個人記憶
        const memoryText = `我和 ${username} 完成了一筆交易。我用「${tradeState.npc.offer.items.map(i=>i.name).join('、') || '無'}」和${tradeState.npc.offer.money}文錢，換來了「${tradeState.player.offer.items.map(i=>i.name).join('、') || '無'}」和${tradeState.player.offer.money}文錢。`;
        await updateNpcMemoryAfterInteraction(userId, npcName, memoryText);

        // Step 5: 準備新回合的數據
        const newRoundNumber = lastRoundData.R + 1;
        const inventoryState = await getInventoryState(userId);
        
        const newRoundData = {
            ...lastRoundData,
            R: newRoundNumber,
            story: tradeNarrativeResult.story,
            PC: '完成了一筆交易。',
            EVT: tradeNarrativeResult.evt,
            ITM: inventoryState.itemsString,
            money: inventoryState.money,
        };
        
        // Step 6: 更新長期記憶和建議
        const newSummary = await getAISummary(longTermSummary, newRoundData);
        const suggestion = await getAISuggestion(newRoundData);
        newRoundData.suggestion = suggestion;

        // Step 7: 將新回合數據寫入資料庫
        await db.collection('users').doc(userId).collection('game_saves').doc(`R${newRoundNumber}`).set(newRoundData);
        await db.collection('users').doc(userId).collection('game_state').doc('summary').set({ text: newSummary, lastUpdated: newRoundNumber });
        
        // Step 8: 更新快取與圖書館
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗(交易):", err));

        // Step 9: 將完整的新回合數據回傳給前端
        res.json({
            message: '交易成功！',
            newRound: {
                story: newRoundData.story,
                roundData: newRoundData,
                suggestion: suggestion,
                locationData: await getMergedLocationData(userId, newRoundData.LOC)
            }
        });

    } catch (error) {
        console.error(`[交易系統] /confirm-trade 錯誤:`, error);
        res.status(500).json({ message: error.message || '交易過程中發生意外，交換失敗。' });
    }
});

module.exports = router;
