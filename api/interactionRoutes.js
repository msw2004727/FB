// /api/interactionRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { handlePreActionChecks } = require('./gameplay/preActionChecks');
const { handleAction } = require('./gameplay/actionHandler');

const db = admin.firestore();

// 這是重構後唯一的互動路由處理函式
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
        
        // 1. 執行前置檢查
        const isHandled = await handlePreActionChecks(req, res, player, newRoundNumber);
        
        // 2. 如果請求已被前置檢查處理，則直接返回
        if (isHandled) {
            return;
        }

        // 3. 否則，交給核心互動處理器
        await handleAction(req, res, player, newRoundNumber);
        
    } catch (error) {
        console.error(`[互動路由入口] 捕獲到未處理的錯誤:`, error);
        res.status(500).json({ message: error.message || "處理您的動作時發生了未知的伺服器錯誤。" });
    }
};

router.post('/interact', interactRouteHandler);
module.exports = router;
