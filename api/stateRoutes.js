// /api/stateRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIEncyclopedia, getRelationGraph, getAIPrequel, getAISuggestion, getAIDeathCause } = require('../services/aiService');
const { getPlayerSkills, getRawInventory, getInventoryState } = require('./playerStateHelpers');
const { getMergedLocationData, invalidateNovelCache, updateLibraryNovel } = require('./worldStateHelpers');
const inventoryModel = require('./models/inventoryModel');

const db = admin.firestore();

router.post('/equip', async (req, res) => {
    const { itemId, equip, slot } = req.body;
    const userId = req.user.id;

    try {
        let result;
        if (equip) {
            result = await inventoryModel.equipItem(userId, itemId);
        } else {
            result = await inventoryModel.unequipItem(userId, slot);
        }

        const userDoc = await db.collection('users').doc(userId).get();
        const inventory = await getRawInventory(userId);
        const equipment = userDoc.data().equipment || {};
        const bulkScore = userDoc.data().bulkScore || 0;

        res.json({
            success: true,
            message: result.message,
            playerState: {
                inventory: Object.values(inventory),
                equipment,
                bulkScore
            }
        });

    } catch (error) {
        console.error(`[裝備API] 玩家 ${userId} 操作物品時出錯:`, error);
        res.status(500).json({ success: false, message: error.message || '裝備操作時發生未知錯誤。' });
    }
});

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
        const npcsSnapshot = await db.collection('users').doc(userId).collection('npc_states').get();
        const summaryDoc = await summaryDocRef.get();

        if (!summaryDoc.exists || !summaryDoc.data().text) {
            return res.json({ mermaidSyntax: 'graph TD;\nA["尚無足夠的江湖經歷來繪製關係圖"];' });
        }

        const longTermSummary = summaryDoc.data().text;
        const npcDetails = {};
        npcsSnapshot.forEach(doc => {
            const data = doc.data();
            npcDetails[doc.id] = { romanceValue: data.romanceValue || 0 };
        });

        const mermaidSyntax = await getRelationGraph(longTermSummary, username, npcDetails);
        res.json({ mermaidSyntax });
    } catch (error) {
        console.error(`[關係圖API] 替玩家 ${username} 生成關係圖時出錯:`, error);
        res.status(500).json({ message: '梳理人物脈絡時發生未知錯誤。' });
    }
});

router.get('/get-encyclopedia', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        const npcsSnapshot = await db.collection('users').doc(userId).collection('npc_states').get();
        const summaryDoc = await summaryDocRef.get();

        if (!summaryDoc.exists || !summaryDoc.data().text) {
            return res.json({ encyclopediaHtml: '<p class="loading">你的江湖經歷尚淺，還沒有可供編撰的百科內容。</p>' });
        }

        const longTermSummary = summaryDoc.data().text;
        const npcDetails = {};
        npcsSnapshot.forEach(doc => {
            const data = doc.data();
            npcDetails[doc.id] = { romanceValue: data.romanceValue || 0 };
        });

        let encyclopediaHtml = await getAIEncyclopedia(longTermSummary, username, npcDetails);
        res.json({ encyclopediaHtml });
    } catch (error) {
        console.error(`[百科API] 替玩家 ${username} 生成百科時出錯:`, error);
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

        const [snapshot, newBountiesSnapshot, inventory, skills] = await Promise.all([
            userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get(),
            userDocRef.collection('bounties').where('isRead', '==', false).limit(1).get(),
            getRawInventory(userId), // 【核心修改】讀取完整物品資料
            getPlayerSkills(userId)
        ]);
        
        if (snapshot.empty) {
            return res.status(404).json({ message: '找不到存檔紀錄。' });
        }

        let latestGameData = snapshot.docs[0].data();
        
        const locationData = await getMergedLocationData(userId, latestGameData.LOC);
        
        // 【核心修改】將完整的、最新的數據合併到要傳回的物件中
        Object.assign(latestGameData, { 
            ...userData, 
            skills: skills,
            inventory: Object.values(inventory), // 將物件轉為陣列
            equipment: userData.equipment || {}
        });
        
        const inventoryState = await getInventoryState(userId);
        latestGameData.ITM = inventoryState.itemsString;
        latestGameData.money = inventoryState.money;

        const [prequelText, suggestion] = await Promise.all([
            getAIPrequel(userData.preferredModel, [latestGameData]),
            getAISuggestion(latestGameData)
        ]);

        res.json({
            prequel: prequelText,
            story: latestGameData.story || "你靜靜地站在原地，思索著下一步。",
            roundData: latestGameData,
            suggestion: suggestion,
            locationData: locationData,
            hasNewBounties: !newBountiesSnapshot.empty
        });
    } catch (error) {
        console.error(`[讀取進度API] 替玩家 ${req.user.id} 讀取進度時出錯:`, error);
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
        console.error(`[小說API] 替玩家 ${req.user.id} 生成小說時出錯:`, error);
        res.status(500).json({ message: "生成小說時出錯。" });
    }
});

router.post('/restart', async (req, res) => {
    const userId = req.user.id;
    try {
        const userDocRef = db.collection('users').doc(userId);
        await updateLibraryNovel(userId, req.user.username);
        
        const collections = ['game_saves', 'npc_states', 'game_state', 'skills', 'location_states', 'bounties', 'inventory_items'];
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
            internalPower: 5, externalPower: 5, lightness: 5, morality: 0,
            timeOfDay: '上午', yearName: '元祐', year: 1, month: 1, day: 1,
            // 重置裝備相關
            equipment: {}, bulkScore: 0
        }, { merge: true });

        await invalidateNovelCache(userId);
        res.status(200).json({ message: '新的輪迴已開啟。' });
    } catch (error) {
        console.error(`[重啟API] 替玩家 ${req.user.id} 開啟新輪迴時出錯:`, error);
        res.status(500).json({ message: '開啟新的輪迴時發生錯誤。' });
    }
});


router.post('/force-suicide', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const userDocRef = db.collection('users').doc(userId);
        const playerModelChoice = req.body.model;

        const lastSaveSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        if (lastSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到最後的存檔，無法決定死因。' });
        }
        const lastRoundData = lastSaveSnapshot.docs[0].data();

        const deathCause = await getAIDeathCause(playerModelChoice, username, lastRoundData);

        await userDocRef.update({ isDeceased: true });

        const finalRoundData = {
            ...lastRoundData,
            R: lastRoundData.R + 1,
            playerState: 'dead',
            story: deathCause,
            PC: deathCause,
            EVT: '天命已至',
            causeOfDeath: deathCause,
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
