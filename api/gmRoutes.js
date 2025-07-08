// api/gmRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth');
const { getFriendlinessLevel } = require('./gameHelpers');

const db = admin.firestore();

// 所有GM路由都需要經過身份驗證
router.use(authMiddleware);

/**
 * @route   GET /api/gm/npcs
 * @desc    獲取所有玩家的NPC列表及其關係數據
 * @access  Private (GM)
 */
router.get('/npcs', async (req, res) => {
    const userId = req.user.id;
    try {
        const npcsSnapshot = await db.collection('users').doc(userId).collection('npcs').get();
        if (npcsSnapshot.empty) {
            return res.json([]);
        }

        const npcList = npcsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name || doc.id,
                friendlinessValue: data.friendlinessValue || 0,
                romanceValue: data.romanceValue || 0
            };
        });

        res.json(npcList);
    } catch (error) {
        console.error(`[GM工具] 獲取NPC列表時出錯:`, error);
        res.status(500).json({ message: '獲取NPC列表失敗。' });
    }
});

/**
 * @route   POST /api/gm/update-npc
 * @desc    更新指定NPC的關係數據
 * @access  Private (GM)
 */
router.post('/update-npc', async (req, res) => {
    const userId = req.user.id;
    const { npcId, friendlinessValue, romanceValue } = req.body;

    if (!npcId) {
        return res.status(400).json({ message: '未提供NPC ID。' });
    }

    try {
        const npcRef = db.collection('users').doc(userId).collection('npcs').doc(npcId);
        
        const updates = {};
        if (friendlinessValue !== undefined) {
            updates.friendlinessValue = Number(friendlinessValue);
            updates.friendliness = getFriendlinessLevel(Number(friendlinessValue));
        }
        if (romanceValue !== undefined) {
            updates.romanceValue = Number(romanceValue);
        }

        if (Object.keys(updates).length > 0) {
            await npcRef.set(updates, { merge: true });
        }

        res.json({ message: `NPC「${npcId}」的數據已成功更新。` });

    } catch (error) {
        console.error(`[GM工具] 更新NPC「${npcId}」時出錯:`, error);
        res.status(500).json({ message: '更新NPC數據時發生內部錯誤。' });
    }
});


module.exports = router;
