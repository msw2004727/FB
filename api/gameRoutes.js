const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth');

// 【已修改】導入 getAISuggestion 函式
const { getAIStory, getAISummary, getNarrative, getAIPrequel, getAISuggestion } = require('../services/aiService');

const db = admin.firestore();

router.use(authMiddleware);

// 【已修改】互動路由，加入獲取建議的邏輯
router.post('/interact', async (req, res) => {
    const userId = req.user.id;
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

        // 【新增】在產生主要故事後，非同步地獲取動作建議
        // 為了不拖慢主要回應時間，我們不使用 await，讓它在背景執行
        getAISuggestion(modelName, aiResponse.roundData).then(suggestion => {
            if (suggestion) {
                // 將建議儲存到一個新的地方，方便未來讀取
                const suggestionRef = db.collection('users').doc(userId).collection('game_state').doc('suggestion');
                suggestionRef.set({ text: suggestion, round: newRoundNumber });
            }
        });

        await db.collection('users').doc(userId).collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData);
        const newSummary = await getAISummary(modelName, longTermSummary, aiResponse.roundData);
        await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });

        res.json(aiResponse);
    } catch (error) {
        console.error(`[UserID: ${userId}] /interact 錯誤:`, error);
        res.status(500).json({ message: error.message || "互動時發生未知錯誤" });
    }
});

// 【已修改】讀取最新進度時，也一併讀取上次的建議
router.get('/latest-game', async (req, res) => {
    const userId = req.user.id;
    try {
        // ... (原有的讀取最新存檔邏輯保持不變) ...
        const snapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(7).get();
        if (snapshot.empty) {
            return res.status(404).json({ message: '找不到存檔紀錄。' });
        }
        const recentHistory = snapshot.docs.map(doc => doc.data());
        const latestGameData = recentHistory[0];

        let prequel = null;
        if (recentHistory.length > 1) {
            const historyForPrequel = [...recentHistory].reverse();
            prequel = await getAIPrequel('gemini', historyForPrequel);
        }

        // 【新增】讀取儲存的建議
        let suggestion = null;
        const suggestionRef = db.collection('users').doc(userId).collection('game_state').doc('suggestion');
        const suggestionDoc = await suggestionRef.get();
        if (suggestionDoc.exists) {
            suggestion = suggestionDoc.data().text;
        }

        res.json({
            prequel: prequel,
            story: `[進度已讀取] 你回到了 ${latestGameData.LOC[0]}，繼續你的冒險...`,
            roundData: latestGameData,
            suggestion: suggestion // 【新增】將建議加入到回傳資料中
        });

    } catch (error) {
        console.error(`[UserID: ${userId}] /latest-game 錯誤:`, error);
        res.status(500).json({ message: "讀取最新進度失敗。" });
    }
});


router.get('/get-novel', async (req, res) => {
    const userId = req.user.id;
    try {
        const snapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
        if (snapshot.empty) {
            return res.json({ novel: ["您的故事還未寫下第一筆..."] });
        }
        
        const narrativePromises = snapshot.docs.map(async (doc) => {
            const roundData = doc.data();
            const narrativeText = await getNarrative('gemini', roundData);
            
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
