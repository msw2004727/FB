// /api/interactionRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIStory, getAISummary, getAISuggestion } = require('../services/aiService');

// 【核心修改】從新的、拆分後的輔助檔案中導入所需函式
const {
    createNpcProfileInBackground,
    updateFriendlinessValues,
    updateRomanceValues,
    checkAndTriggerRomanceEvent,
    processNpcUpdates,
} = require('./npcHelpers');
const {
    updateInventory,
    updateSkills,
} = require('./playerStateHelpers');
const {
    TIME_SEQUENCE,
    advanceDate,
    invalidateNovelCache,
    updateLibraryNovel,
} = require('./worldStateHelpers');
const { triggerBountyGeneration } = require('./worldEngine');
const { processLocationUpdates } = require('./locationManager');
const { buildContext } = require('./contextBuilder'); // 【核心新增】引入我們新建的狀態產生器

const db = admin.firestore();

// 處理玩家主要動作的核心函式
const interactRouteHandler = async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;

    try {
        const { action: playerAction, model: playerModelChoice } = req.body;

        // --- 所有資料準備工作，現在都由 buildContext 一行搞定 ---
        const context = await buildContext(userId, username);
        if (!context) {
            throw new Error("無法建立當前的遊戲狀態，請稍後再試。");
        }

        const {
            player,
            longTermSummary,
            recentHistory,
            locationContext,
            npcContext,
            bulkScore,
            isNewGame
        } = context;
        
        if (isNewGame) {
             return res.status(404).json({ message: '找不到存檔紀錄。' });
        }
        
        if (player.isDeceased) {
            return res.status(403).json({ message: '逝者已矣，無法再有任何動作。' });
        }

        const romanceEventData = await checkAndTriggerRomanceEvent(userId, player);

        const aiResponse = await getAIStory(
            playerModelChoice,
            longTermSummary,
            JSON.stringify(recentHistory),
            playerAction,
            player, // 直接傳遞完整的玩家狀態物件
            username,
            player.currentTimeOfDay,
            player.power,
            player.morality,
            [], // levelUpEvents - 初始化為空
            romanceEventData ? romanceEventData.eventStory : null,
            null, // worldEventToWeave - 暫時保留
            locationContext,
            npcContext,
            bulkScore,
            [] // actorCandidates - 暫時保留
        );

        if (!aiResponse || !aiResponse.roundData) {
            throw new Error("主AI未能生成有效回應。");
        }
        
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        const userDocRef = db.collection('users').doc(userId);

        const newRoundNumber = (player.R || 0) + 1; // 使用從 context 來的回合數
        aiResponse.roundData.R = newRoundNumber;
        
        const { timeOfDay: aiNextTimeOfDay, daysToAdvance: aiDaysToAdvance = 0, staminaChange = 0 } = aiResponse.roundData;
        
        // --- 精力系統邏輯 ---
        let newStamina = (player.stamina || 100) + staminaChange;
        const restKeywords = ['睡覺', '休息', '歇息', '歇會', '小憩', '安歇', '打坐'];
        const isResting = restKeywords.some(kw => playerAction.includes(kw));
        const timeDidAdvance = (aiDaysToAdvance > 0) || (aiNextTimeOfDay && aiNextTimeOfDay !== player.currentTimeOfDay);
        
        if (isResting && timeDidAdvance) {
            const oldTimeIndex = TIME_SEQUENCE.indexOf(player.currentTimeOfDay);
            const newTimeIndex = TIME_SEQUENCE.indexOf(aiNextTimeOfDay);
            let slotsPassed = (aiDaysToAdvance * TIME_SEQUENCE.length) + (newTimeIndex - oldTimeIndex + TIME_SEQUENCE.length) % TIME_SEQUENCE.length;
            if (slotsPassed >= 4) newStamina = 100;
            else newStamina = Math.min(100, (player.stamina || 100) + (25 * slotsPassed));
        }

        if (newStamina <= 0) {
            const passOutEvent = { story: "你感到一陣天旋地轉，眼前一黑，便失去了所有知覺...再次醒來時，只覺得頭痛欲裂，不知已過去了多久。", PC: "你因體力不支而昏倒在地。", EVT: "力竭昏迷" };
            aiResponse.story = passOutEvent.story;
            aiResponse.roundData.PC = passOutEvent.PC;
            aiResponse.roundData.EVT = passOutEvent.EVT;
            newStamina = 50; 
        } else {
            newStamina = Math.min(100, newStamina);
        }
        
        // --- 時間推進邏輯 ---
        let shortActionCounter = player.shortActionCounter || 0;
        if (!timeDidAdvance && !isResting) shortActionCounter++;
        else shortActionCounter = 0;

        let finalTimeOfDay = aiNextTimeOfDay || player.currentTimeOfDay;
        let finalDate = { year: player.year, month: player.month, day: player.day, yearName: player.yearName };
        let daysToAdd = aiDaysToAdvance;

        if (shortActionCounter >= 3) {
            const currentTimeIndex = TIME_SEQUENCE.indexOf(finalTimeOfDay);
            const nextTimeIndex = (currentTimeIndex + 1) % TIME_SEQUENCE.length;
            finalTimeOfDay = TIME_SEQUENCE[nextTimeIndex];
            if (nextTimeIndex === 0) daysToAdd++;
            shortActionCounter = 0;
        }

        for (let i = 0; i < daysToAdd; i++) {
            finalDate = advanceDate(finalDate);
        }

        // --- 武學與檔案更新 ---
        const { levelUpEvents, customSkillCreationResult } = await updateSkills(userId, aiResponse.roundData.skillChanges, player);
        
        if (customSkillCreationResult && !customSkillCreationResult.success) {
            aiResponse.story = customSkillCreationResult.reason;
            aiResponse.roundData.skillChanges = [];
        }
        
        if (levelUpEvents.length > 0) {
            aiResponse.story += `\n\n(你感覺到自己的${levelUpEvents.map(e => `「${e.skillName}」`).join('、')}境界似乎有所精進。)`;
        }

        // --- 並行處理所有資料庫寫入 ---
        await Promise.all([
            updateInventory(userId, aiResponse.roundData.itemChanges, aiResponse.roundData),
            updateRomanceValues(userId, aiResponse.roundData.romanceChanges),
            updateFriendlinessValues(userId, aiResponse.roundData.NPC),
            processNpcUpdates(userId, aiResponse.roundData.npcUpdates || []),
            processLocationUpdates(userId, player.currentLocation?.[0], aiResponse.roundData.locationUpdates)
        ]);
        
        if (aiResponse.roundData.NPC && Array.isArray(aiResponse.roundData.NPC)) {
            await Promise.all(aiResponse.roundData.NPC.filter(npc => npc.isNew).map(npc => createNpcProfileInBackground(userId, username, npc, aiResponse.roundData, player)));
        }

        const [newSummary, suggestion] = await Promise.all([
            getAISummary(longTermSummary, aiResponse.roundData),
            getAISuggestion(aiResponse.roundData)
        ]);
        
        const playerUpdatesForDb = {
            timeOfDay: finalTimeOfDay,
            stamina: newStamina,
            shortActionCounter,
            ...finalDate,
            internalPower: admin.firestore.FieldValue.increment(aiResponse.roundData.powerChange?.internal || 0),
            externalPower: admin.firestore.FieldValue.increment(aiResponse.roundData.powerChange?.external || 0),
            lightness: admin.firestore.FieldValue.increment(aiResponse.roundData.powerChange?.lightness || 0),
            morality: admin.firestore.FieldValue.increment(aiResponse.roundData.moralityChange || 0)
        };
        
        const finalSaveData = { ...aiResponse.roundData, story: aiResponse.story, R: newRoundNumber, timeOfDay: finalTimeOfDay, ...finalDate, stamina: newStamina };
        delete finalSaveData.power;
        
        await Promise.all([
            userDocRef.update(playerUpdatesForDb),
            summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber }),
            userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(finalSaveData)
        ]);
        
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗:", err));
        
        const finalContext = await buildContext(userId, username);
        
        res.json({
            story: finalSaveData.story,
            roundData: { ...finalContext.player, R: newRoundNumber, suggestion: suggestion },
            suggestion: suggestion,
            locationData: finalContext.locationContext
        });

    } catch (error) {
        console.error(`[UserID: ${userId}] /interact 錯誤:`, error);
        if (!res.headersSent) {
            res.status(500).json({ message: error.message || "互動時發生未知錯誤" });
        }
    }
};

router.post('/interact', interactRouteHandler);
module.exports = router;
