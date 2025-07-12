// /api/beggarRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const beggarService = require('../services/beggarService');
const { getInventoryState } = require('./playerStateHelpers'); 
const admin = require('firebase-admin');

const db = admin.firestore(); 

router.use(authMiddleware);

router.post('/summon', async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await beggarService.handleBeggarSummon(userId);
        res.json(result);
    } catch (error) {
        console.error('[丐幫路由] /summon 錯誤:', error);
        res.status(500).json({ message: error.message || '呼叫丐幫時發生未知錯誤。' });
    }
});

/**
 * 【核心新增】開始情報探詢的API，處理一次性付費
 * @route POST /api/beggar/start-inquiry
 */
router.post('/start-inquiry', async (req, res) => {
    try {
        const userId = req.user.id;
        const playerProfile = await getInventoryState(userId);
        if (!playerProfile) {
            return res.status(404).json({ message: '找不到玩家檔案。' });
        }

        const result = await beggarService.startInquirySession(userId, playerProfile);
        res.json(result);

    } catch (error) {
        // 特別處理銀兩不足的錯誤
        if (error.message === '銀兩不足') {
            return res.status(402).json({ success: false, message: '您的銀兩不足以支付情報費用。' });
        }
        console.error('[丐幫路由] /start-inquiry 錯誤:', error);
        res.status(500).json({ message: '開啟情報對話時發生未知錯誤。' });
    }
});


/**
 * 【核心修改】處理玩家的單次提問 (不再收費)
 * @route POST /api/beggar/ask
 */
router.post('/ask', async (req, res) => {
    try {
        const userId = req.user.id;
        const { beggarName, userQuery, model } = req.body;

        if (!beggarName || !userQuery) {
            return res.status(400).json({ message: '缺少必要的探訪資訊。' });
        }

        const playerProfile = await getInventoryState(userId);
        if (!playerProfile) {
            return res.status(404).json({ message: '找不到玩家檔案。' });
        }
        
        const result = await beggarService.getInquiryResponse(userId, playerProfile, beggarName, userQuery, model);
        res.json(result);

    } catch (error) {
        console.error('[丐幫路由] /ask 錯誤:', error);
        res.status(500).json({ message: error.message || '打聽情報時發生未知錯誤。' });
    }
});

module.exports = router;
