// /api/gameplayRoutes.js
const express = require('express');
const router = express.Router();

// 引用兩個新的路由模組
const interactionRoutes = require('./interactionRoutes');
const combatRoutes = require('./combatRoutes');

// 將對應的請求分發給它們處理
router.use(interactionRoutes);
router.use(combatRoutes); // 【核心修改】新增這一行，讓主路由認識戰鬥路由

module.exports = router;
