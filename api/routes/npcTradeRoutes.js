// /api/routes/npcTradeRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const { getMergedNpcProfile } = require('../npcHelpers');
const { getRawInventory, getInventoryState, getOrGenerateItemTemplate } = require('../playerStateHelpers');
const { invalidateNovelCache, updateLibraryNovel, getMergedLocationData } = require('../worldStateHelpers');
const { updateNpcMemoryAfterInteraction } = require('../npcHelpers');
const { getAITradeSummary, getAISummary, getAISuggestion } = require('../../services/aiService');

const db = admin.firestore();

/**
 * @route   GET /api/game/npc/start-trade/:npcName
 * @desc    獲取交易初始化數據 (v2.0 - 包含NPC裝備)
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
        
        const npcInventoryMap = npcProfile.inventory || {};
        const npcMoney = npcInventoryMap['銀兩'] || 0;
        
        const allNpcItems = [];

        // 1. 處理 inventory (可堆疊物品)
        const npcStackableItemPromises = Object.entries(npcInventoryMap)
            .filter(([itemName, quantity]) => itemName !== '銀兩' && quantity > 0)
            .map(async ([itemName, quantity]) => {
                const itemTemplateResult = await getOrGenerateItemTemplate(itemName);
                if (!itemTemplateResult || !itemTemplateResult.template) return null;
                // 對於可堆疊物品，我們使用 templateId 作為唯一標識
                return { ...itemTemplateResult.template, quantity, instanceId: itemName, templateId: itemName, itemName };
            });

        // 2. 處理 equipment (不可堆疊的實例化物品)
        const npcEquipment = npcProfile.equipment || [];
        const npcEquipmentPromises = npcEquipment.map(async (equip) => {
             const itemTemplateResult = await getOrGenerateItemTemplate(equip.templateId);
             if (!itemTemplateResult || !itemTemplateResult.template) return null;
             // 對於裝備，我們使用 instanceId 作為唯一標識
             return { ...itemTemplateResult.template, quantity: 1, instanceId: equip.instanceId, templateId: equip.templateId, itemName: equip.templateId };
        });

        // 合併所有物品
        const npcItemsFromInventory = (await Promise.all(npcStackableItemPromises)).filter(Boolean);
        const npcItemsFromEquipment = (await Promise.all(npcEquipmentPromises)).filter(Boolean);
        allNpcItems.push(...npcItemsFromInventory, ...npcItemsFromEquipment);

        const tradeData = {
            player: { items: playerInventory, money: playerMoney },
            npc: { name: npcProfile.name, items: allNpcItems, money: npcMoney, personality: npcProfile.personality }
        };

        res.json(tradeData);

    } catch (error) {
        console.error(`[交易系統] /start-trade/${npcName} 錯誤:`, error);
        res.status(500).json({ message: '開啟交易時發生內部錯誤。' });
    }
});


/**
 * @route   POST /api/game/npc/confirm-trade
 * @desc    確認並執行交易 (v2.0 - 包含NPC裝備處理)
 * @access  Private
 */
router.post('/confirm-trade', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const { tradeState, npcName, model: playerModelChoice } = req.body;

    if (!tradeState || !npcName) {
        return res.status(400).json({ message: '交易數據不完整。' });
    }

    try {
        await db.runTransaction(async (transaction) => {
            const playerInventoryRef = db.collection('users').doc(userId).collection('inventory_items');
            const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);
            const npcStateDoc = await transaction.get(npcStateRef);
            if (!npcStateDoc.exists) throw new Error("找不到NPC的狀態檔案。");
            const npcStateData = npcStateDoc.data();

            // --- 驗證與扣除玩家資源 ---
            const playerMoneyOffer = tradeState.player.offer.money || 0;
            const playerMoneyRef = playerInventoryRef.doc('銀兩');
            const playerMoneyDoc = await transaction.get(playerMoneyRef);
            if ((playerMoneyDoc.data()?.quantity || 0) < playerMoneyOffer) {
                throw new Error('你的錢不夠！');
            }
            if (playerMoneyOffer > 0) {
                 transaction.set(playerMoneyRef, { quantity: admin.firestore.FieldValue.increment(-playerMoneyOffer) }, { merge: true });
            }
            for (const item of tradeState.player.offer.items) {
                const itemDoc = await transaction.get(playerInventoryRef.doc(item.id));
                if (!itemDoc.exists) throw new Error(`你背包裡沒有「${item.name}」這件物品。`);
                transaction.delete(playerInventoryRef.doc(item.id));
            }

            // --- 處理NPC資源轉移 ---
            const npcMoneyOffer = tradeState.npc.offer.money || 0;
            const npcCurrentMoney = npcStateData.inventory?.['銀兩'] || 0;
            if (npcCurrentMoney < npcMoneyOffer) throw new Error(`${npcName}的錢不夠！`);

            let npcInventoryUpdate = {};
            // 金錢轉移
            if (playerMoneyOffer > 0) npcInventoryUpdate['inventory.銀兩'] = admin.firestore.FieldValue.increment(playerMoneyOffer);
            if (npcMoneyOffer > 0) {
                transaction.set(playerMoneyRef, { quantity: admin.firestore.FieldValue.increment(npcMoneyOffer), templateId: '銀兩', itemType: '財寶' }, { merge: true });
                npcInventoryUpdate['inventory.銀兩'] = admin.firestore.FieldValue.increment(-npcMoneyOffer);
            }

            // 玩家給出的物品，加入NPC庫存
            for (const item of tradeState.player.offer.items) {
                npcInventoryUpdate[`inventory.${item.name}`] = admin.firestore.FieldValue.increment(1);
            }

            // --- 玩家收到的物品 (核心修改處) ---
            let npcEquipmentUpdate = npcStateData.equipment || [];
            for (const item of tradeState.npc.offer.items) {
                // 判斷物品是來自裝備(有UUID)還是庫存(無UUID)
                const isFromEquipment = item.id !== item.name;

                if (isFromEquipment) {
                    npcEquipmentUpdate = npcEquipmentUpdate.filter(equip => equip.instanceId !== item.id);
                } else {
                    const currentQuantity = npcStateData.inventory?.[item.name] || 0;
                    if (currentQuantity < item.quantity) throw new Error(`${npcName}的「${item.name}」數量不足！`);
                    npcInventoryUpdate[`inventory.${item.name}`] = admin.firestore.FieldValue.increment(-item.quantity);
                }
                
                // 將物品加入玩家背包
                const templateResult = await getOrGenerateItemTemplate(item.name);
                if (!templateResult || !templateResult.template) continue;
                const template = templateResult.template;
                const isStackable = ['材料', '財寶', '道具', '其他', '秘笈', '書籍'].includes(template.itemType);

                if (isStackable) {
                    transaction.set(playerInventoryRef.doc(item.name), { templateId: item.name, quantity: admin.firestore.FieldValue.increment(item.quantity) }, { merge: true });
                } else {
                    for (let i = 0; i < item.quantity; i++) {
                        const newItemRef = playerInventoryRef.doc(uuidv4());
                        transaction.set(newItemRef, { templateId: item.name, quantity: 1, isEquipped: false, equipSlot: null });
                    }
                }
            }
            // 一次性更新NPC的庫存和裝備
            transaction.set(npcStateRef, { ...npcInventoryUpdate, equipment: npcEquipmentUpdate }, { merge: true });
        });

        // ... 後續的劇情生成和回合推進邏輯（與您現有程式碼相同） ...
        const [lastSaveSnapshot, summaryDoc] = await Promise.all([
            db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get(),
            db.collection('users').doc(userId).collection('game_state').doc('summary').get()
        ]);
        
        const lastRoundData = lastSaveSnapshot.docs[0].data();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : '無';

        const tradeDetailsForAI = { ...tradeState, location: lastRoundData.LOC[0] || '未知之地' };
        const tradeNarrativeResult = await getAITradeSummary(playerModelChoice, username, npcName, tradeDetailsForAI, longTermSummary);

        const memoryText = `我和 ${username} 完成了一筆交易。我用「${tradeState.npc.offer.items.map(i=>i.name).join('、') || '無'}」和${tradeState.npc.offer.money}文錢，換來了「${tradeState.player.offer.items.map(i=>i.name).join('、') || '無'}」和${tradeState.player.offer.money}文錢。`;
        await updateNpcMemoryAfterInteraction(userId, npcName, memoryText);

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
            itemChanges: [],
        };
        
        const newSummary = await getAISummary(longTermSummary, newRoundData);
        const suggestion = await getAISuggestion(newRoundData);
        newRoundData.suggestion = suggestion;

        await db.collection('users').doc(userId).collection('game_saves').doc(`R${newRoundNumber}`).set(newRoundData);
        await db.collection('users').doc(userId).collection('game_state').doc('summary').set({ text: newSummary, lastUpdated: newRoundNumber });
        
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗(交易):", err));

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
