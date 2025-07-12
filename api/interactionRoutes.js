// /api/interactionRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIStory, getAISummary, getAISuggestion } = require('../services/aiService');

const {
    updateFriendlinessValues,
    updateRomanceValues,
    checkAndTriggerRomanceEvent,
    processNpcUpdates,
    updateNpcMemoryAfterInteraction
} = require('./npcHelpers');
const {
    updateSkills,
    getInventoryState,
    getPlayerSkills,
} = require('./playerStateHelpers');
const {
    TIME_SEQUENCE,
    advanceDate,
    invalidateNovelCache,
    updateLibraryNovel,
    getMergedLocationData,
} = require('./worldStateHelpers');
const { triggerBountyGeneration } = require('./worldEngine');
const { processLocationUpdates } = require('./locationManager');
const { buildContext } = require('./contextBuilder');
const { processItemChanges } = require('./itemManager');

const db = admin.firestore();

const interactRouteHandler = async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;

    try {
        const { action: playerAction, model: playerModelChoice } = req.body;

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
            player,
            username,
            player.currentTimeOfDay,
            player.power,
            player.morality,
            [],
            romanceEventData ? romanceEventData.eventStory : null,
            null,
            locationContext,
            npcContext,
            bulkScore,
            []
        );

        if (!aiResponse || !aiResponse.roundData) {
            throw new Error("主AI未能生成有效回應。");
        }
        
        if (!aiResponse.roundData.EVT || aiResponse.roundData.EVT.trim() === '') {
            const fallbackEVT = playerAction.length > 8 ? playerAction.substring(0, 8) + '…' : playerAction;
            aiResponse.roundData.EVT = fallbackEVT;
        }
        
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        const userDocRef = db.collection('users').doc(userId);

        const newRoundNumber = (player.R || 0) + 1;
        aiResponse.roundData.R = newRoundNumber;
        
        if (aiResponse.roundData.NPC && Array.isArray(aiResponse.roundData.NPC)) {
            const npcsToUpdate = aiResponse.roundData.NPC.filter(npc => npc.status);
            if (npcsToUpdate.length > 0) {
                npcsToUpdate.forEach(npc => {
                    const interactionContext = `事件：「${aiResponse.roundData.EVT}」。\n經過：${aiResponse.story}\n我在事件中的狀態是：「${npc.status}」。`;
                    updateNpcMemoryAfterInteraction(userId, npc.name, interactionContext).catch(err => console.error(`[背景任務] 更新NPC ${npc.name} 記憶時出錯:`, err));
                });
            }
        }
        
        // 【核心修正】將 updateSkills 從 Promise.all 中移出，並在批次處理前獨立執行。
        // 因為它內部有自己的獨立事務(Transaction)，不能與批次(Batch)混用。
        const { levelUpEvents, customSkillCreationResult } = await updateSkills(userId, aiResponse.roundData.skillChanges, player);
        
        if (customSkillCreationResult && !customSkillCreationResult.success) {
            aiResponse.story = customSkillCreationResult.reason;
            aiResponse.roundData.skillChanges = [];
        }
        
        if (levelUpEvents.length > 0) {
            aiResponse.story += `\n\n(你感覺到自己的${levelUpEvents.map(e => `「${e.skillName}」`).join('、')}境界似乎有所精進。)`;
        }

        const batch = db.batch();
        
        await processItemChanges(userId, aiResponse.roundData.itemChanges, batch, aiResponse.roundData);
        await updateFriendlinessValues(userId, username, aiResponse.roundData.NPC, aiResponse.roundData, player);
        await updateRomanceValues(userId, aiResponse.roundData.romanceChanges);
        await processNpcUpdates(userId, aiResponse.roundData.npcUpdates || []);
        
        if (aiResponse.roundData.locationUpdates) {
            await processLocationUpdates(userId, locationContext.locationName, aiResponse.roundData.locationUpdates);
        }
        if (romanceEventData && romanceEventData.npcUpdates) {
            await processNpcUpdates(userId, romanceEventData.npcUpdates);
        }

        const { timeOfDay: aiNextTimeOfDay, daysToAdvance = 0, staminaChange = 0 } = aiResponse.roundData;
        let newStamina = (player.stamina || 100) + staminaChange;
        const isResting = ['睡覺', '休息', '歇息'].some(kw => playerAction.includes(kw));
        const timeDidAdvance = (daysToAdvance > 0) || (aiNextTimeOfDay && aiNextTimeOfDay !== player.currentTimeOfDay);
        if (isResting && timeDidAdvance) newStamina = 100;
        newStamina = Math.max(0, newStamina);
        
        let shortActionCounter = player.shortActionCounter || 0;
        if (!timeDidAdvance && !isResting) shortActionCounter++; else shortActionCounter = 0;
        let finalTimeOfDay = aiNextTimeOfDay || player.currentTimeOfDay;
        let finalDate = { year: player.year, month: player.month, day: player.day, yearName: player.yearName };
        let daysToAdd = daysToAdvance;
        if (shortActionCounter >= 3) {
            const currentTimeIndex = TIME_SEQUENCE.indexOf(finalTimeOfDay);
            const nextTimeIndex = (currentTimeIndex + 1) % TIME_SEQUENCE.length;
            finalTimeOfDay = TIME_SEQUENCE[nextTimeIndex];
            if (nextTimeIndex === 0) daysToAdd++;
            shortActionCounter = 0;
        }
        for (let i = 0; i < daysToAdd; i++) finalDate = advanceDate(finalDate);

        const playerUpdatesForDb = {
            timeOfDay: finalTimeOfDay,
            stamina: newStamina,
            shortActionCounter,
            ...finalDate,
            internalPower: admin.firestore.FieldValue.increment(aiResponse.roundData.powerChange?.internal || 0),
            externalPower: admin.firestore.FieldValue.increment(aiResponse.roundData.powerChange?.external || 0),
            lightness: admin.firestore.FieldValue.increment(aiResponse.roundData.powerChange?.lightness || 0),
            morality: admin.firestore.FieldValue.increment(aiResponse.roundData.moralityChange || 0),
            money: admin.firestore.FieldValue.increment(aiResponse.roundData.moneyChange || 0)
        };
        batch.update(userDocRef, playerUpdatesForDb);
        
        const finalSaveData = { ...aiResponse.roundData, story: aiResponse.story, R: newRoundNumber, timeOfDay: finalTimeOfDay, ...finalDate, stamina: newStamina };
        const newSaveRef = userDocRef.collection('game_saves').doc(`R${newRoundNumber}`);
        batch.set(newSaveRef, finalSaveData);

        const newSummary = await getAISummary(longTermSummary, finalSaveData);
        batch.set(summaryDocRef, { text: newSummary, lastUpdated: newRoundNumber }, { merge: true });

        await batch.commit();

        invalidateNovelCache(userId);
        updateLibraryNovel(userId, username);
        
        const [inventoryState, updatedSkills, finalPlayerProfile] = await Promise.all([
            getInventoryState(userId),
            getPlayerSkills(userId),
            userDocRef.get().then(doc => doc.data())
        ]);
        
        const suggestion = await getAISuggestion(finalSaveData);
        
        const finalRoundDataForClient = { ...finalSaveData, ...finalPlayerProfile, skills: updatedSkills, ...inventoryState, suggestion };

        res.json({
            story: finalSaveData.story,
            roundData: finalRoundDataForClient,
            suggestion: suggestion,
            locationData: await getMergedLocationData(userId, finalSaveData.LOC)
        });

    } catch (error) {
        console.error(`[互動路由] /interact 錯誤:`, error);
        res.status(500).json({ message: error.message || "處理您的動作時發生了未知的伺服器錯誤。" });
    }
};

router.post('/interact', interactRouteHandler);
module.exports = router;
