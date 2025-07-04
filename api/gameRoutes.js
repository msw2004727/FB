const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth'); // 導入身份驗證守衛

// 【已修改】導入 getAIPrequel 函式
const { getAIStory, getAISummary, getNarrative, getAIPrequel } = require('../services/aiService');

const db = admin.firestore();

// 【重要】將守衛應用於此檔案中的所有路由
router.use(authMiddleware);

// API 路由: /api/game/interact
router.post('/interact', async (req, res) => {
    const userId = req.user.id; // 從守衛中取得使用者 ID
    try {
        const { action: playerAction, round: currentRound, model: modelName = 'gemini' } = req.body;

        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        const userProfile = userDoc.exists ? userDoc.data() : {};

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
        
        const aiResponse = await getAIStory(modelName, longTermSummary, JSON.stringify(recentHistoryRounds), playerAction, userProfile);
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
// 【已修改】此路由的邏輯已大幅更新，以產生前情提要
router.get('/latest-game', async (req, res) => {
    const userId = req.user.id;
    try {
        // 讀取最近的 7 筆紀錄來生成摘要
        const snapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(7).get();
        
        if (snapshot.empty) {
            return res.status(404).json({ message: '找不到存檔紀錄。' });
        }

        const recentHistory = snapshot.docs.map(doc => doc.data());
        const latestGameData = recentHistory[0]; // 最新的紀錄 (R最大)

        let prequel = null;
        // 只有在有多於一筆紀錄時，生成前情提要才有意義
        if (recentHistory.length > 1) {
            // 將歷史紀錄反轉，讓AI按照時間順序閱讀
            const historyForPrequel = [...recentHistory].reverse();
            // 使用預設的 gemini 模型來生成摘要，以節省成本
            prequel = await getAIPrequel('gemini', historyForPrequel);
        }

        res.json({
            prequel: prequel, // 新增的欄位，可能是摘要文字或 null
            story: `[進度已讀取] 你回到了 ${latestGameData.LOC[0]}，繼續你的冒E險...`,
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
            return res.json({ novel: ["您的故事還未寫下第一筆..."] });
        }
        
        // 【已修改】在生成小說時，也為每一段高亮NPC
        const narrativePromises = snapshot.docs.map(async (doc) => {
            const roundData = doc.data();
            const narrativeText = await getNarrative('gemini', roundData);
            
            // 返回包含高亮所需資料的物件
            return {
                text: narrativeText,
                npcs: roundData.NPC || [] 
            };
        });

        const novelParagraphs = await Promise.all(narrativePromises);
        res.json({ novel: novelParagraphs });

    } catch (error) {
        console.error(`[UserID: ${userId}] /get-novel 錯誤:`, error);
        res.status(500).json({ message: "生成小說時出錯。" });
    }
});

module.exports = router;
