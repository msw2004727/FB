// /api/routes/npcTradeRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getMergedNpcProfile } = require('../npcHelpers');
const { getRawInventory, getRawNpcInventory } = require('../playerStateHelpers');
const { addCurrency, spendCurrency } = require('../economyManager');
const { processItemChanges } = require('../itemManager');
const { getAITradeSummary, getAISummary, getAISuggestion } = require('../../services/aiService');
const { invalidateNovelCache, updateLibraryNovel } = require('../worldStateHelpers');

const db = admin.firestore();

router.get('/start-trade/:npcName', async (req, res) => {
    const userId = req.user.id;
    const { npcName } = req.params;

    try {
        const npcProfile = await getMergedNpcProfile(userId, npcName);
        if (!npcProfile) {
            return res.status(404).json({ message: '找不到交易對象。' });
        }

        const [playerInventory, npcInventory] = await Promise.all([
            getRawInventory(userId),
            getRawNpcInventory(npcProfile)
        ]);

        const getCurrency = (inv) => (inv.find(item => item.itemName === '銀兩' || item.templateId === '銀兩') || { quantity: 0 }).quantity;

        const tradeData = {
            player: {
                items: playerInventory.filter(item => item.itemType !== '財寶'),
                money: getCurrency(playerInventory)
            },
            npc: {
                items: npcInventory.filter(item => item.itemType !== '財寶'),
                money: npcProfile.inventory?.['銀兩'] || 0
            }
        };

        res.json(tradeData);
    } catch (error) {
        console.error(`[交易系統] 發起與 ${npcName} 的交易時出錯:`, error);
        res.status(500).json({ message: '準備交易時發生內部錯誤。' });
    }
});

router.post('/confirm-trade', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const { tradeState, npcName, model } = req.body;

    try {
        const [lastSaveSnapshot, summaryDoc] = await Promise.all([
            db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get(),
            db.collection('users').doc(userId).collection('game_state').doc('summary').get()
        ]);
        
        if (lastSaveSnapshot.empty) { throw new Error("找不到前一回合的存檔。"); }
        
        const lastRoundData = lastSaveSnapshot.docs[0].data();

        // 核心交易邏輯，全部包裹在一個事務中
        await db.runTransaction(async (transaction) => {
            const playerOffer = tradeState.player.offer;
            const npcOffer = tradeState.npc.offer;
            const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);

            // 1. 處理玩家付出的金錢與物品
            if (playerOffer.money > 0) {
                await spendCurrency(userId, playerOffer.money, transaction);
            }
            const itemsFromPlayer = playerOffer.items.map(i => ({ action: 'remove', itemName: i.name, quantity: i.quantity }));
            if (itemsFromPlayer.length > 0) await processItemChanges(userId, itemsFromPlayer, transaction, lastRoundData);

            // 2. 處理NPC收到的金錢與物品
            if (playerOffer.money > 0) {
                transaction.set(npcStateRef, { inventory: { '銀兩': admin.firestore.FieldValue.increment(playerOffer.money) } }, { merge: true });
            }
            playerOffer.items.forEach(item => {
                const fieldPath = `inventory.${item.name}`;
                transaction.set(npcStateRef, { inventory: { [item.name]: admin.firestore.FieldValue.increment(item.quantity) } }, { merge: true });
            });

            // 3. 處理NPC付出的金錢與物品
            if (npcOffer.money > 0) {
                const npcDoc = await transaction.get(npcStateRef);
                const npcMoney = npcDoc.data().inventory?.['銀兩'] || 0;
                if (npcMoney < npcOffer.money) throw new Error(`${npcName}的銀兩不足！`);
                transaction.set(npcStateRef, { inventory: { '銀兩': admin.firestore.FieldValue.increment(-npcOffer.money) } }, { merge: true });
            }
            const itemsFromNpc = npcOffer.items.map(i => ({ action: 'remove', itemName: i.name, quantity: i.quantity, fromNpc: npcName })); // 標記來源
            if (itemsFromNpc.length > 0) await processItemChanges(userId, itemsFromNpc, transaction, lastRoundData, npcName);
            
            // 4. 處理玩家收到的金錢與物品
            if (npcOffer.money > 0) {
                await addCurrency(userId, npcOffer.money, transaction);
            }
            const itemsToPlayer = npcOffer.items.map(i => ({ action: 'add', itemName: i.name, quantity: i.quantity }));
            if (itemsToPlayer.length > 0) await processItemChanges(userId, itemsToPlayer, transaction, lastRoundData);
        });

        // 交易成功，創建新的遊戲回合
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : '無';
        const tradeSummaryResult = await getAITradeSummary(model, username, npcName, { ...tradeState, location: lastRoundData.LOC[0] }, longTermSummary);

        const newRoundNumber = lastRoundData.R + 1;
        const newRoundData = {
            ...lastRoundData,
            R: newRoundNumber,
            story: tradeSummaryResult.story,
            EVT: tradeSummaryResult.evt,
            PC: `你與 ${npcName} 完成了一筆交易。`
        };
        
        const newSummary = await getAISummary(longTermSummary, newRoundData);
        const suggestion = await getAISuggestion(newRoundData, model);

        await db.collection('users').doc(userId).collection('game_saves').doc(`R${newRoundNumber}`).set(newRoundData);
        await db.collection('users').doc(userId).collection('game_state').doc('summary').set({ text: newSummary, lastUpdated: newRoundNumber });
        
        invalidateNovelCache(userId).catch(err => console.error("背景更新圖書館失敗:", err));
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗:", err));

        res.json({ 
            message: '交易成功！',
            newRound: {
                story: newRoundData.story,
                roundData: newRoundData,
                suggestion: suggestion
            }
        });

    } catch (error) {
        console.error(`[交易系統] 確認與 ${npcName} 的交易時出錯:`, error);
        res.status(500).json({ message: error.message || '交易失敗，請檢查你的銀兩是否足夠。' });
    }
});

module.exports = router;
