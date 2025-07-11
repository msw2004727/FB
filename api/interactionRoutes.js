// /api/interactionRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIStory, getAISummary, getAISuggestion, getAIProactiveChat } = require('../services/aiService');
const {
    TIME_SEQUENCE,
    advanceDate,
    updateInventory,
    updateRomanceValues,
    updateFriendlinessValues,
    checkAndTriggerRomanceEvent,
    createNpcProfileInBackground,
    invalidateNovelCache,
    updateLibraryNovel,
    updateSkills,
    processNpcUpdates,
} = require('./gameHelpers');
const { triggerBountyGeneration, generateAndCacheLocation } = require('./worldEngine');
const { processLocationUpdates } = require('./locationManager');
const { buildContext } = require('./contextBuilder'); // 【核心新增】引入我們新建的狀態產生器

const db = admin.firestore();

// 處理玩家主要動作的核心函式
const interactRouteHandler = async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;

    try {
        const { action: playerAction, model: playerModelChoice } = req.body;

        // --- 【核心修改】所有資料準備工作，現在都由 buildContext 一行搞定 ---
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
        
        // 如果是全新遊戲，直接回傳初始訊息，不經過AI
        if (isNewGame) {
             return res.status(404).json({ message: '找不到存檔紀錄。' });
        }
        
        // 檢查玩家是否已死亡
        if (player.isDeceased) {
            return res.status(403).json({ message: '逝者已矣，無法再有任何動作。' });
        }

        // --- 【核心修改】所有後續邏輯，都從乾淨的 context 物件中取用資料 ---
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
        
        // (接下來的程式碼幾乎不變，只是資料來源從各處變為統一的 context 或 aiResponse)

        const newRoundNumber = (player.currentRound || 0) + 1;
        aiResponse.roundData.R = newRoundNumber;
        
        // 處理時間和體力變化
        const { timeOfDay: aiNextTimeOfDay, daysToAdvance: aiDaysToAdvance = 0, staminaChange = 0 } = aiResponse.roundData;
        let newStamina = player.stamina + staminaChange;
        
        const restKeywords = ['睡覺', '休息', '歇息', '歇會', '小憩', '安歇'];
        const isResting = restKeywords.some(kw => playerAction.includes(kw));
        const timeDidAdvance = (aiDaysToAdvance > 0) || (aiNextTimeOfDay && aiNextTimeOfDay !== player.currentTimeOfDay);
        
        if (isResting && timeDidAdvance) {
            const oldTimeIndex = TIME_SEQUENCE.indexOf(player.currentTimeOfDay);
            const newTimeIndex = TIME_SEQUENCE.indexOf(aiNextTimeOfDay);
            let slotsPassed = (aiDaysToAdvance * TIME_SEQUENCE.length) + (newTimeIndex > oldTimeIndex ? newTimeIndex - oldTimeIndex : (TIME_SEQUENCE.length - oldTimeIndex) + newTimeIndex);
            if (slotsPassed >= 4) newStamina = 100;
            else newStamina = Math.min(100, newStamina + (25 * slotsPassed));
        }

        let shortActionCounter = player.shortActionCounter || 0;
        if (!timeDidAdvance && !isResting) shortActionCounter++;
        else shortActionCounter = 0;

        let finalTimeOfDay = aiNextTimeOfDay || player.currentTimeOfDay;
        let finalDate = { ...player.currentDate };
        let daysToAdd = aiDaysToAdvance;

        if (shortActionCounter >= 3) {
            const currentTimeIndex = TIME_SEQUENCE.indexOf(finalTimeOfDay);
            const nextTimeIndex = (currentTimeIndex + 1) % TIME_SEQUENCE.length;
            finalTimeOfDay = TIME_SEQUENCE[nextTimeIndex];
            if (nextTimeIndex === 0) daysToAdd += 1;
            shortActionCounter = 0;
        }

        for (let i = 0; i < daysToAdd; i++) {
            finalDate = advanceDate(finalDate);
        }

        // 處理體力耗盡
        if (newStamina <= 0) {
             const passOutEvent = { story: "你感到一陣天旋地轉...失去了知覺。", PC: "你因體力不支而昏倒在地。", EVT: "力竭昏迷", stamina: 50 };
            aiResponse.story = passOutEvent.story;
            aiResponse.roundData = { ...aiResponse.roundData, ...passOutEvent };
            newStamina = 50; 
        }

        // 處理武學升級與自創
        const { levelUpEvents } = await updateSkills(userId, aiResponse.roundData.skillChanges, player);
        if (levelUpEvents.length > 0) {
            // (此處省略了為升級事件生成額外描述的複雜邏輯，可在未來再次加入)
            aiResponse.story += `\n\n(你感覺到自己的武學境界似乎有所精進。)`;
        }

        // 並行更新所有資料庫狀態
        await Promise.all([
            updateInventory(userId, aiResponse.roundData.itemChanges, aiResponse.roundData),
            updateRomanceValues(userId, aiResponse.roundData.romanceChanges),
            updateFriendlinessValues(userId, aiResponse.roundData.NPC),
            processNpcUpdates(userId, aiResponse.roundData.npcUpdates || []),
            processLocationUpdates(userId, player.currentLocation?.[0], aiResponse.roundData.locationUpdates)
        ]);
        
        // 處理新NPC的背景建檔
        if (aiResponse.roundData.NPC && Array.isArray(aiResponse.roundData.NPC)) {
            const npcCreationPromises = aiResponse.roundData.NPC
                .filter(npc => npc.isNew)
                .map(npc => createNpcProfileInBackground(userId, username, npc, aiResponse.roundData, player));
            await Promise.all(npcCreationPromises);
        }

        // 整理最終要回傳和儲存的數據
        const newSummary = await getAISummary(longTermSummary, aiResponse.roundData);
        const suggestion = await getAISuggestion(aiResponse.roundData);
        
        // 更新玩家主文件
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
        
        // 最終儲存
        await Promise.all([
            db.collection('users').doc(userId).update(playerUpdatesForDb),
            summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber }),
            userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set({ ...aiResponse.roundData, story: aiResponse.story })
        ]);
        
        // 使快取失效並更新圖書館
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗:", err));
        
        // 再次建立最新的狀態，回傳給前端
        const finalContext = await buildContext(userId, username);
        
        res.json({
            story: aiResponse.story,
            roundData: { ...finalContext.player, R: newRoundNumber, suggestion: suggestion },
            suggestion: suggestion,
            locationData: finalContext.locationContext,
            // (其他未來可能需要回傳的數據)
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
