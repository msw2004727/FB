// /api/gameplayRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { handlePreActionChecks } = require('./gameplay/preActionChecks');
const { handleAction } = require('./gameplay/actionHandler');
// 【核心修正】修正了 backgroundTaskProcessor 的引用路徑
const { getTaskStatus } = require('./services/backgroundTaskProcessor');

const db = admin.firestore();

// 互動主路由
const interactRouteHandler = async (req, res) => {
    const userId = req.user.id;
    const userDocRef = db.collection('users').doc(userId);

    try {
        const [playerStateSnapshot, lastSaveSnapshot] = await Promise.all([
            userDocRef.get(),
            userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get()
        ]);
        
        if (!playerStateSnapshot.exists) {
            return res.status(404).json({ message: '找不到玩家資料。' });
        }
        const player = playerStateSnapshot.data();
        const currentRoundNumber = lastSaveSnapshot.empty ? 0 : (lastSaveSnapshot.docs[0].data().R || 0);
        const newRoundNumber = currentRoundNumber + 1;
        
        const isHandled = await handlePreActionChecks(req, res, player, newRoundNumber);
        
        if (isHandled) {
            return;
        }

        await handleAction(req, res, player, newRoundNumber);
        
    } catch (error) {
        console.error(`[互動路由入口] 捕獲到未處理的錯誤:`, error);
        res.status(500).json({ message: error.message || "處理您的動作時發生了未知的伺服器錯誤。" });
    }
};

router.post('/interact', interactRouteHandler);


// 前端輪詢數據更新結果的API路由
router.get('/poll-update/:taskId', (req, res) => {
    const { taskId } = req.params;
    const result = getTaskStatus(taskId);

    switch (result.status) {
        case 'completed':
            res.status(200).json(result);
            break;
        case 'pending':
            res.status(202).json({ status: 'processing' });
            break;
        case 'error':
            res.status(500).json({ status: 'error', message: result.error });
            break;
        case 'not_found':
        default:
            res.status(404).json({ status: 'not_found', message: '找不到對應的任務或任務已過期。' });
            break;
    }
});


module.exports = router;
