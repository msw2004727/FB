const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth'); // Import the guard

// Import AI services (assuming they are in ../services/aiService.js)
const { getAIStory, getAISummary, getNarrative } = require('../services/aiService');

const db = admin.firestore();

// IMPORTANT: Apply the middleware to all routes in this file
router.use(authMiddleware);

// API Route: /api/game/interact
router.post('/interact', async (req, res) => {
    const userId = req.user.id; // Get user ID from the middleware
    try {
        const { action: playerAction, round: currentRound, model: modelName = 'gemini' } = req.body;
        
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        const summaryDoc = await summaryDocRef.get();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";

        let recentHistoryRounds = [];
        const memoryDepth = 3;
        if (currentRound > 0) {
            const roundsToFetch = Array.from({length: memoryDepth}, (_, i) => currentRound - i).filter(r => r > 0);
            const roundDocs = await db.collection('users').doc(userId).collection('game_saves').where('R', 'in', roundsToFetch).get();
            roundDocs.forEach(doc => recentHistoryRounds.push(doc.data()));
            recentHistoryRounds.sort((a, b) => a.R - b.R);
        }
        
        const aiResponse = await getAIStory(modelName, longTermSummary, JSON.stringify(recentHistoryRounds), playerAction);
        if (!aiResponse) throw new Error("主AI未能生成有效回應。");

        const newRoundNumber = currentRound + 1;
        aiResponse.roundData.R = newRoundNumber;

        await db.collection('users').doc(userId).collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData);
        const newSummary = await getAISummary(modelName, longTermSummary, aiResponse.roundData);
        await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });

        res.json(aiResponse);
    } catch (error) {
        console.error(`[UserID: ${userId}] /interact 錯誤:`, error);
        res.status(500).json({ message: error.message || "互動時發生未知錯誤" });
    }
});

// API Route: /api/game/latest-game
router.get('/latest-game', async (req, res) => {
    const userId = req.user.id;
    try {
        const snapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get();
        if (snapshot.empty) {
            return res.status(404).json({ message: '找不到存檔紀錄。' });
        }
        const latestGameData = snapshot.docs[0].data();
        res.json({
            story: `[進度已讀取] 你回到了 ${latestGameData.LOC[0]}，繼續你的冒險...`,
            roundData: latestGameData
        });
    } catch (error) {
        console.error(`[UserID: ${userId}] /latest-game 錯誤:`, error);
        res.status(500).json({ message: "讀取最新進度失敗。" });
    }
});

// API Route: /api/game/get-novel
router.get('/get-novel', async (req, res) => {
    const userId = req.user.id;
    try {
        const snapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
        if (snapshot.empty) {
            return res.status(404).json({ novel: [] });
        }
        const narrativePromises = snapshot.docs.map(doc => getNarrative('gemini', doc.data()));
        const novelParagraphs = await Promise.all(narrativePromises);
        res.json({ novel: novelParagraphs });
    } catch (error) {
        console.error(`[UserID: ${userId}] /get-novel 錯誤:`, error);
        res.status(500).json({ message: "生成小說時出錯。" });
    }
});

module.exports = router;
