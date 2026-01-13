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

        const npcProfile = await getMergedNpcProfile(userId, npcName, roundData, playerProfile);
        
        // 1. 如果是玩家自己
        if (playerProfile && playerProfile.username === npcName) {
            return res.json({
                name: playerProfile.username,
                status_title: '玩家',
                avatarUrl: null
            });
        }

        if (!npcProfile) {
            return res.status(404).json({ message: '找不到該人物的檔案。' });
        }
        
        // --- 【核心修正 v3.5】位置與隊友檢查邏輯 ---
        
        const playerLocationHierarchy = roundData.LOC || [];
        const npcLocationHierarchy = npcProfile.currentLocation;

        const playerArea = (Array.isArray(playerLocationHierarchy) && playerLocationHierarchy.length > 0) 
            ? playerLocationHierarchy[0].trim() 
            : null;
            
        const npcArea = (Array.isArray(npcLocationHierarchy) && npcLocationHierarchy.length > 0)
            ? npcLocationHierarchy[0].trim()
            : (typeof npcLocationHierarchy === 'string' ? npcLocationHierarchy.trim() : null);

        // [關鍵修復] 檢查該 NPC 是否為玩家的同行隊友 (Companions)
        // 假設存檔結構中有 companions 陣列，若無則預設為空
        const companions = roundData.companions || [];
        const isCompanion = Array.isArray(companions) && companions.includes(npcName);

        // [判定邏輯]
        // 如果 (地點不同) 且 (不是隊友)，才拒絕存取
        if ((!playerArea || !npcArea || playerArea !== npcArea) && !isCompanion) {
            console.log(`[互動檢查] 玩家位於 "${playerArea}"，NPC "${npcName}" 位於 "${npcArea}"。地點不符且非隊友，系統拒絕連接。`);
            return res.status(403).json({ message: `[系統] 連接失敗... (你環顧四周，並未見到 ${npcName} 的身影。)` });
        }
        
        // --- 修正結束 ---

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
