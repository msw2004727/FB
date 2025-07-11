// /api/interactionRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIStory, getAISummary, getAISuggestion } = require('../services/aiService');

const {
    createNpcProfileInBackground,
    updateFriendlinessValues,
    updateRomanceValues,
    checkAndTriggerRomanceEvent,
    processNpcUpdates,
    updateNpcMemoryAfterInteraction // 【核心新增】引入記憶更新輔助函式
} = require('./npcHelpers');
const {
    updateInventory,
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
            console.warn(`[後端修正] AI未能生成有效的章回標題(EVT)。正在從玩家行動「${playerAction}」中自動提取...`);
            const fallbackEVT = playerAction.length > 8 ? playerAction.substring(0, 8) + '…' : playerAction;
            aiResponse.roundData.EVT = fallbackEVT;
            console.log(`[後端修正] 已自動生成後備標題: "${fallbackEVT}"`);
        }
        
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        const userDocRef = db.collection('users').doc(userId);

        const newRoundNumber = (player.R || 0) + 1;
        aiResponse.roundData.R = newRoundNumber;
        
        const { timeOfDay: aiNextTimeOfDay, daysToAdvance: aiDaysToAdvance = 0, staminaChange = 0 } = aiResponse.roundData;
        
        let newStamina = (player.stamina || 100) + staminaChange;
        
        const basalMetabolismCost = Math.floor(Math.random() * 5) + 1;
        newStamina -= basalMetabolismCost;
        
        const restKeywords = ['睡覺', '休息', '歇息', '歇會', '小憩', '安歇', '打坐'];
        const isResting = restKeywords.some(kw => playerAction.includes(kw));
        const timeDidAdvance = (aiDaysToAdvance > 0) || (aiNextTimeOfDay && aiNextTimeOfDay !== player.currentTimeOfDay);
        
        let staminaLog = `[精力系統] 行動消耗: ${staminaChange}, 基礎代謝消耗: -${basalMetabolismCost}`;

        if (isResting && timeDidAdvance) {
            const oldTimeIndex = TIME_SEQUENCE.indexOf(player.currentTimeOfDay);
            const newTimeIndex = TIME_SEQUENCE.indexOf(aiNextTimeOfDay);
            let slotsPassed = (aiDaysToAdvance * TIME_SEQUENCE.length) + (newTimeIndex - oldTimeIndex + TIME_SEQUENCE.length) % TIME_SEQUENCE.length;
            
            const originalStamina = player.stamina || 100;
            let recoveredStamina;

            if (slotsPassed >= 4) {
                newStamina = 100;
            } else {
                newStamina = Math.min(100, originalStamina + (25 * slotsPassed));
            }
            recoveredStamina = newStamina - originalStamina;
            staminaLog += `, 休息恢復: +${recoveredStamina > 0 ? recoveredStamina : 0}`;
        }
        
        console.log(staminaLog);

        if (newStamina <= 0) {
            const passOutEvent = { story: "你感到一陣天旋地轉，眼前一黑，便失去了所有知覺...再次醒來時，只覺得頭痛欲裂，不知已過去了多久。", PC: "你因體力不支而昏倒在地。", EVT: "力竭昏迷" };
            aiResponse.story = passOutEvent.story;
            aiResponse.roundData.PC = passOutEvent.PC;
            aiResponse.roundData.EVT = passOutEvent.EVT;
            newStamina = 50; 
        } else {
            newStamina = Math.min(100, newStamina);
        }
        
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

        const { levelUpEvents, customSkillCreationResult } = await updateSkills(userId, aiResponse.roundData.skillChanges, player);
        
        if (customSkillCreationResult && !customSkillCreationResult.success) {
            aiResponse.story = customSkillCreationResult.reason;
            aiResponse.roundData.skillChanges = [];
        }
        
        if (levelUpEvents.length > 0) {
            aiResponse.story += `\n\n(你感覺到自己的${levelUpEvents.map(e => `「${e.skillName}」`).join('、')}境界似乎有所精進。)`;
        }

        await Promise.all([
            updateInventory(userId, aiResponse.roundData.itemChanges, aiResponse.roundData),
            updateRomanceValues(userId, aiResponse.roundData.romanceChanges),
            updateFriendlinessValues(userId, aiResponse.roundData.NPC, aiResponse.roundData),
            processNpcUpdates(userId, aiResponse.roundData.npcUpdates || []),
            processLocationUpdates(userId, player.currentLocation?.[0], aiResponse.roundData.locationUpdates)
        ]);
        
        // 【核心新增】為所有互動過的NPC更新記憶
        if (aiResponse.roundData.NPC && Array.isArray(aiResponse.roundData.NPC)) {
            const memoryUpdatePromises = aiResponse.roundData.NPC
                .filter(npc => npc.friendlinessChange !== 0) // 只為有友好度變化的NPC更新記憶
                .map(npc => {
                    const interactionContext = `情境：${aiResponse.roundData.story}\n你的狀態：${npc.status}`;
                    return updateNpcMemoryAfterInteraction(userId, npc.name, interactionContext);
                });
            await Promise.all(memoryUpdatePromises);
        }
        
        if (aiResponse.roundData.NPC && Array.isArray(aiResponse.roundData.NPC)) {
            const newNpcs = aiResponse.roundData.NPC.filter(npc => npc.isNew);
            if (newNpcs.length > 0) {
                console.log(`[非同步優化] 偵測到 ${newNpcs.length} 位新NPC，已將通用模板建檔任務推入背景執行。`);
                Promise.all(newNpcs.map(npc => createNpcProfileInBackground(userId, username, npc, aiResponse.roundData, player)));
            }
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
        
        const finalRoundDataForClient = { ...finalSaveData };
        const latestPlayerState = (await userDocRef.get()).data();
        finalRoundDataForClient.internalPower = latestPlayerState.internalPower;
        finalRoundDataForClient.externalPower = latestPlayerState.externalPower;
        finalRoundDataForClient.lightness = latestPlayerState.lightness;
        finalRoundDataForClient.morality = latestPlayerState.morality;
        const inventoryState = await getInventoryState(userId);
        finalRoundDataForClient.ITM = inventoryState.itemsString;
        finalRoundDataForClient.money = inventoryState.money;
        finalRoundDataForClient.skills = await getPlayerSkills(userId);
        
        res.json({
            story: finalSaveData.story,
            roundData: { ...finalRoundDataForClient, suggestion: suggestion },
            suggestion: suggestion,
            locationData: await getMergedLocationData(userId, finalRoundDataForClient.LOC)
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
