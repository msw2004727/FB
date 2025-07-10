// /api/interactionRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIStory, getAISummary, getAISuggestion, getAIProactiveChat, getAIChatSummary, getAIEventDirectorResult } = require('../services/aiService'); 
const {
    TIME_SEQUENCE,
    advanceDate,
    updateInventory,
    updateRomanceValues,
    updateFriendlinessValues,
    checkAndTriggerRomanceEvent,
    getInventoryState,
    getRawInventory,
    createNpcProfileInBackground,
    invalidateNovelCache,
    updateLibraryNovel,
    updateSkills,
    getPlayerSkills,
    processNpcUpdates,
    getMergedLocationData,
    getMergedNpcProfile
} = require('./gameHelpers');
const { triggerBountyGeneration, generateAndCacheLocation } = require('./worldEngine');
const { processLocationUpdates } = require('./locationManager');

const db = admin.firestore();

// 主動互動引擎 (Proactive Chat Engine)
const proactiveChatEngine = async (userId, playerProfile, finalRoundData) => {
    const PROACTIVE_CHAT_COOLDOWN = 5;

    const gameStateRef = db.collection('users').doc(userId).collection('game_state').doc('engine_state');
    const gameStateDoc = await gameStateRef.get();
    const engineState = gameStateDoc.exists ? gameStateDoc.data() : { proactiveChatCooldown: 0, triggeredEvents: {} };

    if (engineState.proactiveChatCooldown > 0) {
        await gameStateRef.set({ proactiveChatCooldown: admin.firestore.FieldValue.increment(-1) }, { merge: true });
        return null;
    }

    const playerLocation = finalRoundData.LOC[0];
    if (!playerLocation) return null;

    const npcsSnapshot = await db.collection('users').doc(userId).collection('npc_states')
        .where('currentLocation', '==', playerLocation)
        .get();

    if (npcsSnapshot.empty) return null;
    
    for (const npcDoc of npcsSnapshot.docs) {
        const npcState = npcDoc.data();
        const npcName = npcDoc.id;
        const npcProfile = await getMergedNpcProfile(userId, npcName);
        if (!npcProfile) continue;
        
        if (!npcState.triggeredProactiveEvents) {
            npcState.triggeredProactiveEvents = [];
        }

        let triggerEvent = null;

        const trustEventId = `trust_${npcName}`;
        if (npcState.friendlinessValue >= 70 && !npcState.triggeredProactiveEvents.includes(trustEventId)) {
            triggerEvent = { type: 'TRUST_BREAKTHROUGH', details: '友好度達到信賴' };
            npcState.triggeredProactiveEvents.push(trustEventId);
        }
        const romanceEventId = `romance_${npcName}`;
        if (!triggerEvent && npcState.romanceValue >= 50 && !npcState.triggeredProactiveEvents.includes(romanceEventId)) {
            triggerEvent = { type: 'ROMANCE_BREAKTHROUGH', details: '心動值達到曖昧' };
            npcState.triggeredProactiveEvents.push(romanceEventId);
        }

        if (triggerEvent) {
            console.log(`[主動互動引擎] 偵測到觸發事件: ${npcProfile.name} 的 ${triggerEvent.type}`);
            
            const proactiveChatResult = await getAIProactiveChat(playerProfile, npcProfile, triggerEvent);

            await npcDoc.ref.update({ triggeredProactiveEvents: npcState.triggeredProactiveEvents });
            
            await gameStateRef.set({ proactiveChatCooldown: PROACTIVE_CHAT_COOLDOWN }, { merge: true });

            if (proactiveChatResult.itemChanges && proactiveChatResult.itemChanges.length > 0) {
                await updateInventory(userId, proactiveChatResult.itemChanges);
            }

            return {
                npcName: npcProfile.name,
                openingLine: proactiveChatResult.openingLine,
                itemChanges: proactiveChatResult.itemChanges || []
            };
        }
    }

    return null;
};


// 處理玩家主要動作的核心函式
const interactRouteHandler = async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;

    try {
        const { action: playerAction, round: currentRound, model: playerModelChoice } = req.body;
        const userDocRef = db.collection('users').doc(userId);

        // --- 【核心修改】將變數宣告移至 try 區塊的開頭 ---
        let aiResponse;
        let userProfile;
        let longTermSummary;
        let currentTimeOfDay;
        
        // --- 【核心修改】世界因果引擎 ---
        const worldEventsRef = userDocRef.collection('world_events').orderBy('createdAt', 'asc').limit(1);
        const activeEventsSnapshot = await worldEventsRef.get();

        if (!activeEventsSnapshot.empty) {
            const eventDoc = activeEventsSnapshot.docs[0];
            const worldEvent = eventDoc.data();
            console.log(`[世界因果引擎] 偵測到活動事件: ${worldEvent.eventType}`);
            
            userProfile = (await userDocRef.get()).data(); // 在這裡獲取一次即可
            const eventResult = await getAIEventDirectorResult(playerModelChoice, userProfile, worldEvent);
            
            aiResponse = {
                story: eventResult.story,
                roundData: {
                    ...eventResult.playerChanges,
                    itemChanges: eventResult.itemChanges,
                    npcUpdates: eventResult.npcUpdates
                }
            };
            
            // 需要從 userProfile 獲取當前時間以保持一致性
            currentTimeOfDay = userProfile.timeOfDay || '上午';


            if (worldEvent.turnsRemaining - 1 <= 0) {
                await eventDoc.ref.delete();
                 console.log(`[世界因果引擎] 事件 ${worldEvent.eventType} 已結束。`);
            } else {
                await eventDoc.ref.update({
                    turnsRemaining: admin.firestore.FieldValue.increment(-1),
                    currentStage: eventResult.nextStage,
                    lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        } else {
            // 如果沒有世界事件，才執行正常的故事AI
            const summaryDocRef = userDocRef.collection('game_state').doc('summary');

            const [userDoc, summaryDoc, savesSnapshot, skills, rawInventory] = await Promise.all([
                userDocRef.get(),
                summaryDocRef.get(),
                userDocRef.collection('game_saves').orderBy('R', 'desc').limit(3).get(),
                getPlayerSkills(userId),
                getRawInventory(userId)
            ]);
            
            let totalBulkScore = 0;
            if (rawInventory) {
                Object.values(rawInventory).forEach(item => {
                    const quantity = item.quantity || 1;
                    switch (item.bulk) {
                        case '中': totalBulkScore += 1 * quantity; break;
                        case '重': totalBulkScore += 3 * quantity; break;
                        case '極重': totalBulkScore += 10 * quantity; break;
                        default: break;
                    }
                });
            }
            
            userProfile = userDoc.exists ? userDoc.data() : {};
            if (userProfile.isDeceased) {
                return res.status(403).json({ message: '逝者已矣，無法再有任何動作。' });
            }
            if (userProfile.deathCountdown && userProfile.deathCountdown > 0) {
                const newCountdown = userProfile.deathCountdown - 1;
                if (newCountdown <= 0) {
                    await userDocRef.update({ isDeceased: true, deathCountdown: admin.firestore.FieldValue.delete() });
                    const lastSaveData = savesSnapshot.docs[0]?.data() || {};
                    const finalSave = {
                        ...lastSaveData,
                        R: lastSaveData.R + 1,
                        playerState: 'dead',
                        PC: '你終究沒能撐過去，在傷痛中耗盡了最後一絲氣力。',
                        story: '你的意識逐漸模糊，江湖中的恩怨情仇如走馬燈般在眼前閃過，最終，一切歸於永恆的寂靜。',
                        EVT: '氣力耗盡，傷重不治'
                    };
                    await userDocRef.collection('game_saves').doc(`R${finalSave.R}`).set(finalSave);
                    return res.json({ roundData: finalSave });
                } else {
                    await userDocRef.update({ deathCountdown: newCountdown });
                    userProfile.deathCountdown = newCountdown; 
                }
            }
            longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";
            const lastSave = savesSnapshot.docs[0]?.data() || {};
            
            if (userProfile.stamina === undefined) {
                userProfile.stamina = 100;
            }

            const romanceEventData = await checkAndTriggerRomanceEvent(userId, { ...userProfile, username });
            const romanceEventToWeave = romanceEventData ? romanceEventData.eventStory : null;
            const recentHistoryRounds = savesSnapshot.docs.map(doc => doc.data()).sort((a, b) => a.R - b.R);
            const playerPower = { internal: userProfile.internalPower || 5, external: userProfile.externalPower || 5, lightness: userProfile.lightness || 5 };
            
            if (userProfile.stamina < 60) {
                playerPower.internal *= 0.8;
                playerPower.external *= 0.8;
                playerPower.lightness *= 0.8;
            }
            if (userProfile.stamina < 40) {
                playerPower.internal *= 0.5;
                playerPower.external *= 0.5;
                playerPower.lightness *= 0.5;
            }
            
            const playerMorality = userProfile.morality === undefined ? 0 : userProfile.morality;
            
            const currentDate = {
                yearName: userProfile.yearName || lastSave.yearName || '元祐',
                year: userProfile.year || lastSave.year || 1,
                month: userProfile.month || lastSave.month || 1,
                day: userProfile.day || lastSave.day || 1,
            };

            currentTimeOfDay = userProfile.timeOfDay || '上午';
            
            const locationContext = await getMergedLocationData(userId, lastSave.LOC);
            const npcContext = {};
            if (lastSave.NPC && lastSave.NPC.length > 0) {
                const npcPromises = lastSave.NPC.map(npcInScene => getMergedNpcProfile(userId, npcInScene.name));
                const npcProfiles = await Promise.all(npcPromises);
                npcProfiles.forEach(profile => {
                    if (profile) {
                        npcContext[profile.name] = profile;
                    }
                });
            }
            
            const actorCandidates = new Set();
            const allNpcTemplatesSnapshot = await db.collection('npcs').get();
            const existingNpcTemplates = new Set(allNpcTemplatesSnapshot.docs.map(doc => doc.id));

            for (const npc of Object.values(npcContext)) {
                if (npc.relationships) {
                    for (const relatedNpcName of Object.values(npc.relationships)) {
                        if (relatedNpcName && !existingNpcTemplates.has(relatedNpcName)) {
                            actorCandidates.add(relatedNpcName);
                        }
                    }
                }
            }

            aiResponse = await getAIStory(playerModelChoice, longTermSummary, JSON.stringify(recentHistoryRounds), playerAction, { ...userProfile, ...currentDate }, username, currentTimeOfDay, playerPower, playerMorality, [], romanceEventToWeave, locationContext, npcContext, totalBulkScore, Array.from(actorCandidates));
            if (!aiResponse || !aiResponse.roundData) throw new Error("主AI未能生成有效回應。");
        }
        // --- 引擎結束 ---
        
        const lastSaveSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const lastSave = lastSaveSnapshot.empty ? {} : lastSaveSnapshot.docs[0].data();
        
        if (aiResponse.roundData.NPC && Array.isArray(aiResponse.roundData.NPC)) {
            const aliveNpcs = [];
            const npcProfiles = await Promise.all(
                aiResponse.roundData.NPC.map(npc => getMergedNpcProfile(userId, npc.name))
            );
            
            aiResponse.roundData.NPC.forEach((sceneNpc, index) => {
                const profile = npcProfiles[index];
                if (!profile || profile.isDeceased !== true) {
                    aliveNpcs.push(sceneNpc);
                }
            });
            aiResponse.roundData.NPC = aliveNpcs;
        }
        
        const newRoundNumber = (lastSave.R || 0) + 1;
        aiResponse.roundData.R = newRoundNumber;
        aiResponse.story = aiResponse.story || "江湖靜悄悄，似乎什麼也沒發生。";
        
        // 重新獲取最新的 userProfile
        userProfile = (await userDocRef.get()).data();
        
        const { timeOfDay: aiNextTimeOfDay, daysToAdvance: aiDaysToAdvance, staminaChange = 0 } = aiResponse.roundData;
        let newStamina = userProfile.stamina || 100;

        const restKeywords = ['睡覺', '休息', '歇息', '歇會', '小憩', '安歇'];
        const isResting = restKeywords.some(kw => playerAction.includes(kw));
        
        const timeDidAdvance = (aiDaysToAdvance && aiDaysToAdvance > 0) || (aiNextTimeOfDay && aiNextTimeOfDay !== currentTimeOfDay);
        
        if (isResting && timeDidAdvance) {
            const oldTimeIndex = TIME_SEQUENCE.indexOf(currentTimeOfDay);
            const newTimeIndex = TIME_SEQUENCE.indexOf(aiNextTimeOfDay);
            let slotsPassed = 0;

            if (aiDaysToAdvance > 0) {
                slotsPassed = aiDaysToAdvance * TIME_SEQUENCE.length;
            } else {
                slotsPassed = newTimeIndex > oldTimeIndex ? newTimeIndex - oldTimeIndex : (TIME_SEQUENCE.length - oldTimeIndex) + newTimeIndex;
            }

            if (slotsPassed >= 4) {
                newStamina = 100;
            } else {
                newStamina = Math.min(100, newStamina + (25 * slotsPassed));
            }
        } else {
            newStamina += staminaChange;
        }

        const isShortAction = !timeDidAdvance && !isResting;
        let shortActionCounter = userProfile.shortActionCounter || 0;

        if (isShortAction) {
            shortActionCounter++;
        } else {
            shortActionCounter = 0; // 重置計數器
        }

        let finalTimeOfDay = aiNextTimeOfDay || currentTimeOfDay;
        let finalDate = { year: userProfile.year, month: userProfile.month, day: userProfile.day, yearName: userProfile.yearName };
        let daysToAdd = aiDaysToAdvance || 0;
        
        if (shortActionCounter >= 3) {
            const currentTimeIndex = TIME_SEQUENCE.indexOf(finalTimeOfDay);
            const nextTimeIndex = (currentTimeIndex + 1) % TIME_SEQUENCE.length;
            finalTimeOfDay = TIME_SEQUENCE[nextTimeIndex];
            if (nextTimeIndex === 0) { // 如果從深夜跳到清晨
                daysToAdd += 1;
            }
            shortActionCounter = 0; // 重置計數器
            console.log(`[時間系統] 短時行動觸發時間推進，新時辰: ${finalTimeOfDay}`);
        }

        for (let i = 0; i < daysToAdd; i++) {
            finalDate = advanceDate(finalDate);
        }

        if (newStamina <= 0) {
             const passOutEvent = { 
                story: "你感到一陣天旋地轉，眼前的景象逐漸模糊，最終眼前一黑，徹底失去了知覺。", PC: "你因體力不支而昏倒在地。",
                EVT: "力竭昏迷", stamina: 50, itemChanges: [], powerChange: {}, moralityChange: 0,
            };
            aiResponse.story = passOutEvent.story;
            aiResponse.roundData = { ...aiResponse.roundData, ...passOutEvent };
            newStamina = passOutEvent.stamina; 
        }
        
        if (aiResponse.roundData.removeDeathCountdown) {
            await userDocRef.update({ deathCountdown: admin.firestore.FieldValue.delete() });
            delete userProfile.deathCountdown; 
            delete aiResponse.roundData.removeDeathCountdown;
        }
        
        const { levelUpEvents, customSkillCreationResult } = await updateSkills(userId, aiResponse.roundData.skillChanges, userProfile);
        if (levelUpEvents.length > 0) {
            aiResponse.roundData.levelUpEvents = levelUpEvents;
            const levelUpNarrative = await getAIStory(playerModelChoice, longTermSummary, JSON.stringify([aiResponse.roundData]), "我剛剛武學境界有所突破", { ...userProfile, ...finalDate }, username, finalTimeOfDay, playerPower, userProfile.morality, levelUpEvents, null, locationContext, npcContext, totalBulkScore, []);
            if (levelUpNarrative && levelUpNarrative.story) {
                aiResponse.story += `\n\n${levelUpNarrative.story}`;
            }
        }

        if (customSkillCreationResult && !customSkillCreationResult.success) {
            aiResponse.story += `\n\n（${customSkillCreationResult.reason}）`;
        }
        
        await Promise.all([
            updateInventory(userId, aiResponse.roundData.itemChanges, aiResponse.roundData),
            updateRomanceValues(userId, aiResponse.roundData.romanceChanges),
            updateFriendlinessValues(userId, aiResponse.roundData.NPC),
            processNpcUpdates(userId, aiResponse.roundData.npcUpdates || []),
            processLocationUpdates(userId, lastSave.LOC?.[0], aiResponse.roundData.locationUpdates)
        ]);
        
        if(aiResponse.roundData.mentionedLocations && aiResponse.roundData.mentionedLocations.length > 0) {
             const locationPromises = aiResponse.roundData.mentionedLocations.map(locName => 
                generateAndCacheLocation(userId, locName, '未知', longTermSummary)
            );
            await Promise.all(locationPromises);
        }
        
        const updatedUserProfileDoc = await userDocRef.get();
        userProfile = updatedUserProfileDoc.exists ? updatedUserProfileDoc.data() : {};
        
        // 重新獲取一次 longTermSummary 以包含新生成的 NPC 資訊
        longTermSummary = (await summaryDocRef.get()).exists ? (await summaryDocRef.get()).data().text : "遊戲剛剛開始...";

        const [newSummary, suggestion, inventoryState, updatedSkills, newBountiesSnapshot] = await Promise.all([
            getAISummary(longTermSummary, aiResponse.roundData),
            getAISuggestion(aiResponse.roundData),
            getInventoryState(userId),
            getPlayerSkills(userId),
            userDocRef.collection('bounties').where('isRead', '==', false).limit(1).get()
        ]);
        
        aiResponse.hasNewBounties = !newBountiesSnapshot.empty;
        aiResponse.suggestion = suggestion;
        aiResponse.roundData.ITM = inventoryState.itemsString;
        aiResponse.roundData.money = inventoryState.money;
        aiResponse.roundData.skills = updatedSkills;

        if (aiResponse.roundData.NPC && Array.isArray(aiResponse.roundData.NPC)) {
            const npcUpdatePromises = aiResponse.roundData.NPC.map(npc => {
                 if (npc.isNew) {
                    return createNpcProfileInBackground(userId, username, npc, aiResponse.roundData, userProfile);
                 }
                 return Promise.resolve();
            });
            await Promise.all(npcUpdatePromises);
        }

        if (Math.random() < 0.05) { // 5% 的機率觸發懸賞生成
            triggerBountyGeneration(userId, newSummary);
        }

        const { powerChange = {}, moralityChange = 0 } = aiResponse.roundData;
        
        const newInternalPower = Math.max(0, Math.min(999, (userProfile.internalPower || 0) + (powerChange.internal || 0)));
        const newExternalPower = Math.max(0, Math.min(999, (userProfile.externalPower || 0) + (powerChange.external || 0)));
        const newLightness = Math.max(0, Math.min(999, (userProfile.lightness || 0) + (powerChange.lightness || 0)));
        let newMorality = Math.max(-100, Math.min(100, (userProfile.morality || 0) + moralityChange));
        
        const finalUserProfile = (await userDocRef.get()).data();
        aiResponse.roundData = { ...lastSave, ...aiResponse.roundData, ...inventoryState, ...finalUserProfile, ...finalDate, timeOfDay: finalTimeOfDay };
        
        const playerUpdatesForDb = {
            timeOfDay: finalTimeOfDay,
            internalPower: newInternalPower, externalPower: newExternalPower, lightness: newLightness,
            morality: newMorality, stamina: newStamina, ...finalDate, shortActionCounter
        };
        
        const proactiveChatResult = await proactiveChatEngine(userId, { ...userProfile, ...playerUpdatesForDb, username }, aiResponse.roundData);
        if (proactiveChatResult) {
            aiResponse.proactiveChat = proactiveChatResult;
        }

        await Promise.all([
             userDocRef.update(playerUpdatesForDb),
            db.collection('users').doc(userId).collection('game_state').doc('summary').set({ text: newSummary, lastUpdated: newRoundNumber }),
            userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData)
        ]);

        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗:", err));
        
        aiResponse.locationData = await getMergedLocationData(userId, aiResponse.roundData.LOC);
        res.json(aiResponse);

    } catch (error) {
        console.error(`[UserID: ${userId}] /interact 錯誤:`, error);
        if (!res.headersSent) {
            res.status(500).json({ message: error.message || "互動時發生未知錯誤" });
        }
    }
};

router.post('/interact', interactRouteHandler);

router.post('/end-chat', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const { npcName, fullChatHistory, model: playerModelChoice } = req.body;

    if (!npcName || !fullChatHistory) {
        return res.status(400).json({ message: '缺少必要的對話數據。' });
    }

    try {
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        const summaryDoc = await summaryDocRef.get();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "對話發生在一個未知的時間點。";
        
        const lastSaveSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get();
        if (lastSaveSnapshot.empty) {
            return res.status(404).json({ message: "找不到玩家存檔。" });
        }
        let lastRoundData = lastSaveSnapshot.docs[0].data();
        
        const chatSummary = await getAIChatSummary(playerModelChoice, username, npcName, fullChatHistory);
        
        let newRoundData = { ...lastRoundData, R: lastRoundData.R + 1 };
        newRoundData.EVT = chatSummary;
        newRoundData.story = `你結束了與${npcName}的交談，${chatSummary}。`;
        newRoundData.PC = `你與${npcName}深入交談了一番。`;

        const newSummary = await getAISummary(longTermSummary, newRoundData);
        const suggestion = await getAISuggestion(newRoundData);
        newRoundData.suggestion = suggestion;
        
        await db.collection('users').doc(userId).collection('game_saves').doc(`R${newRoundData.R}`).set(newRoundData);
        await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundData.R });

        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗(結束對話):", err));

        res.json({
            story: newRoundData.story,
            roundData: newRoundData,
            suggestion: newRoundData.suggestion,
        });

    } catch (error) {
        console.error(`[結束對話系統] 替玩家 ${username} 總結與 ${npcName} 的對話時出錯:`, error);
        res.status(500).json({ message: '總結對話時發生內部錯誤。' });
    }
});

module.exports = router;
