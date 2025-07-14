// /api/npcRoutes.js
const express = require('express');
const router = express.Router();

// 引入新拆分的路由模組
const profileRoutes = require('./routes/npcProfileRoutes');
const chatRoutes = require('./routes/npcChatRoutes');
const tradeRoutes = require('./routes/npcTradeRoutes'); // 【核心新增】引入交易路由

// 將不同的路徑前綴，交給對應的路由模組處理
router.use('/', profileRoutes); // 處理 /api/game/npc/profile/:npcName
router.use('/', chatRoutes);  // 處理 /api/game/npc/chat, /give-item, /end-chat
router.use('/', tradeRoutes); // 【核心新增】處理 /api/game/npc/start-trade, /confirm-trade

module.exports = router;
