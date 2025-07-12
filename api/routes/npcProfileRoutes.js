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
        const [npcProfile, lastSaveSnapshot] = await Promise.all([
            getMergedNpcProfile(userId, npcName),
            db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get()
        ]);

        if (!npcProfile) {
            return res.status(404).json({ message: '找不到該人物的檔案。' });
        }
        
        if (lastSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到玩家位置資訊。' });
        }
        
        const playerLocationHierarchy = lastSaveSnapshot.docs[0].data().LOC;
        const npcLocation = npcProfile.currentLocation;

        if (!Array.isArray(playerLocationHierarchy) || !playerLocationHierarchy.includes(npcLocation)) {
            return res.status(403).json({ message: `你環顧四周，並未見到 ${npcName} 的身影。` });
        }

        const publicProfile = {
            name: npcProfile.name,
            appearance: npcProfile.appearance,
            friendliness: getFriendlinessLevel(npcProfile.friendlinessValue || 0),
            romanceValue: npcProfile.romanceValue || 0,
            friendlinessValue: npcProfile.friendlinessValue || 0,
            age: npcProfile.age || '年齡不詳',
            // 【核心修正】將NPC的身份稱謂(status_title)回傳給前端
            status_title: npcProfile.status_title || '身份不明' 
        };

        res.json(publicProfile);

    } catch (error) {
        console.error(`[NPC路由] /profile/:npcName 錯誤:`, error);
        res.status(500).json({ message: '讀取人物檔案時發生內部錯誤。' });
    }
});

module.exports = router;
