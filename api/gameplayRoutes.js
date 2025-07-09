// /api/gameplayRoutes.js
const express = require('express');
const router = express.Router();

// 引用兩個新的路由模組
const interactionRoutes = require('./interactionRoutes');
const combatRoutes = require('./combatRoutes');

// 將對應的請求分發給它們處理
// 例如，當請求進來時，這個路由器會檢查 interactionRoutes 和 combatRoutes 是否有對應的處理方式
router.use(interactionRoutes);
router.use(combatRoutes);

// 這個總路由器現在只負責分發任務
module.exports = router;
