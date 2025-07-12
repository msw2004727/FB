// /api/routes/npcProfileRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getMergedNpcProfile, getFriendlinessLevel } = require('../npcHelpers');

const db = admin.firestore();

/**
 * @route   GET /api/game/npc/profile/:npcName
 * @desc    獲取NPC公開資料
 * @access  Private
 */
router.get('/profile/:npcName', async (req, res) => {
    const userId = req.user.id;
    const { npcName } = req.params;
    try {
        const [npcProfile, userDoc] = await Promise.all([
            getMergedNpcProfile(userId, npcName),
            db.collection('users').doc(userId).get()
        ]);

        if (!npcProfile) {
            return res.status(404).json({ message: '找不到該人物的檔案。' });
        }
        
        if (!userDoc.exists || !userDoc.data().currentLocation) {
            return res.status(404).json({ message: '找不到玩家位置資訊。' });
        }
        
        // 【核心修改】採用更靈活的地點判定邏輯
        const playerLocationHierarchy = userDoc.data().currentLocation; // 这是一个陣列，例如 ["無名村", "街道"]
        const npcLocation = npcProfile.currentLocation; // 这是一个字串，例如 "街道"

        // 新規則：只要NPC的單一地點，存在於玩家的層級地點中，就視為在同一地點。
        if (!Array.isArray(playerLocationHierarchy) || !playerLocationHierarchy.includes(npcLocation)) {
            return res.status(403).json({ message: `你環顧四周，並未見到 ${npcName} 的身影。` });
        }
        // --- 修改結束 ---

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
        console.error(`[NPC路由] /profile/:npcName 錯誤:`, error);
        res.status(500).json({ message: '讀取人物檔案時發生內部錯誤。' });
    }
});

module.exports = router;
