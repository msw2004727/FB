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
        // 1. 先讀取玩家主檔案 (userDoc)，這裡面有最新的 R (回合數)
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ message: '找不到玩家檔案。' });
        }
        
        const playerProfile = { ...userDoc.data(), username: username };
        const currentR = playerProfile.R; // 獲取最新回合數

        // 2. 嘗試「直接讀取」該回合的存檔 (強一致性，無延遲)
        let roundData = null;
        
        if (currentR !== undefined && currentR !== null) {
            const directSaveDoc = await userDocRef.collection('game_saves').doc(`R${currentR}`).get();
            if (directSaveDoc.exists) {
                roundData = directSaveDoc.data();
                // console.log(`[讀取優化] 已直接鎖定讀取最新存檔 R${currentR}`);
            }
        }

        // 3. 如果找不到直接存檔 (例如舊資料沒 R 欄位)，才降級使用 orderBy (可能會有延遲)
        if (!roundData) {
            console.warn(`[讀取降級] 無法直接讀取 R${currentR}，改用索引查詢 (可能存在延遲)...`);
            const lastSaveSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
            if (lastSaveSnapshot.empty) {
                return res.status(404).json({ message: '找不到玩家存檔紀錄。' });
            }
            roundData = lastSaveSnapshot.docs[0].data();
        }

        // --- 核心邏輯：獲取 NPC 資料 ---
        const npcProfile = await getMergedNpcProfile(userId, npcName, roundData, playerProfile);
        
        // 4. 特殊狀況：如果是玩家自己
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
        
        // --- 【核心修正 v5.0】位置與在場檢查邏輯 ---
        
        const playerLocationHierarchy = roundData.LOC || [];
        const npcLocationHierarchy = npcProfile.currentLocation;

        const playerArea = (Array.isArray(playerLocationHierarchy) && playerLocationHierarchy.length > 0) 
            ? playerLocationHierarchy[0].trim() 
            : null;
            
        const npcArea = (Array.isArray(npcLocationHierarchy) && npcLocationHierarchy.length > 0)
            ? npcLocationHierarchy[0].trim()
            : (typeof npcLocationHierarchy === 'string' ? npcLocationHierarchy.trim() : null);

        // [關鍵邏輯]
        // 1. 檢查該 NPC 是否在「隊友清單」中 (預留擴充)
        const companions = roundData.companions || [];
        const isCompanion = Array.isArray(companions) && companions.includes(npcName);

        // 2. 檢查該 NPC 是否存在於最新一回合的 "NPC" (人物見聞) 列表中
        // 使用 .trim() 確保名稱比對不會因為空白而失敗
        const presentInScene = Array.isArray(roundData.NPC) && roundData.NPC.some(n => n.name && n.name.trim() === npcName.trim());

        // [最終判定]
        // 如果 (地點不符) 且 (不在人物列表) 且 (不是隊友)，才拒絕存取
        if ((!playerArea || !npcArea || playerArea !== npcArea) && !presentInScene && !isCompanion) {
            console.log(`[互動檢查] 拒絕存取：玩家@${playerArea}, NPC@${npcArea}, 在場=${presentInScene}, 隊友=${isCompanion}`);
            // 注意：這裡移除了重複的 "[系統] 連接失敗..." 前綴，讓前端顯示更乾淨
            return res.status(403).json({ message: `你環顧四周，並未見到 ${npcName} 的身影。` });
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
