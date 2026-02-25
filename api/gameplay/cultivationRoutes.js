// api/gameplay/cultivationRoutes.js
const express = require('express');
const router = express.Router();
const { handleCultivation } = require('./cultivationManager');
const { updateGameState } = require('./stateUpdaters');
const { getAISuggestion } = require('../../services/aiService');
const { getMergedLocationData } = require('../worldStateHelpers');
const admin = require('firebase-admin');

const db = admin.firestore();

// 新的閉關請求處理路由
router.post('/start', async (req, res) => {
    const { id: userId, username } = req.user;
    const { skillName, days, model: playerModelChoice } = req.body;

    try {
        // 獲取最新的玩家數據，以便傳遞給閉關管理器
        const playerDoc = await db.collection('users').doc(userId).get();
        if (!playerDoc.exists) {
            return res.status(404).json({ success: false, message: '找不到玩家資料。' });
        }
        const playerProfile = playerDoc.data();
        
        // 【核心修正】直接傳遞準確的 skillName 和 days，而不是一個拼接後的字串
        const cultivationResult = await handleCultivation(userId, username, playerProfile, skillName, days);

        if (!cultivationResult.success) {
            // 如果前置條件不滿足，直接回傳錯誤訊息
            return res.status(400).json({ success: false, message: cultivationResult.message });
        }

        // 閉關成功，更新遊戲狀態
        const lastSaveSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const currentRoundNumber = lastSaveSnapshot.empty ? 0 : (lastSaveSnapshot.docs[0].data().R || 0);
        const newRoundNumber = currentRoundNumber + 1;

        // 為了日誌和記錄，我們在最後才構造一個 playerAction
        const playerAction = `透過彈窗閉關修練「${skillName}」${days}日`;

        const finalRoundData = await updateGameState(userId, username, playerProfile, playerAction, { roundData: cultivationResult.data }, newRoundNumber);
        const suggestion = await getAISuggestion(finalRoundData, playerModelChoice);
        finalRoundData.suggestion = suggestion;
        
        const finalLocationData = await getMergedLocationData(userId, finalRoundData.LOC);

        res.json({
            success: true,
            message: '閉關結束，你感覺脫胎換骨。',
            story: finalRoundData.story,
            roundData: finalRoundData,
            suggestion: suggestion,
            locationData: finalLocationData
        });

    } catch (error) {
        console.error(`[閉關API] 玩家 ${username} 閉關時發生錯誤:`, error);
        res.status(500).json({ success: false, message: error.message || '閉關時發生了未知的伺服器錯誤。' });
    }
});

module.exports = router;
