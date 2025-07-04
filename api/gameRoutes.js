const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth'); // 導入身份驗證守衛

// 導入 AI 服務 (假設檔案路徑正確)
const { getAIStory, getAISummary, getNarrative } = require('../services/aiService');

const db = admin.firestore();

// 【重要】將守衛應用於此檔案中的所有路由
// 任何訪問 /api/game/* 的請求，都必須先通過 authMiddleware 的檢查
router.use(authMiddleware);

// API 路由: /api/game/interact
router.post('/interact', async (req, res) => {
    const userId = req.user.id; // 從守衛中取得使用者 ID
    try {
        const { action: playerAction, round: currentRound, model: modelName = 'gemini' } = req.body;
        
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        const summaryDoc = await summaryDocRef.get();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";

        let recentHistoryRounds = [];
        const memoryDepth = 3;
        if (currentRound > 0) {
            const roundsToFetch = Array.from({length: memoryDepth}, (_, i) => currentRound - i).filter(r => r > 0);
            if (roundsToFetch.length > 0) {
                const roundDocs = await db.collection('users').doc(userId).collection('game_saves').where('R', 'in', roundsToFetch).get();
                roundDocs.forEach(doc => recentHistoryRounds.push(doc.data()));
                recentHistoryRounds.sort((a, b) => a.R - b.R);
            }
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

// API 路由: /api/game/latest-game
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

// API 路由: /api/game/get-novel
router.get('/get-novel', async (req, res) => {
    const userId = req.user.id;
    try {
        const snapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
        if (snapshot.empty) {
            // 返回一個空的 novel 陣列，而不是 404，這樣前端更容易處理
            return res.json({ novel: ["您的故事還未寫下第一筆..."] });
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
