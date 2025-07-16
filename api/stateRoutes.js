// /api/stateRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIEncyclopedia, getRelationGraph, getAIPrequel, getAISuggestion, getAIDeathCause, getAIForgetSkillStory } = require('../services/aiService');
const { getPlayerSkills, getRawInventory, calculateBulkScore } = require('./playerStateHelpers'); 
const { getMergedLocationData, invalidateNovelCache, updateLibraryNovel } = require('./worldStateHelpers');

const db = admin.firestore();

// ... (所有其他路由保持不變) ...

// ... (自廢武功、丟棄物品、獲取最新遊戲、庫存、技能、關係圖、百科等路由) ...
router.post('/forget-skill', async (req, res) => {
    const { skillName, skillType } = req.body;
    const { id: userId, username } = req.user;

    if (!skillName) {
        return res.status(400).json({ success: false, message: '未提供要廢除的武功名稱。' });
    }
    if (skillName === '現代搏擊') {
        return res.status(403).json({ success: false, message: '這是你穿越時帶來的唯一印記，無法被遺忘。' });
    }

    try {
        console.log(`[自廢武功] 玩家 ${username} (ID: ${userId}) 請求廢除武功: 「${skillName}」。`);

        const userRef = db.collection('users').doc(userId);
        const skillRef = userRef.collection('skills').doc(skillName);
        const skillDoc = await skillRef.get();

        if (!skillDoc.exists) {
            console.warn(`[自廢武功] 警告：玩家 ${username} 試圖廢除一個不存在的武學「${skillName}」。`);
            return res.status(404).json({ success: false, message: `你並未學會「${skillName}」。` });
        }
        
        const lastSaveSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const playerProfileSnapshot = await userRef.get();

        if (lastSaveSnapshot.empty || !playerProfileSnapshot.exists) {
            return res.status(404).json({ message: '找不到玩家存檔或資料。' });
        }
        
        let lastRoundData = lastSaveSnapshot.docs[0].data();
        let playerProfile = playerProfileSnapshot.data();

        const profileForPrompt = {
            ...playerProfile,
            username: username,
            currentLocation: lastRoundData.LOC,
            NPC: lastRoundData.NPC || [] 
        };

        const story = await getAIForgetSkillStory(playerProfile.preferredModel, profileForPrompt, skillName);

        const batch = db.batch();

        // 【核心修正】只刪除單一武學文件
        batch.delete(skillRef);
        console.log(`[自廢武功] 已將玩家 ${username} 的單一武學「${skillName}」加入刪除佇列。`);


        // 只有在 skillType 有效時才處理自創技能計數
        if (skillType && ['internal', 'external', 'lightness', 'none'].includes(skillType)) {
            const fieldToDecrement = `customSkillsCreated.${skillType}`;
            if (playerProfile.customSkillsCreated && typeof playerProfile.customSkillsCreated[skillType] === 'number' && playerProfile.customSkillsCreated[skillType] > 0) {
                batch.update(userRef, {
                    [fieldToDecrement]: admin.firestore.FieldValue.increment(-1)
                });
                console.log(`[自廢武功] 已將玩家 ${username} 的「${fieldToDecrement}」欄位計數減一。`);
            }
        }
        
        await batch.commit();
        console.log(`[自廢武功] 玩家 ${username} 的武學「${skillName}」已成功從資料庫中刪除。`);


        const newRoundNumber = lastRoundData.R + 1;
        
        const [fullInventory, updatedSkills, finalPlayerProfile] = await Promise.all([
            getRawInventory(userId),
            getPlayerSkills(userId),
            userRef.get().then(doc => doc.data()),
        ]);
        const bulkScore = calculateBulkScore(fullInventory);
        
        const newRoundData = {
            ...lastRoundData,
            R: newRoundNumber,
            story: story,
            PC: `你廢除了「${skillName}」，感覺體內一陣空虛，但也為新的可能性騰出了空間。`,
            EVT: `自廢武功「${skillName}」`,
            ...finalPlayerProfile,
            inventory: fullInventory,
            skills: updatedSkills,
            bulkScore: bulkScore,
        };
        
        const suggestion = await getAISuggestion(newRoundData);
        newRoundData.suggestion = suggestion;
        
        await db.collection('users').doc(userId).collection('game_saves').doc(`R${newRoundNumber}`).set(newRoundData);
        
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗(自廢武功):", err));
        
        res.json({
            success: true,
            message: `你已成功廢除「${skillName}」。`,
            story: newRoundData.story,
            roundData: newRoundData,
            suggestion: suggestion,
            locationData: await getMergedLocationData(userId, newRoundData.LOC)
        });

    } catch (error) {
        console.error(`[自廢武功API] 玩家 ${userId} 廢除武功 ${skillName} 時出錯:`, error);
        res.status(500).json({ success: false, message: '散功時發生未知錯誤，你的內力產生了混亂。' });
    }
});


// (其餘路由保持不變) ...

router.post('/drop-item', async (req, res) => {
    const { itemId } = req.body;
    const userId = req.user.id;

    if (!itemId) {
        return res.status(400).json({ success: false, message: '未提供要丟棄的物品ID。' });
    }

    try {
        const itemRef = db.collection('users').doc(userId).collection('inventory_items').doc(itemId);
        const itemDoc = await itemRef.get();

        if (!itemDoc.exists) {
            return res.status(404).json({ success: false, message: '在你的背包中找不到這個物品。' });
        }
        
        await itemRef.delete();
        
        const updatedInventory = await getRawInventory(userId);
        const newBulkScore = calculateBulkScore(updatedInventory);

        res.json({
            success: true,
            message: `已丟棄「${itemDoc.data().templateId || '物品'}」。`,
            inventory: updatedInventory,
            bulkScore: newBulkScore,
        });

    } catch (error) {
        console.error(`[丟棄物品API] 玩家 ${userId} 丟棄物品 ${itemId} 時出錯:`, error);
        res.status(500).json({ success: false, message: '丟棄物品時發生未知錯誤。' });
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
        
        const [snapshot, newBountiesSnapshot, fullInventory, skills] = await Promise.all([
            userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get(),
            userDocRef.collection('bounties').where('isRead', '==', false).limit(1).get(),
            getRawInventory(userId),
            getPlayerSkills(userId)
        ]);
        
        if (snapshot.empty) {
            return res.status(404).json({ message: '找不到存檔紀錄。' });
        }

        let latestGameData = snapshot.docs[0].data();
        
        const locationData = await getMergedLocationData(userId, latestGameData.LOC);
        const bulkScore = calculateBulkScore(fullInventory);

        const silverItem = fullInventory.find(item => item.templateId === '銀兩');
        const silverAmount = silverItem ? silverItem.quantity : 0;
        
        Object.assign(latestGameData, { 
            ...userData, 
            skills: skills,
            inventory: fullInventory,
            bulkScore: bulkScore,
            money: userData.money || 0,
            silver: silverAmount
        });

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

/**
 * 【核心優化】獲取個人小說的路由
 * 此路由現在將從 library_novels 集合讀取分章節數據，而不是掃描全部的 game_saves。
 * 這將極大地提升讀取速度並降低資料庫讀取成本。
 */
router.get('/get-novel', async (req, res) => {
    const userId = req.user.id;
    try {
        const novelDocRef = db.collection('library_novels').doc(userId);
        const chaptersSnapshot = await novelDocRef.collection('chapters').orderBy('round', 'asc').get();

        if (chaptersSnapshot.empty) {
            // 如果在圖書館找不到，作為備用方案，可以嘗試從 game_saves 讀取一次（僅限此處）。
            // 這確保了即使圖書館更新失敗，玩家依然能看到自己的故事。
            const savesSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
            if (savesSnapshot.empty) {
                return res.json({ novelHTML: "" });
            }
            const storyChapters = savesSnapshot.docs.map(doc => {
                const data = doc.data();
                return `<div class="chapter"><h2>${data.EVT || `第 ${data.R} 回`}</h2><p>${(data.story || "").replace(/\n/g, '<br>')}</p></div>`;
            });
            return res.json({ novelHTML: storyChapters.join('') });
        }

        const storyChapters = chaptersSnapshot.docs.map(doc => {
            const chapter = doc.data();
            const title = chapter.title || `第 ${chapter.round} 回`;
            const content = chapter.content || "這段往事，已淹沒在時間的長河中。";
            return `<div class="chapter"><h2>${title}</h2><p>${content.replace(/\n/g, '<br>')}</p></div>`;
        });
        
        const fullStoryHTML = storyChapters.join('');
        res.json({ novelHTML: fullStoryHTML });

    } catch (error) {
        console.error(`[小說API v2.0] 替玩家 ${req.user.id} 生成小說時出錯:`, error);
        res.status(500).json({ message: "生成個人小說時發生未知錯誤。" });
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
            bulkScore: 0 
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
