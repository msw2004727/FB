const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth');

const { getAIStory, getAISummary, getNarrative, getAIPrequel, getAISuggestion } = require('../services/aiService');

const db = admin.firestore();

router.use(authMiddleware);

router.post('/interact', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;

    try {
        const { action: playerAction, round: currentRound, model: modelName = 'gemini' } = req.body;

        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        const userProfile = userDoc.exists ? userDoc.data() : {};
        
        if (userProfile.isDeceased) {
            return res.status(403).json({ message: '逝者已矣，無法再有任何動作。' });
        }

        const summaryDocRef = userDocRef.collection('game_state').doc('summary');
        const summaryDoc = await summaryDocRef.get();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";

        let recentHistoryRounds = [];
        const memoryDepth = 3;
        if (currentRound > 0) {
            const roundsToFetch = Array.from({length: memoryDepth}, (_, i) => currentRound - i).filter(r => r > 0);
            if (roundsToFetch.length > 0) {
                const roundDocs = await userDocRef.collection('game_saves').where('R', 'in', roundsToFetch).get();
                roundDocs.forEach(doc => recentHistoryRounds.push(doc.data()));
                recentHistoryRounds.sort((a, b) => a.R - b.R);
            }
        }
        
        const aiResponse = await getAIStory(modelName, longTermSummary, JSON.stringify(recentHistoryRounds), playerAction, userProfile, username);
        if (!aiResponse) throw new Error("主AI未能生成有效回應。");

        const newRoundNumber = currentRound + 1;
        aiResponse.roundData.R = newRoundNumber;
        
        const novelCacheRef = userDocRef.collection('game_state').doc('novel_cache');

        if (aiResponse.roundData.playerState === 'dead') {
            await userDocRef.update({ isDeceased: true });
            aiResponse.suggestion = "你的江湖路已到盡頭...";
            const deathNarrative = await getNarrative(modelName, aiResponse.roundData);
            await novelCacheRef.set({ paragraphs: admin.firestore.FieldValue.arrayUnion({ text: deathNarrative, npcs: aiResponse.roundData.NPC || [] }) }, { merge: true });

        } else {
            const suggestion = await getAISuggestion(modelName, aiResponse.roundData);
            aiResponse.suggestion = suggestion;
            const newSummary = await getAISummary(modelName, longTermSummary, aiResponse.roundData);
            await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });
            
            const narrativeText = await getNarrative(modelName, aiResponse.roundData);
            await novelCacheRef.set({ paragraphs: admin.firestore.FieldValue.arrayUnion({ text: narrativeText, npcs: aiResponse.roundData.NPC || [] }) }, { merge: true });
        }

        await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData);

        res.json(aiResponse);

    } catch (error) {
        console.error(`[UserID: ${userId}] /interact 錯誤:`, error);
        res.status(500).json({ message: error.message || "互動時發生未知錯誤" });
    }
});


router.get('/latest-game', async (req, res) => {
    const userId = req.user.id;
    try {
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data();

        if (userData && userData.isDeceased) {
            return res.json({ gameState: 'deceased' });
        }
        
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

        // 【已修正】將此處寫死的 'gemini' 改為 'deepseek'
        const suggestion = await getAISuggestion('deepseek', latestGameData);

        res.json({
            prequel: prequel,
            story: `[進度已讀取] 你回到了 ${latestGameData.LOC[0]}，繼續你的冒險...`,
            roundData: latestGameData,
            suggestion: suggestion
        });

    } catch (error) {
        console.error(`[UserID: ${userId}] /latest-game 錯誤:`, error);
        res.status(500).json({ message: "讀取最新進度失敗。" });
    }
});

router.get('/get-novel', async (req, res) => {
    const userId = req.user.id;
    try {
        const novelCacheRef = db.collection('users').doc(userId).collection('game_state').doc('novel_cache');
        const novelCacheDoc = await novelCacheRef.get();

        if (novelCacheDoc.exists && novelCacheDoc.data().paragraphs) {
            res.json({ novel: novelCacheDoc.data().paragraphs });
        } else {
            const snapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
            if (snapshot.empty) {
                return res.json({ novel: [] });
            }
            
            const narrativePromises = snapshot.docs.map(async (doc) => {
                const roundData = doc.data();
                const narrativeText = await getNarrative('deepseek', roundData);
                return {
                    text: narrativeText,
                    npcs: roundData.NPC || [] 
                };
            });

            const novelParagraphs = await Promise.all(narrativePromises);
            
            await novelCacheRef.set({ paragraphs: novelParagraphs });
            
            res.json({ novel: novelParagraphs });
        }
    } catch (error) {
        console.error(`[UserID: ${userId}] /get-novel 錯誤:`, error);
        res.status(500).json({ message: "生成小說時出錯。" });
    }
});

router.post('/restart', async (req, res) => {
    const userId = req.user.id;
    try {
        const userDocRef = db.collection('users').doc(userId);
        
        const savesCollectionRef = userDocRef.collection('game_saves');
        const savesSnapshot = await savesCollectionRef.get();
        const batch = db.batch();
        savesSnapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        await userDocRef.collection('game_state').doc('summary').delete().catch(() => {});
        await userDocRef.collection('game_state').doc('suggestion').delete().catch(() => {});
        
        await userDocRef.collection('game_state').doc('novel_cache').delete().catch(() => {});
        
        await userDocRef.update({
            isDeceased: admin.firestore.FieldValue.delete()
        });
        
        res.status(200).json({ message: '新的輪迴已開啟，願你這次走得更遠。' });

    } catch (error) {
        console.error(`[UserID: ${userId}] /restart 錯誤:`, error);
        res.status(500).json({ message: '開啟新的輪迴時發生錯誤。' });
    }
});


module.exports = router;
