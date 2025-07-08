// /api/stateRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIEncyclopedia, getRelationGraph, getAIPrequel, getAISuggestion, getAIDeathCause } = require('../services/aiService');
const { getInventoryState, invalidateNovelCache, updateLibraryNovel, getRawInventory, getPlayerSkills } = require('./gameHelpers');
const { generateAndCacheLocation } = require('./worldEngine');

const db = admin.firestore();

// 輔助函式，用於合併地點的靜態和動態資料
const getMergedLocationData = async (userId, locationName) => {
    if (!locationName) return null;

    try {
        const staticDocRef = db.collection('locations').doc(locationName);
        const dynamicDocRef = db.collection('users').doc(userId).collection('location_states').doc(locationName);

        const [staticDoc, dynamicDoc] = await Promise.all([
            staticDocRef.get(),
            dynamicDocRef.get()
        ]);

        if (!staticDoc.exists) {
            // 如果連靜態模板都不存在，說明是全新的地點，觸發背景生成
            console.log(`[讀取系統] 偵測到玩家 ${userId} 的全新地點: ${locationName}，將在背景生成...`);
            generateAndCacheLocation(userId, locationName, '未知', '初次抵達，資訊尚不明朗。')
                .catch(err => console.error(`[世界引擎] 地點 ${locationName} 的背景生成失敗:`, err));
            return {
                locationId: locationName,
                locationName: locationName,
                description: "此地詳情尚在傳聞之中...",
            };
        }
        
        // 如果靜態模板存在，但玩家的動態狀態不存在，也觸發一次初始化
        if (staticDoc.exists && !dynamicDoc.exists) {
             console.log(`[讀取系統] 模板存在，但玩家 ${userId} 的地點狀態不存在: ${locationName}，將在背景初始化...`);
             generateAndCacheLocation(userId, locationName, '未知', '初次抵達，資訊尚不明朗。')
                .catch(err => console.error(`[世界引擎] 地點 ${locationName} 的背景生成失敗:`, err));
        }

        const staticData = staticDoc.data() || {};
        const dynamicData = dynamicDoc.data() || {};

        // 合併資料：以靜態資料為基礎，用動態資料覆蓋
        return { ...staticData, ...dynamicData };

    } catch (error) {
        console.error(`[讀取系統] 合併地點 ${locationName} 的資料時出錯:`, error);
        return {
            locationId: locationName,
            locationName: locationName,
            description: "讀取此地詳情時發生錯誤...",
        };
    }
};


router.get('/inventory', async (req, res) => {
    try {
        const inventoryData = await getRawInventory(req.user.id);
        res.json(inventoryData);
    } catch (error) {
        res.status(500).json({ message: '讀取背包資料時發生內部錯誤。' });
    }
});

router.get('/skills', async (req, res) => {
    try {
        const skills = await getPlayerSkills(req.user.id);
        res.json(skills);
    } catch (error) {
        console.error(`[API /skills] 獲取玩家 ${req.user.id} 武學時出錯:`, error);
        res.status(500).json({ message: '獲取武學資料時發生內部錯誤。' });
    }
});

router.get('/get-relations', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        const npcsSnapshot = await db.collection('users').doc(userId).collection('npcs').get();
        const summaryDoc = await summaryDocRef.get();

        if (!summaryDoc.exists || !summaryDoc.data().text) {
            return res.status(404).json({ message: '尚無足夠的故事摘要來生成關係圖。' });
        }

        const longTermSummary = summaryDoc.data().text;
        const npcDetails = {};
        npcsSnapshot.forEach(doc => {
            const data = doc.data();
            npcDetails[data.name] = { romanceValue: data.romanceValue || 0 };
        });

        const mermaidSyntax = await getRelationGraph('deepseek', longTermSummary, username, npcDetails);
        res.json({ mermaidSyntax });
    } catch (error) {
        res.status(500).json({ message: '梳理人物脈絡時發生未知錯誤。' });
    }
});

router.get('/get-encyclopedia', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        const npcsSnapshot = await db.collection('users').doc(userId).collection('npcs').get();
        const summaryDoc = await summaryDocRef.get();

        if (!summaryDoc.exists || !summaryDoc.data().text) {
            return res.json({ encyclopediaHtml: '<p class="loading">你的江湖經歷尚淺。</p>' });
        }

        const longTermSummary = summaryDoc.data().text;
        const npcDetails = {};
        npcsSnapshot.forEach(doc => {
            const data = doc.data();
            npcDetails[data.name] = { romanceValue: data.romanceValue || 0 };
        });

        let encyclopediaHtml = await getAIEncyclopedia('deepseek', longTermSummary, username, npcDetails);
        res.json({ encyclopediaHtml });
    } catch (error) {
        res.status(500).json({ message: "編撰百科時發生未知錯誤。" });
    }
});

router.get('/latest-game', async (req, res) => {
    const userId = req.user.id;
    try {
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        const userData = userDoc.data() || {};

        if (userData.isDeceased) {
            const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
            return res.json({ gameState: 'deceased', roundData: savesSnapshot.empty ? null : savesSnapshot.docs[0].data() });
        }

        const snapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        if (snapshot.empty) {
            return res.status(404).json({ message: '找不到存檔紀錄。' });
        }

        let latestGameData = snapshot.docs[0].data();
        
        // 【核心修改】使用新的輔助函式來獲取合併後的地點資料
        const currentLocationName = latestGameData.LOC?.[0];
        const locationData = await getMergedLocationData(userId, currentLocationName);

        const [inventoryState, skills] = await Promise.all([
            getInventoryState(userId),
            getPlayerSkills(userId)
        ]);
        
        Object.assign(latestGameData, { ...inventoryState, ...userData, skills: skills });

        const [prequelText, suggestion] = await Promise.all([
            getAIPrequel(userData.preferredModel || 'openai', [latestGameData]),
            getAISuggestion(userData.preferredModel || 'openai', latestGameData)
        ]);

        res.json({
            prequel: prequelText,
            story: latestGameData.story || "你靜靜地站在原地，思索著下一步。",
            roundData: latestGameData,
            suggestion: suggestion,
            locationData: locationData 
        });
    } catch (error) {
        res.status(500).json({ message: "讀取最新進度失敗。" });
    }
});

router.get('/get-novel', async (req, res) => {
    const userId = req.user.id;
    try {
        const novelCacheRef = db.collection('users').doc(userId).collection('game_state').doc('novel_cache');
        const novelCacheDoc = await novelCacheRef.get();

        if (novelCacheDoc.exists && novelCacheDoc.data().storyHTML) {
            return res.json({ novelHTML: novelCacheDoc.data().storyHTML });
        }

        const snapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
        if (snapshot.empty) {
            return res.json({ novelHTML: "" });
        }

        const storyChapters = snapshot.docs.map(doc => {
            const roundData = doc.data();
            const title = roundData.EVT || `第 ${roundData.R} 回`;
            const content = roundData.story || "這段往事，已淹沒在時間的長河中。";
            return `<div class="chapter"><h2>${title}</h2><p>${content.replace(/\n/g, '<br>')}</p></div>`;
        });
        const fullStoryHTML = storyChapters.join('');
        await novelCacheRef.set({ storyHTML: fullStoryHTML });
        res.json({ novelHTML: fullStoryHTML });
    } catch (error) {
        res.status(500).json({ message: "生成小說時出錯。" });
    }
});

router.post('/restart', async (req, res) => {
    const userId = req.user.id;
    try {
        const userDocRef = db.collection('users').doc(userId);
        await updateLibraryNovel(userId, req.user.username);
        
        // 【核心修改】刪除舊的個人化資料，現在還包括 location_states
        const collections = ['game_saves', 'npcs', 'game_state', 'skills', 'location_states', 'bounties'];
        for (const col of collections) {
            try {
                const snapshot = await userDocRef.collection(col).get();
                if(!snapshot.empty){
                    const batch = db.batch();
                    snapshot.docs.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                }
            } catch (e) {
                console.warn(`清除集合 ${col} 失敗，可能該集合尚不存在。`, e.message);
            }
        }

        await userDocRef.set({
            username: req.user.username,
            internalPower: 5, externalPower: 5, lightness: 5, morality: 0,
            timeOfDay: '上午', yearName: '元祐', year: 1, month: 1, day: 1
        }, { merge: true });

        await invalidateNovelCache(userId);
        res.status(200).json({ message: '新的輪迴已開啟。' });
    } catch (error) {
        res.status(500).json({ message: '開啟新的輪迴時發生錯誤。' });
    }
});


router.post('/force-suicide', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const userDocRef = db.collection('users').doc(userId);
        const modelName = req.body.model || 'gemini'; 

        const lastSaveSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        if (lastSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到最後的存檔，無法決定死因。' });
        }
        const lastRoundData = lastSaveSnapshot.docs[0].data();

        const deathCause = await getAIDeathCause(modelName, username, lastRoundData);

        await userDocRef.update({ isDeceased: true });

        const finalRoundData = {
            ...lastRoundData,
            R: lastRoundData.R + 1,
            playerState: 'dead',
            story: deathCause,
            PC: deathCause,
            EVT: '天命已至',
        };
        await userDocRef.collection('game_saves').doc(`R${finalRoundData.R}`).set(finalRoundData);

        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗(自殺):", err));

        res.json({
            story: finalRoundData.story,
            roundData: finalRoundData,
            suggestion: '你的江湖路已到盡頭...'
        });
    } catch (error) {
        console.error(`[了卻此生系統] 為玩家 ${username} 處理時發生錯誤:`, error);
        res.status(500).json({ message: '了此殘生時發生未知錯誤...' });
    }
});

module.exports = router;
