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
        
        // --- 【核心修改】放寬密談條件 ---
        const playerLocationHierarchy = lastSaveSnapshot.docs[0].data().LOC;
        // 玩家的 "大區域" 通常是地點陣列的第一個元素 (例如: "無名村")
        const playerArea = playerLocationHierarchy[0];

        // NPC 的 "大區域" 從其地址中獲取，優先順序為 鎮 > 區 > 城。如果沒有地址，則使用其當前位置作為備用。
        const npcArea = npcProfile.address?.town || npcProfile.address?.district || npcProfile.address?.city || npcProfile.currentLocation;

        // 只要兩者的大區域相同，就允許密談
        if (playerArea !== npcArea) {
            console.log(`[密談檢查] 玩家 (${playerArea}) 與 NPC (${npcArea}) 不在同一個區域，拒絕密談。`);
            return res.status(403).json({ message: `你環顧四周，並未見到 ${npcName} 的身影。` });
        }
        // --- 修改結束 ---

        const publicProfile = {
            name: npcProfile.name,
            appearance: npcProfile.appearance,
            friendliness: getFriendlinessLevel(npcProfile.friendlinessValue || 0),
            romanceValue: npcProfile.romanceValue || 0,
            friendlinessValue: npcProfile.friendlinessValue || 0,
            status_title: npcProfile.status_title || '身份不明' 
        };

        res.json(publicProfile);

    } catch (error) {
        console.error(`[NPC路由] /profile/:npcName 錯誤:`, error);
        res.status(500).json({ message: '讀取人物檔案時發生內部錯誤。' });
    }
});

module.exports = router;
