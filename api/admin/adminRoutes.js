// api/adminRoutes.js
const express = require('express');
const router = express.Router();
const adminAuth = require('./admin/adminAuth');
const { getLogs, getPlayersWithLogs } = require('./admin/logService');
const { getApiBalances } = require('./admin/balanceService');

// 所有後台 API 都需要通過 adminAuth 中間件的驗證
router.use(adminAuth);

/**
 * @route   GET /api/admin/logs
 * @desc    獲取後端日誌，可按玩家ID篩選
 * @access  Private (Admin)
 */
router.get('/logs', async (req, res) => {
    try {
        const { playerId, limit = 150 } = req.query;
        const logs = await getLogs(playerId || null, parseInt(limit));
        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @route   GET /api/admin/players
 * @desc    獲取所有有日誌記錄的玩家列表
 * @access  Private (Admin)
 */
router.get('/players', async (req, res) => {
    try {
        const players = await getPlayersWithLogs();
        res.json(players);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});


/**
 * @route   GET /api/admin/balances
 * @desc    獲取AI API的餘額資訊
 * @access  Private (Admin)
 */
router.get('/balances', async (req, res) => {
    try {
        const balances = await getApiBalances();
        res.json(balances);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});


module.exports = router;
