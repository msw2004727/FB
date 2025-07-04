const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth');

const { getAIStory, getAISummary, getNarrative, getAIPrequel, getAISuggestion } = require('../services/aiService');

const db = admin.firestore();

const timeSequence = ['清晨', '上午', '中午', '下午', '黃昏', '夜晚', '深夜'];

router.use(authMiddleware);

// 【已修改】此路由現在會將資料以串流形式推送給前端
router.post('/interact', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;

    try {
        // --- 1. 正常接收請求與準備資料 ---
        const { action: playerAction, round: currentRound, model: modelName = 'gemini' } = req.body;

        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        const userProfile = userDoc.exists ? userDoc.data() : {};
        
        if (userProfile.isDeceased) {
            return res.status(403).json({ message: '逝者已矣，無法再有任何動作。' });
        }

        const currentTimeOfDay = userProfile.timeOfDay || '上午';
        const playerPower = {
            internal: userProfile.internalPower || 5,
            external: userProfile.externalPower || 5
        };

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
        
        const stream = await getAIStory(modelName, longTermSummary, JSON.stringify(recentHistoryRounds), playerAction, userProfile, username, currentTimeOfDay, playerPower);
        if (!stream) throw new Error("AI未能生成有效回應。");

        // --- 2. 在後端完整接收AI的回應 ---
        let fullResponseText = '';
        for await (const chunk of stream) {
            const chunkText = chunk.choices?.[0]?.delta?.content || chunk.text();
            fullResponseText += chunkText;
        }
        
        const cleanJsonText = fullResponseText.replace(/^```json\s*|```\s*$/g, '');
        const aiResponse = JSON.parse(cleanJsonText);

        // --- 3. 執行所有後端資料庫更新 ---
        const newRoundNumber = currentRound + 1;
        aiResponse.roundData.R = newRoundNumber;

        let nextTimeOfDay = currentTimeOfDay;
        if (aiResponse.roundData.shouldAdvanceTime) {
            const currentIndex = timeSequence.indexOf(currentTimeOfDay);
            const nextIndex = (currentIndex + 1) % timeSequence.length;
            nextTimeOfDay = timeSequence[nextIndex];
        }
        aiResponse.roundData.timeOfDay = nextTimeOfDay;

        const powerChange = aiResponse.roundData.powerChange || { internal: 0, external: 0 };
        const newInternalPower = Math.max(0, Math.min(999, playerPower.internal + powerChange.internal));
        const newExternalPower = Math.max(0, Math.min(999, playerPower.external + powerChange.external));
        
        aiResponse.roundData.internalPower = newInternalPower;
        aiResponse.roundData.externalPower = newExternalPower;
        
        await userDocRef.update({ 
            timeOfDay: nextTimeOfDay,
            internalPower: newInternalPower,
            externalPower: newExternalPower
        });
        
        const suggestion = await getAISuggestion(modelName, aiResponse.roundData);
        aiResponse.suggestion = suggestion; // 將建議也加入，稍後一起傳送

        // --- 4. 將結果以串流方式推送給前端 ---
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('X-Content-Type-Options', 'nosniff'); // 安全標頭
        
        // 4.1. 先將 roundData 和 suggestion 打包成 JSON 字串，一次性傳送
        const initialData = {
            roundData: aiResponse.roundData,
            suggestion: aiResponse.suggestion
        };
        res.write(JSON.stringify(initialData));

        // 4.2. 傳送一個明確的分隔符號
        res.write('\n<STREAM_SEPARATOR>\n');

        // 4.3. 逐字傳送故事內容，模擬打字效果
        const storyText = aiResponse.story;
        for (const char of storyText) {
            res.write(char);
            // 加入一個極短的延遲，讓打字效果更明顯
            await new Promise(resolve => setTimeout(resolve, 5)); 
        }

        // 4.4. 結束響應流
        res.end();

        // --- 5. 在背景完成不影響前端顯示的儲存工作 ---
        if (aiResponse.roundData.playerState === 'dead') {
            await userDocRef.update({ isDeceased: true });
        }
        const newSummary = await getAISummary(modelName, longTermSummary, aiResponse.roundData);
        await db.collection('users').doc(userId).collection('game_state').doc('summary').set({ text: newSummary, lastUpdated: newRoundNumber });
        
        const narrativeText = await getNarrative(modelName, aiResponse.roundData);
        await db.collection('users').doc(userId).collection('game_state').doc('novel_cache').set({ paragraphs: admin.firestore.FieldValue.arrayUnion({ text: narrativeText, npcs: aiResponse.roundData.NPC || [] }) }, { merge: true });

        await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData);

    } catch (error) {
        console.error(`[UserID: ${userId}] /interact 錯誤:`, error);
        // 如果在串流開始前出錯，可以回傳錯誤JSON
        if (!res.headersSent) {
            res.status(500).json({ message: error.message || "互動時發生未知錯誤" });
        } else {
            // 如果串流已經開始，只能中斷連線
            res.end();
        }
    }
});


// 其他路由... (保持不變)
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

        latestGameData.timeOfDay = latestGameData.timeOfDay || userData.timeOfDay || '上午';
        latestGameData.internalPower = userData.internalPower || 5;
        latestGameData.externalPower = userData.externalPower || 5;

        let prequel = null;
        if (recentHistory.length > 1) {
            const historyForPrequel = [...recentHistory].reverse();
            prequel = await getAIPrequel('deepseek', historyForPrequel);
        }
        
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
            isDeceased: admin.firestore.FieldValue.delete(),
            timeOfDay: admin.firestore.FieldValue.delete(),
            internalPower: admin.firestore.FieldValue.delete(),
            externalPower: admin.firestore.FieldValue.delete()
        });
        
        res.status(200).json({ message: '新的輪迴已開啟，願你這次走得更遠。' });

    } catch (error) {
        console.error(`[UserID: ${userId}] /restart 錯誤:`, error);
        res.status(500).json({ message: '開啟新的輪迴時發生錯誤。' });
    }
});

router.post('/force-suicide', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        const userProfile = userDoc.exists ? userDoc.data() : {};

        await userDocRef.update({ isDeceased: true });

        const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const lastRound = savesSnapshot.empty ? 0 : savesSnapshot.docs[0].data().R;
        const newRoundNumber = lastRound + 1;

        const finalRoundData = {
            R: newRoundNumber,
            playerState: 'dead',
            timeOfDay: userProfile.timeOfDay || '上午',
            internalPower: userProfile.internalPower || 5,
            externalPower: userProfile.externalPower || 5,
            ATM: ['決絕', '悲壯'],
            EVT: '英雄末路',
            LOC: ['原地', {}],
            PSY: '江湖路遠，就此終焉。',
            PC: `${username}引動內力，逆轉經脈，在一陣刺目的光芒中...化為塵土。`,
            NPC: [],
            ITM: '隨身物品盡數焚毀。',
            QST: '所有恩怨情仇，煙消雲散。',
            WRD: '一聲巨響傳遍數里，驚動了遠方的勢力。',
            LOR: '',
            CLS: '',
            IMP: '你選擇了以最壯烈的方式結束這段江湖行。'
        };

        const finalNarrative = await getNarrative('deepseek', finalRoundData);
        const novelCacheRef = userDocRef.collection('game_state').doc('novel_cache');
        await novelCacheRef.set({ 
            paragraphs: admin.firestore.FieldValue.arrayUnion({ text: finalNarrative, npcs: [] }) 
        }, { merge: true });
        
        await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(finalRoundData);
        
        res.json({
            story: finalNarrative,
            roundData: finalRoundData,
            suggestion: '你的江湖路已到盡頭...'
        });

    } catch (error) {
        console.error(`[UserID: ${userId}] /force-suicide 錯誤:`, error);
        res.status(500).json({ message: '了此殘生時發生未知錯誤...' });
    }
});


module.exports = router;
