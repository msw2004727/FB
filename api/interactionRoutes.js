// /api/interactionRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIStory, getAISummary, getAISuggestion } = require('../services/aiService');
const beggarService = require('../services/beggarService'); // 【核心新增】引入丐幫服務

const {
    updateFriendlinessValues,
    updateRomanceValues,
    checkAndTriggerRomanceEvent,
    processNpcUpdates,
    updateNpcMemoryAfterInteraction
} = require('./npcHelpers');
const {
    updateSkills,
    getRawInventory,
    calculateBulkScore,
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

        // --- 【核心修改】丐幫關鍵字檢測 ---
        const beggarKeywords = ['丐幫', '乞丐', '打聽', '消息', '情報'];
        const isSummoningBeggar = beggarKeywords.some(keyword => playerAction.includes(keyword));

        if (isSummoningBeggar) {
            console.log(`[互動路由] 偵測到玩家的丐幫呼叫意圖: "${playerAction}"`);
            const summonResult = await beggarService.handleBeggarSummon(userId);
            
            // 直接返回一個簡單的回應，告知玩家已發出信號
            // 主故事AI將在下一回合根據這個信號，安排NPC登場
            const lastSaveSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get();
            if (lastSaveSnapshot.empty) {
                return res.status(404).json({ message: '找不到存檔紀錄，無法呼叫丐幫。' });
            }
            const lastRoundData = lastSaveSnapshot.docs[0].data();
            const newRoundData = {
                ...lastRoundData,
                R: lastRoundData.R + 1,
                story: summonResult.message,
                PC: '你發出了江湖暗號，靜待回音。',
                EVT: '尋訪丐幫弟子',
                suggestion: `接下來就在原地等等，或四處逛逛？`,
            };
            
            await db.collection('users').doc(userId).collection('game_saves').doc(`R${newRoundData.R}`).set(newRoundData);

            return res.json({
                story: newRoundData.story,
                roundData: newRoundData,
                suggestion: newRoundData.suggestion,
                locationData: await getMergedLocationData(userId, newRoundData.LOC)
            });
        }
        // --- 丐幫關鍵字檢測結束 ---


        // 如果不是呼叫丐幫，則執行原有的主線劇情邏輯
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
        
        // 【核心修改】獲取玩家的臨時狀態，看是否有丐幫弟子要登場
        const playerTempFlagsDoc = await db.collection('users').doc(userId).collection('game_state').doc('player_temp_flags').get();
        const beggarSummonFlag = playerTempFlagsDoc.exists ? playerTempFlagsDoc.data().beggarSummon : null;


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
            beggarSummonFlag, // <-- 將丐幫事件標記傳給AI
            locationContext,
            npcContext,
            bulkScore,
            []
        );

        if (!aiResponse || !aiResponse.roundData) {
            throw new Error("主AI未能生成有效回應。");
        }
        
        // 如果丐幫弟子已經成功登場，則清除標記
        const arrivedNpcNames = aiResponse.roundData.NPC.map(npc => npc.name);
        if (beggarSummonFlag && arrivedNpcNames.includes(beggarSummonFlag.beggarName)) {
            await playerTempFlagsDoc.ref.update({
                beggarSummon: admin.firestore.FieldValue.delete()
            });
            console.log(`[互動路由] 丐幫弟子 ${beggarSummonFlag.beggarName} 已成功登場，清除召喚標記。`);
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

        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userDocRef);
            if (!userDoc.exists) {
                throw "Document does not exist!";
            }
            const currentData = userDoc.data();
            
            const powerChange = aiResponse.roundData.powerChange || {};
            const newInternal = Math.max(0, (currentData.internalPower || 0) + (powerChange.internal || 0));
            const newExternal = Math.max(0, (currentData.externalPower || 0) + (powerChange.external || 0));
            const newLightness = Math.max(0, (currentData.lightness || 0) + (powerChange.lightness || 0));
            
            const finalStamina = Math.max(0, newStamina);
            const finalMorality = (currentData.morality || 0) + (aiResponse.roundData.moralityChange || 0);
            const finalMoney = (currentData.money || 0) + (aiResponse.roundData.moneyChange || 0);

            const playerUpdatesForDb = {
                timeOfDay: finalTimeOfDay,
                stamina: finalStamina,
                shortActionCounter,
                ...finalDate,
                currentLocation: aiResponse.roundData.LOC || player.currentLocation,
                internalPower: newInternal,
                externalPower: newExternal,
                lightness: newLightness,
                morality: finalMorality,
                money: Math.max(0, finalMoney),
            };
            transaction.update(userDocRef, playerUpdatesForDb);
        });
        
        const finalSaveData = { ...aiResponse.roundData, story: aiResponse.story, R: newRoundNumber, timeOfDay: finalTimeOfDay, ...finalDate, stamina: newStamina };
        const newSaveRef = userDocRef.collection('game_saves').doc(`R${newRoundNumber}`);
        batch.set(newSaveRef, finalSaveData);

        const newSummary = await getAISummary(longTermSummary, finalSaveData);
        batch.set(summaryDocRef, { text: newSummary, lastUpdated: newRoundNumber }, { merge: true });

        await batch.commit();

        invalidateNovelCache(userId);
        updateLibraryNovel(userId, username);
        
        const [fullInventory, updatedSkills, finalPlayerProfile] = await Promise.all([
            getRawInventory(userId),
            getPlayerSkills(userId),
            userDocRef.get().then(doc => doc.data())
        ]);
        
        const suggestion = await getAISuggestion(finalSaveData);
        const finalBulkScore = calculateBulkScore(fullInventory);
        
        const finalRoundDataForClient = { 
            ...finalSaveData, 
            ...finalPlayerProfile, 
            skills: updatedSkills, 
            inventory: fullInventory,
            money: finalPlayerProfile.money || 0,
            bulkScore: finalBulkScore, 
            suggestion: suggestion 
        };

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
