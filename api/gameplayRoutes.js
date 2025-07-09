// /api/gameplayRoutes.js
const express = require('express');
const router = express.Router();

// 引用兩個新的路由模組
const interactionRoutes = require('./interactionRoutes');
const combatRoutes = require('./combatRoutes');

// 將對應的請求分發給它們處理
router.use(interactionRoutes);
router.use(combatRoutes);

module.exports = router;
