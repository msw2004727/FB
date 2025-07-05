const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth');

// 【新增】引入世界觀管理器
const { loadPrompts } = require('../services/worldviewManager');

const { getAIStory, getAISummary, getAIPrequel, getNarrative, getAISuggestion } = require('../services/aiService');

const db = admin.firestore();

const timeSequence = ['清晨', '上午', '中午', '下午', '黃昏', '夜晚', '深夜'];

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
        
        // 【已修改】從使用者資料讀取世界觀，如果沒有則使用預設值
        const worldview = userProfile.worldview || 'wuxia';
        const prompts = loadPrompts(worldview); // 動態載入對應的 Prompts

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
        
        const aiResponse = await getAIStory(modelName, longTermSummary, JSON.stringify(recentHistoryRounds), playerAction, userProfile, username, currentTimeOfDay, playerPower, prompts.getStoryPrompt);
        if (!aiResponse) throw new Error("主AI未能生成有效回應。");

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


        const novelCacheRef = userDocRef.collection('game_state').doc('novel_cache');

        if (aiResponse.roundData.playerState === 'dead') {
            await userDocRef.update({ isDeceased: true });
            aiResponse.suggestion = "你的江湖路已到盡頭...";
            aiResponse.roundData.timeOfDay = currentTimeOfDay;
            const deathNarrative = await getNarrative(modelName, aiResponse.roundData, prompts.getNarrativePrompt);
            await novelCacheRef.set({ paragraphs: admin.firestore.FieldValue.arrayUnion({ text: deathNarrative, npcs: aiResponse.roundData.NPC || [] }) }, { merge: true });

        } else {
            const suggestion = await getAISuggestion(modelName, aiResponse.roundData, prompts.getSuggestionPrompt);
            aiResponse.suggestion = suggestion;
            const newSummary = await getAISummary(modelName, longTermSummary, aiResponse.roundData, prompts.getSummaryPrompt);
            await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });
            
            const narrativeText = await getNarrative(modelName, aiResponse.roundData, prompts.getNarrativePrompt);
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
        const userData = userDoc.exists ? userDoc.data() : {};

        if (userData && userData.isDeceased) {
            return res.json({ gameState: 'deceased' });
        }
        
        const worldview = userData.worldview || 'wuxia';
        const prompts = loadPrompts(worldview);

        const snapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(7).get();
        if (snapshot.empty) {
            return res.status(404).json({ message: '找不到存檔紀錄。' });
        }
        
        const recentHistory = snapshot.docs
            .map(doc => doc.data())
            .filter(data => data != null);

        if (recentHistory.length === 0) {
            return res.status(404).json({ message: '找不到有效的存檔紀錄。' });
        }

        const latestGameData = recentHistory[0];

        latestGameData.timeOfDay = latestGameData.timeOfDay || userData.timeOfDay || '上午';
        latestGameData.internalPower = userData.internalPower || 5;
        latestGameData.externalPower = userData.externalPower || 5;

        let prequel = null;
        if (recentHistory.length > 1) {
            const historyForPrequel = [...recentHistory].reverse();
            prequel = await getAIPrequel('deepseek', historyForPrequel, prompts.getPrequelPrompt);
        }
        
        const suggestion = await getAISuggestion('deepseek', latestGameData, prompts.getSuggestionPrompt);

        const locationName = latestGameData?.LOC?.[0] || '一個未知的地方';

        res.json({
            prequel: prequel,
            story: `[進度已讀取] 你回到了 ${locationName}，繼續你的冒險...`,
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
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const worldview = userData.worldview || 'wuxia';
        const prompts = loadPrompts(worldview);

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
                const narrativeText = await getNarrative('deepseek', roundData, prompts.getNarrativePrompt);
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
        
        const worldview = userProfile.worldview || 'wuxia';
        const prompts = loadPrompts(worldview);

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

        const finalNarrative = await getNarrative('deepseek', finalRoundData, prompts.getNarrativePrompt);
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
