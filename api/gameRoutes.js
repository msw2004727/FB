// api/gameRoutes.js

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// 導入 AI 服務
const { getNarrative, getAISummary, getAIStory } = require('../services/aiService');

const db = admin.firestore();

// 核心互動路由
router.post('/interact', async (req, res) => {
    try {
        const { action: playerAction, round: currentRound, model: modelName = 'gemini' } = req.body;
        console.log(`[API /interact] 接收到玩家行動 (R${currentRound}), 請求模型: ${modelName}`);

        const summaryDocRef = db.collection('game_state').doc('summary');
        const summaryDoc = await summaryDocRef.get();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";

        let recentHistoryRounds = [];
        const memoryDepth = 3;
        if (currentRound > 0) {
            const queries = Array.from({ length: memoryDepth }, (_, i) => {
                const roundToFetch = currentRound - i;
                return roundToFetch > 0 ? db.collection('game_saves').doc(`R${roundToFetch}`).get() : null;
            }).filter(Boolean);

            const snapshots = await Promise.all(queries);
            snapshots.forEach(doc => doc.exists && recentHistoryRounds.push(doc.data()));
            recentHistoryRounds.sort((a, b) => a.R - b.R);
        }
        const recentHistoryJson = JSON.stringify(recentHistoryRounds, null, 2);

        const aiResponse = await getAIStory(modelName, longTermSummary, recentHistoryJson, playerAction);

        if (!aiResponse || !aiResponse.roundData) throw new Error("主AI未能生成有效的JSON回應。");

        const newRoundNumber = currentRound + 1;
        aiResponse.roundData.R = newRoundNumber;

        await db.collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData);
        const newSummary = await getAISummary(modelName, longTermSummary, aiResponse.roundData);
        await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });

        res.json(aiResponse);

    } catch (error) {
        console.error("[API /interact] 處理請求時發生嚴重錯誤:", error);
        res.status(500).json({
            story: `[系統內部錯誤] ${error.message}`,
            roundData: { R: req.body.round, EVT: "系統錯誤" }
        });
    }
});

// 其他路由...
router.get('/latest-game', async (req, res) => { /* ... 之前的邏輯 ... */ });
router.get('/get-novel', async (req, res) => { /* ... 之前的邏輯 ... */ });

module.exports = router;
