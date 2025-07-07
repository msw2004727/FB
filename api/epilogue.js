// /api/epilogue.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIEpilogue } = require('../services/aiService'); // 我們稍後會在 aiService.js 中加入這個函式

const db = admin.firestore();

/**
 * @route   GET /api/epilogue
 * @desc    為已故玩家生成結局故事
 * @access  Private
 */
router.get('/', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    console.log(`[結局系統] 收到來自玩家 ${username} (ID: ${userId}) 的結局生成請求。`);

    try {
        // --- 1. 從資料庫並行撈取所有需要的資料 ---
        const userDocRef = db.collection('users').doc(userId);
        const summaryDocRef = userDocRef.collection('game_state').doc('summary');
        const npcsSnapshotRef = userDocRef.collection('npcs').get();
        const inventoryDocRef = userDocRef.collection('game_state').doc('inventory');
        const lastSaveSnapshotRef = userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();

        const [
            userDoc,
            summaryDoc,
            npcsSnapshot,
            inventoryDoc,
            lastSaveSnapshot
        ] = await Promise.all([
            userDocRef.get(),
            summaryDocRef.get(),
            npcsSnapshotRef,
            inventoryDocRef,
            lastSaveSnapshotRef
        ]);

        // --- 2. 驗證資料完整性 ---
        if (!userDoc.exists) {
            return res.status(404).json({ message: '找不到玩家檔案。' });
        }
        if (lastSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到最終的存檔紀錄。' });
        }

        const userData = userDoc.data();
        const lastSaveData = lastSaveSnapshot.docs[0].data();

        // --- 3. 整理傳遞給AI的資料包 ---
        const finalRelationships = [];
        if (!npcsSnapshot.empty) {
            npcsSnapshot.forEach(doc => {
                const npc = doc.data();
                finalRelationships.push({
                    name: npc.name,
                    friendliness: npc.friendliness,
                    romanceValue: npc.romanceValue || 0
                });
            });
        }

        const finalInventory = [];
        if (inventoryDoc.exists) {
            const inventoryData = inventoryDoc.data();
            for (const [itemName, itemData] of Object.entries(inventoryData)) {
                // 只挑選出稀有度在「稀有」以上的物品，避免結局被雜物淹沒
                if (itemData.quantity > 0 && (itemData.rarity === '史詩' || itemData.rarity === '傳說')) {
                    finalInventory.push({ itemName: itemName, description: itemData.description });
                }
            }
        }

        const playerDataForAI = {
            username: username,
            longTermSummary: summaryDoc.exists ? summaryDoc.data().text : '此人一生如謎，未有記載。',
            finalStats: {
                gender: userData.gender,
                power: {
                    internal: userData.internalPower,
                    external: userData.externalPower,
                    lightness: userData.lightness
                }
            },
            finalMorality: userData.morality,
            finalRelationships: finalRelationships,
            finalInventory: finalInventory,
            deathInfo: {
                // 【核心修改】優先使用 causeOfDeath，如果沒有，再使用PC，最後才是通用描述
                cause: lastSaveData.causeOfDeath || lastSaveData.PC || '江湖險惡，不幸殞命。',
                time: `${lastSaveData.yearName}${lastSaveData.year}年${lastSaveData.month}月${lastSaveData.day}日`,
                location: lastSaveData.LOC[0]
            }
        };

        // --- 4. 呼叫AI服務生成結局 ---
        console.log(`[結局系統] 資料準備完畢，正在為 ${username} 請求AI生成結局...`);
        // 我們將使用 'deepseek' 模型來生成需要較強創造力的長篇故事
        const epilogueStory = await getAIEpilogue('deepseek', playerDataForAI);

        // --- 5. 回傳結果 ---
        res.json({ epilogue: epilogueStory });

    } catch (error) {
        console.error(`[結局系統] 為玩家 ${username} (ID: ${userId}) 生成結局時發生嚴重錯誤:`, error);
        res.status(500).json({ message: '為您撰寫人生終章時，史官的筆墨耗盡了，請稍後再試。' });
    }
});

module.exports = router;
