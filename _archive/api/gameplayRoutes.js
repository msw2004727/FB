// /api/gameplayRoutes.js
const express = require('express');
const router = express.Router();

// 【核心修改】引用拆分後的 interactionRoutes 和 combatRoutes
const interactionRoutes = require('./interactionRoutes');
const combatRoutes = require('./combatRoutes');

// 將對應的請求分發給它們處理
router.use(interactionRoutes);
router.use(combatRoutes);

module.exports = router;
