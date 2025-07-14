// /api/inventoryRoutes.js
const express = require('express');
const router = express.Router();
const inventoryModel = require('./models/inventoryModel');
const { getRawInventory, calculateBulkScore } = require('./playerStateHelpers');
const authMiddleware = require('../middleware/auth');

// 所有此路由下的請求都需要先經過身份驗證
router.use(authMiddleware);

// 裝備物品
const equipItemHandler = async (req, res) => {
    const userId = req.user.id;
    const { instanceId } = req.params;
    
    console.log(`[API路由] 收到玩家 ${userId} 的裝備請求，物品實例ID: ${instanceId}`);

    if (!instanceId) {
        return res.status(400).json({ success: false, message: '請求中缺少物品實例ID。' });
    }

    try {
        const result = await inventoryModel.equipItem(userId, instanceId);
        
        const inventory = await getRawInventory(userId);
        const bulkScore = calculateBulkScore(inventory);

        console.log(`[API路由] 玩家 ${userId} 裝備成功: ${result.message}`);
        res.json({
            success: true,
            message: result.message,
            inventory: inventory,
            bulkScore: bulkScore
        });

    } catch (error) {
        console.error(`[API路由-錯誤] 玩家 ${userId} 裝備物品 ${instanceId} 時出錯:`, error);
        res.status(500).json({ success: false, message: error.message || "裝備操作失敗" });
    }
};

// 卸下裝備
const unequipItemHandler = async (req, res) => {
    const userId = req.user.id;
    const { instanceId } = req.params;

    console.log(`[API路由] 收到玩家 ${userId} 的卸下請求，物品實例ID: ${instanceId}`);
    
    if (!instanceId) {
        return res.status(400).json({ success: false, message: '請求中缺少物品實例ID。' });
    }

    try {
        const result = await inventoryModel.unequipItem(userId, instanceId);

        const inventory = await getRawInventory(userId);
        const bulkScore = calculateBulkScore(inventory);
        
        console.log(`[API路由] 玩家 ${userId} 卸下成功: ${result.message}`);
        res.json({
            success: true,
            message: result.message,
            inventory: inventory,
            bulkScore: bulkScore
        });

    } catch (error) {
        console.error(`[API路由-錯誤] 玩家 ${userId} 卸下物品 ${instanceId} 時出錯:`, error);
        res.status(500).json({ success: false, message: error.message || "卸下操作失敗" });
    }
};

router.post('/equip/:instanceId', equipItemHandler);
router.post('/unequip/:instanceId', unequipItemHandler);

module.exports = router;
