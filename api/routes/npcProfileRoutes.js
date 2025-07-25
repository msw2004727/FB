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
        const [npcProfile, lastSaveSnapshot, userDoc] = await Promise.all([
            getMergedNpcProfile(userId, npcName),
            db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get(),
            db.collection('users').doc(userId).get() // 新增：獲取玩家資料以比對姓名
        ]);

        // 【核心新增】如果請求的是玩家自己的名字，直接回傳玩家資訊
        const userData = userDoc.data();
        if (userData && userData.username === npcName) {
            return res.json({
                name: userData.username,
                status_title: '玩家',
                avatarUrl: null // 玩家目前沒有頭像系統
            });
        }
        
        if (!npcProfile) {
            return res.status(404).json({ message: '找不到該人物的檔案。' });
        }
        
        // 移除地點檢查，因為關係圖上的人物不一定在當前場景
        // if (lastSaveSnapshot.empty) {
        //     return res.status(404).json({ message: '找不到玩家位置資訊。' });
        // }
        // const playerLocationHierarchy = lastSaveSnapshot.docs[0].data().LOC;
        // const playerArea = playerLocationHierarchy[0];
        // const npcArea = npcProfile.address?.town || npcProfile.address?.district || npcProfile.address?.city || npcProfile.currentLocation;
        // if (playerArea !== npcArea) {
        //     console.log(`[密談檢查] 玩家 (${playerArea}) 與 NPC (${npcArea}) 不在同一個區域，拒絕密談。`);
        //     return res.status(403).json({ message: `你環顧四周，並未見到 ${npcName} 的身影。` });
        // }

        const publicProfile = {
            name: npcProfile.name,
            appearance: npcProfile.appearance,
            friendliness: getFriendlinessLevel(npcProfile.friendlinessValue || 0),
            romanceValue: npcProfile.romanceValue || 0,
            friendlinessValue: npcProfile.friendlinessValue || 0,
            status_title: npcProfile.status_title || '身份不明',
            avatarUrl: npcProfile.avatarUrl || null
        };

        res.json(publicProfile);

    } catch (error) {
        console.error(`[NPC路由] /profile/:npcName 錯誤:`, error);
        res.status(500).json({ message: '讀取人物檔案時發生內部錯誤。' });
    }
});

module.exports = router;
