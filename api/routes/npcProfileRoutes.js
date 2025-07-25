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
    const username = req.user.username;
    const { npcName } = req.params;

    try {
        // --- 【核心修正】步驟一：先獲取完整的上下文資料 ---
        const [userDoc, lastSaveSnapshot] = await Promise.all([
            db.collection('users').doc(userId).get(),
            db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get()
        ]);

        if (!userDoc.exists) {
            return res.status(404).json({ message: '找不到玩家檔案。' });
        }
        if (lastSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到玩家存檔紀錄。' });
        }
        
        const playerProfile = { ...userDoc.data(), username: username };
        const roundData = lastSaveSnapshot.docs[0].data();

        // --- 步驟二：將完整的上下文傳遞給核心處理函式 ---
        const npcProfile = await getMergedNpcProfile(userId, npcName, roundData, playerProfile);
        
        // --- 步驟三：處理回傳資料 ---
        if (npcProfile && npcProfile.isPlayer) {
             return res.json({
                name: npcProfile.name,
                status_title: '這就是你',
                avatarUrl: null
            });
        }

        if (!npcProfile) {
            return res.status(404).json({ message: '找不到該人物的檔案。' });
        }
        
        const playerLocationHierarchy = lastSaveSnapshot.docs[0].data().LOC;
        const playerArea = playerLocationHierarchy[0];
        const npcArea = npcProfile.address?.town || npcProfile.address?.district || npcProfile.address?.city || npcProfile.currentLocation;

        if (playerArea !== npcArea) {
            console.log(`[密談檢查] 玩家 (${playerArea}) 與 NPC (${npcArea}) 不在同一個區域，拒絕密談。`);
            return res.status(403).json({ message: `你環顧四周，並未見到 ${npcName} 的身影。` });
        }

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
