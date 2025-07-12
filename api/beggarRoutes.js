// /api/beggarRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const beggarService = require('../services/beggarService');
const { getInventoryState } = require('./playerStateHelpers'); // 【核心修正】引入標準的玩家狀態獲取函式

// 所有丐幫路由都需要身份驗證
router.use(authMiddleware);

/**
 * @route   POST /api/beggar/summon
 * @desc    玩家呼叫丐幫，請求一名弟子前來
 * @access  Private
 */
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
 * @route   POST /api/beggar/inquire
 * @desc    玩家向丐幫弟子付費打聽情報
 * @access  Private
 */
router.post('/inquire', async (req, res) => {
    try {
        const userId = req.user.id;
        const { beggarName, userQuery, model } = req.body;

        if (!beggarName || !userQuery) {
            return res.status(400).json({ message: '缺少必要的探訪資訊。' });
        }

        // 【核心修正】使用 getInventoryState 來獲取包含準確銀兩數量的玩家資料
        const playerProfile = await getInventoryState(userId);
        if (!playerProfile) {
            return res.status(404).json({ message: '找不到玩家檔案。' });
        }
        
        // 將最準確的玩家資料傳遞給服務層
        const result = await beggarService.handleBeggarInquiry(userId, playerProfile, beggarName, userQuery, model);
        res.json(result);

    } catch (error) {
        console.error('[丐幫路由] /inquire 錯誤:', error);
        res.status(500).json({ message: error.message || '打聽情報時發生未知錯誤。' });
    }
});

module.exports = router;
