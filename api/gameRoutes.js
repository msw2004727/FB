// /api/gameRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');

// 引用三個新的路由模組
const gameplayRoutes = require('./gameplayRoutes');
const npcRoutes = require('./npcRoutes');
const combatRoutes = require('./combatRoutes');
const stateRoutes = require('./stateRoutes');

// 所有進入 /api/game 的請求，都必須先通過身份驗證
router.use(authMiddleware);

// 將不同的路徑，交給對應的路由模組處理
router.use('/play', gameplayRoutes);       // e.g., /api/game/play/interact
router.use('/npc', npcRoutes);          // e.g., /api/game/npc/npc-profile/王大夫
router.use('/combat', combatRoutes);    // e.g., /api/game/combat/initiate
router.use('/state', stateRoutes);      // e.g., /api/game/state/latest-game

// 這個總路由器現在只負責分發任務
module.exports = router;
