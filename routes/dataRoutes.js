// routes/dataRoutes.js

const express = require('express');
const admin = require('firebase-admin');
const { getNarrative, getAIEncyclopedia } = require('../services/aiService.js');

const router = express.Router();
const db = admin.firestore();

// 獲取小說
router.get('/get-novel', async (req, res) => {
    const userId = req.user.id;
    try {
        const novelCacheRef = db.collection('users').doc(userId).collection('game_state').doc('novel_cache');
        const novelCacheDoc = await novelCacheRef.get();

        if (novelCacheDoc.exists && novelCacheDoc.data().paragraphs) {
            console.log(`[小說系統] 從快取中讀取小說...`);
            return res.json({ novel: novelCacheDoc.data().paragraphs });
        } 
        
        console.log(`[小說系統] 快取不存在，開始即時生成小說...`);
        const snapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
        if (snapshot.empty) {
            return res.json({ novel: [] });
        }
        
        const narrativePromises = snapshot.docs.map(doc => {
            const roundData = doc.data();
            return getNarrative('deepseek', roundData).then(narrativeText => {
                return {
                    text: narrativeText,
                    npcs: roundData.NPC || [] 
                };
            });
        });

        const novelParagraphs = await Promise.all(narrativePromises);
        
        await novelCacheRef.set({ paragraphs: novelParagraphs });
        console.log(`[小說系統] 小說生成完畢並已存入快取。`);
        
        res.json({ novel: novelParagraphs });
        
    } catch (error) {
        console.error(`[UserID: ${userId}] /get-novel 錯誤:`, error);
        res.status(500).json({ message: "生成小說時出錯。" });
    }
});

// 獲取百科
router.get('/get-encyclopedia', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        const summaryDoc = await summaryDocRef.get();

        if (!summaryDoc.exists || !summaryDoc.data().text) {
            return res.json({ encyclopediaHtml: '<p class="loading">你的江湖經歷尚淺，還沒有可供編撰的百科內容。</p>' });
        }

        const longTermSummary = summaryDoc.data().text;
        
        const encyclopediaHtml = await getAIEncyclopedia('deepseek', longTermSummary, username);
        
        res.json({ encyclopediaHtml });

    } catch (error) {
        console.error(`[UserID: ${userId}] /get-encyclopedia 錯誤:`, error);
        res.status(500).json({ message: "編撰百科時發生未知錯誤。" });
    }
});

module.exports = router;
