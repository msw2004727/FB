const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth');
const { loadPrompts } = require('../services/worldviewManager');
const { getAIStory, getAISummary, getAIPrequel, getNarrative, getAISuggestion } = require('../services/aiService');

const db = admin.firestore();

// --- 【新增】遊戲資料庫路徑管理中心 ---
// 這個函式是所有資料庫操作的基礎，負責根據世界觀生成正確的 Firestore 路徑。
const getGamePaths = (userId, worldview) => {
    if (!userId || !worldview) {
        // 在早期日誌中，我們看到 userId 有時是 undefined，增加這個防錯可以讓問題更早被發現。
        console.error(`[getGamePaths Error] userId 或 worldview 無效。 userId: ${userId}, worldview: ${worldview}`);
        throw new Error("生成遊戲路徑時，缺少有效的 userId 或 worldview。");
    }
    // 新的巢狀結構路徑
    const worldDocRef = db.collection('users').doc(userId).collection('worlds').doc(worldview);
    
    return {
        userDocRef: db.collection('users').doc(userId), // 使用者主文件參考 (用於讀取/更新 isDeceased 等)
        worldDocRef: worldDocRef, // 特定世界觀的狀態文件參考 (用於儲存能力值、時間等)
        savesCollectionRef: worldDocRef.collection('game_saves'), // 特定世界觀的存檔集合參考
        summaryDocRef: worldDocRef.collection('game_state').doc('summary'), // 特定世界觀的摘要文件參考
        novelCacheRef: worldDocRef.collection('game_state').doc('novel_cache'), // 特定世界觀的小說快取參考
    };
};

const timeSequence = ['清晨', '上午', '中午', '下午', '黃昏', '夜晚', '深夜'];

router.use(authMiddleware);

router.post('/interact', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;

    try {
        const { action: playerAction, round: currentRound, model: modelName = 'gemini' } = req.body;

        const userDocForRead = db.collection('users').doc(userId);
        const userDoc = await userDocForRead.get();
        const userProfile = userDoc.exists ? userDoc.data() : {};
        
        if (userProfile.isDeceased) {
            return res.status(403).json({ message: '逝者已矣，無法再有任何動作。' });
        }
        
        const worldview = userProfile.worldview || 'wuxia';
        const prompts = loadPrompts(worldview);
        const paths = getGamePaths(userId, worldview);

        const worldDoc = await paths.worldDocRef.get();
        const worldData = worldDoc.exists ? worldDoc.data() : {};

        const currentTimeOfDay = worldData.timeOfDay || '上午';
        const playerPower = {
            internal: worldData.internalPower || 5,
            external: worldData.externalPower || 5,
            machineSync: worldData.machineSync || 5,
            pilotSkill: worldData.pilotSkill || 5,
        };

        const summaryDoc = await paths.summaryDocRef.get();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";

        let recentHistoryRounds = [];
        const memoryDepth = 3;
        if (currentRound > 0) {
            const roundsToFetch = Array.from({length: memoryDepth}, (_, i) => currentRound - i).filter(r => r > 0);
            if (roundsToFetch.length > 0) {
                const roundDocs = await paths.savesCollectionRef.where('R', 'in', roundsToFetch).get();
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
        
        const powerChange = aiResponse.roundData.powerChange || {};
        const newPowers = {
            timeOfDay: nextTimeOfDay,
            internalPower: Math.max(0, Math.min(999, playerPower.internal + (powerChange.internal || 0))),
            externalPower: Math.max(0, Math.min(999, playerPower.external + (powerChange.external || 0))),
            machineSync: Math.max(0, Math.min(999, playerPower.machineSync + (powerChange.machineSync || 0))),
            pilotSkill: Math.max(0, Math.min(999, playerPower.pilotSkill + (powerChange.pilotSkill || 0))),
        };
        await paths.worldDocRef.set(newPowers, { merge: true });

        if (aiResponse.roundData.playerState === 'dead') {
            await paths.userDocRef.update({ isDeceased: true });
            aiResponse.suggestion = "你的旅程已到盡頭...";
            aiResponse.roundData.timeOfDay = currentTimeOfDay;
            const deathNarrative = await getNarrative(modelName, aiResponse.roundData, prompts.getNarrativePrompt);
            await paths.novelCacheRef.set({ paragraphs: admin.firestore.FieldValue.arrayUnion({ text: deathNarrative, npcs: aiResponse.roundData.NPC || [] }) }, { merge: true });
        } else {
            const suggestion = await getAISuggestion(modelName, aiResponse.roundData, prompts.getSuggestionPrompt);
            aiResponse.suggestion = suggestion;
            const newSummary = await getAISummary(modelName, longTermSummary, aiResponse.roundData, prompts.getSummaryPrompt);
            await paths.summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });
            
            const narrativeText = await getNarrative(modelName, aiResponse.roundData, prompts.getNarrativePrompt);
            await paths.novelCacheRef.set({ paragraphs: admin.firestore.FieldValue.arrayUnion({ text: narrativeText, npcs: aiResponse.roundData.NPC || [] }) }, { merge: true });
        }

        await paths.savesCollectionRef.doc(`R${newRoundNumber}`).set(aiResponse.roundData);

        aiResponse.worldview = worldview;
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
            return res.json({ gameState: 'deceased', worldview: userData.worldview || 'wuxia' });
        }
        
        const worldview = userData.worldview || 'wuxia';
        const prompts = loadPrompts(worldview);
        const paths = getGamePaths(userId, worldview);

        const snapshot = await paths.savesCollectionRef.orderBy('R', 'desc').limit(7).get();
        if (snapshot.empty) {
            return res.status(404).json({ message: '找不到存檔紀錄。', worldview });
        }
        
        const recentHistory = snapshot.docs.map(doc => doc.data()).filter(data => data != null);
        if (recentHistory.length === 0) {
            return res.status(404).json({ message: '找不到有效的存檔紀錄。', worldview });
        }

        const latestGameData = recentHistory[0];
        const worldDoc = await paths.worldDocRef.get();
        const worldData = worldDoc.exists ? worldDoc.data() : {};

        Object.assign(latestGameData, worldData);

        let prequel = null;
        if (recentHistory.length > 1) {
            const historyForPrequel = [...recentHistory].reverse();
            prequel = await getAIPrequel('deepseek', historyForPrequel, prompts.getPrequelPrompt);
        }
        
        const suggestion = await getAISuggestion('deepseek', latestGameData, prompts.getSuggestionPrompt);
        const locationName = latestGameData?.LOC?.[0] || '一個未知的地方';

        res.json({
            worldview,
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
        const paths = getGamePaths(userId, worldview); // 【修改】使用路徑管理器

        const novelCacheDoc = await paths.novelCacheRef.get();

        if (novelCacheDoc.exists && novelCacheDoc.data().paragraphs) {
            res.json({ novel: novelCacheDoc.data().paragraphs });
        } else {
            const snapshot = await paths.savesCollectionRef.orderBy('R', 'asc').get();
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
            
            await paths.novelCacheRef.set({ paragraphs: novelParagraphs });
            
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
        const userDoc = await userDocRef.get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const worldview = userData.worldview || 'wuxia';
        const paths = getGamePaths(userId, worldview); // 【修改】使用路徑管理器

        const savesSnapshot = await paths.savesCollectionRef.get();
        const batch = db.batch();
        savesSnapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        await paths.summaryDocRef.delete().catch(() => {});
        await paths.novelCacheRef.delete().catch(() => {});
        await paths.worldDocRef.delete().catch(() => {}); // 刪除世界狀態文件
        
        // 只重置 isDeceased 狀態，保留使用者帳號和世界觀選擇
        await userDocRef.update({
            isDeceased: admin.firestore.FieldValue.delete(),
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
        const paths = getGamePaths(userId, worldview); // 【修改】使用路徑管理器

        await paths.userDocRef.update({ isDeceased: true });

        const savesSnapshot = await paths.savesCollectionRef.orderBy('R', 'desc').limit(1).get();
        const lastRound = savesSnapshot.empty ? 0 : savesSnapshot.docs[0].data().R;
        const newRoundNumber = lastRound + 1;

        // 【修改】這裡的自殺場景可能也需要根據世界觀動態生成，但暫時使用通用版本
        const finalRoundData = {
            R: newRoundNumber,
            playerState: 'dead',
            timeOfDay: '未知',
            ATM: ['決絕', '悲壯'],
            EVT: '終結',
            LOC: ['原地', {}],
            PSY: '一切都結束了。',
            PC: `${username}選擇了終結自己的旅程。`,
            NPC: [], ITM: '', QST: '', WRD: '', LOR: '', CLS: '', IMP: ''
        };

        const finalNarrative = await getNarrative('deepseek', finalRoundData, prompts.getNarrativePrompt);
        
        await paths.novelCacheRef.set({ 
            paragraphs: admin.firestore.FieldValue.arrayUnion({ text: finalNarrative, npcs: [] }) 
        }, { merge: true });
        
        await paths.savesCollectionRef.doc(`R${newRoundNumber}`).set(finalRoundData);
        
        res.json({
            story: finalNarrative,
            roundData: finalRoundData,
            suggestion: '你的旅程已到盡頭...'
        });

    } catch (error) {
        console.error(`[UserID: ${userId}] /force-suicide 錯誤:`, error);
        res.status(500).json({ message: '了此殘生時發生未知錯誤...' });
    }
});

module.exports = router;
