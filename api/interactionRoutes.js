// /api/interactionRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIStory, getAISummary, getAISuggestion, getAIProactiveChat, getAIChatSummary, getAIPassOutEvent } = require('../services/aiService'); 
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
        
        let userProfile = userDoc.exists ? userDoc.data() : {};
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
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";
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

        const currentTimeOfDay = userProfile.timeOfDay || '上午';
        
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
        
        // --- 【核心修改】生成「演員候補名單」 ---
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
        // --- 修改結束 ---

        const aiResponse = await getAIStory(playerModelChoice, longTermSummary, JSON.stringify(recentHistoryRounds), playerAction, { ...userProfile, ...currentDate }, username, currentTimeOfDay, playerPower, playerMorality, [], romanceEventToWeave, locationContext, npcContext, totalBulkScore, Array.from(actorCandidates));
        if (!aiResponse || !aiResponse.roundData) throw new Error("主AI未能生成有效回應。");
        
        if (aiResponse.roundData.NPC && Array.isArray(aiResponse.roundData.NPC)) {
            const aliveNpcs = [];
            for (const sceneNpc of aiResponse.roundData.NPC) {
                const npcProfile = npcContext[sceneNpc.name];
                if (!npcProfile || npcProfile.isDeceased !== true) {
                    aliveNpcs.push(sceneNpc);
                }
            }
            aiResponse.roundData.NPC = aliveNpcs;
        }
        
        const newRoundNumber = (currentRound || 0) + 1;
        aiResponse.roundData.R = newRoundNumber;
        aiResponse.story = aiResponse.story || "江湖靜悄悄，似乎什麼也沒發生。";

        const { timeOfDay: aiNextTimeOfDay, daysToAdvance: aiDaysToAdvance, staminaChange = 0 } = aiResponse.roundData;
        let newStamina = userProfile.stamina;

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
                console.log(`[精力系統] 玩家長時間休息(${slotsPassed}個時辰)，精力完全恢復。`);
            } else {
                newStamina = Math.min(100, newStamina + (25 * slotsPassed));
                console.log(`[精力系統] 玩家短暫休息(${slotsPassed}個時辰)，精力恢復 ${25 * slotsPassed}。`);
            }
        } else {
            newStamina += staminaChange;
        }

        if (!isResting) {
            const passiveStaminaDrain = Math.floor(Math.random() * 5) + 1; 
            newStamina -= passiveStaminaDrain;
            console.log(`[精力系統] 非休息回合，額外消耗精力: ${passiveStaminaDrain}`);
        }
        
        newStamina = Math.max(0, Math.min(100, newStamina));
        
        if (newStamina <= 0) {
            console.log(`[精力系統] 玩家 ${username} 精力耗盡，觸發昏迷事件！`);
            const passOutEvent = { 
                story: "你感到一陣天旋地轉，眼前的景象逐漸模糊，最終眼前一黑，徹底失去了知覺。",
                PC: "你因體力不支而昏倒在地。",
                EVT: "力竭昏迷",
                stamina: 50, 
                itemChanges: [],
                powerChange: {},
                moralityChange: 0,
            };

            aiResponse.story = passOutEvent.story;
            aiResponse.roundData.PC = passOutEvent.PC;
            aiResponse.roundData.EVT = passOutEvent.EVT;
            aiResponse.roundData.itemChanges = passOutEvent.itemChanges;
            aiResponse.roundData.powerChange = passOutEvent.powerChange;
            aiResponse.roundData.moralityChange = passOutEvent.moralityChange;
            newStamina = passOutEvent.stamina; 
        }
        
        if (aiResponse.roundData.removeDeathCountdown) {
            await userDocRef.update({ deathCountdown: admin.firestore.FieldValue.delete() });
            delete userProfile.deathCountdown; 
            delete aiResponse.roundData.removeDeathCountdown;
        }
        
        aiResponse.roundData.story = aiResponse.story;
        
        const allNpcUpdates = [
            ...(aiResponse.roundData.npcUpdates || []),
            ...(romanceEventData ? romanceEventData.npcUpdates : [])
        ];
        
        const practiceKeywords = ['修練', '練習', '打坐', '閉關', '領悟'];
        const durationKeywords = ['天', '時辰', '日', '夜', '時'];
        const isShortPractice = practiceKeywords.some(kw => playerAction.includes(kw)) && !durationKeywords.some(kw => playerAction.includes(kw));

        if (isShortPractice) {
            console.log(`[遊戲機制] 偵測到無時長修練，將限制屬性成長。`);
            if (aiResponse.roundData.powerChange) {
                aiResponse.roundData.powerChange.internal = Math.min(aiResponse.roundData.powerChange.internal || 0, 10);
                aiResponse.roundData.powerChange.external = Math.min(aiResponse.roundData.powerChange.external || 0, 10);
                aiResponse.roundData.powerChange.lightness = Math.min(aiResponse.roundData.powerChange.lightness || 0, 10);
            }
            if (aiResponse.roundData.skillChanges) {
                aiResponse.roundData.skillChanges.forEach(sc => {
                    if (sc.expChange) {
                        sc.expChange = Math.min(sc.expChange, 10);
                    }
                });
            }
        }
        
        const { levelUpEvents, customSkillCreationResult } = await updateSkills(userId, aiResponse.roundData.skillChanges, userProfile);
        if (levelUpEvents.length > 0) {
            aiResponse.roundData.levelUpEvents = levelUpEvents;
        }
        if (customSkillCreationResult && !customSkillCreationResult.success) {
            aiResponse.story += `\n\n（${customSkillCreationResult.reason}）`;
        }

        await Promise.all([
            updateInventory(userId, aiResponse.roundData.itemChanges, aiResponse.roundData),
            updateRomanceValues(userId, aiResponse.roundData.romanceChanges),
            updateFriendlinessValues(userId, aiResponse.roundData.NPC),
            processNpcUpdates(userId, allNpcUpdates)
        ]);
        
        const updatedUserProfileDoc = await userDocRef.get();
        userProfile = updatedUserProfileDoc.exists ? updatedUserProfileDoc.data() : {};
        
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
            const npcUpdatePromises = aiResponse.roundData.NPC.map(async (npc) => {
                if (!npc.name) return;
                const npcTemplateRef = db.collection('npcs').doc(npc.name);
                const npcStateDocRef = userDocRef.collection('npc_states').doc(npc.name);
                if (npc.isDeceased) {
                    return npcStateDocRef.set({ isDeceased: true }, { merge: true });
                }
                const templateDoc = await npcTemplateRef.get();
                if (!templateDoc.exists) {
                    console.log(`[互動路由] 偵測到「${npc.name}」的模板不存在，強制執行建檔...`);
                    return createNpcProfileInBackground(userId, username, npc, aiResponse.roundData, userProfile);
                } else {
                    const newSceneLocation = aiResponse.roundData.LOC[0];
                    if (newSceneLocation) {
                        return npcStateDocRef.set({ currentLocation: newSceneLocation }, { merge: true });
                    }
                }
            });
            await Promise.all(npcUpdatePromises);
        }

        if (aiResponse.roundData.enterCombat) {
            console.log(`[戰鬥系統] 偵測到戰鬥觸發信號！`);
            const maxHp = (userProfile.externalPower || 5) * 10 + 50;
            const combatState = { 
                turn: 1, 
                player: { 
                    username: username,
                    skills: skills,
                    hp: maxHp,
                    maxHp: maxHp
                }, 
                enemies: aiResponse.roundData.combatants,
                allies: aiResponse.roundData.allies || [], 
                bystanders: aiResponse.roundData.bystanders || [], 
                log: [aiResponse.roundData.combatIntro || '戰鬥開始了！'],
                isSparring: aiResponse.roundData.isSparring || false 
            };
            await userDocRef.collection('game_state').doc('current_combat').set(combatState);
            aiResponse.combatInfo = { status: 'COMBAT_START', initialState: combatState };
        }
        
        const { mentionedLocations, locationUpdates } = aiResponse.roundData;

        if (mentionedLocations && Array.isArray(mentionedLocations)) {
            for (const locName of mentionedLocations) {
                generateAndCacheLocation(userId, locName, '未知', newSummary)
                    .catch(err => console.error(`[世界引擎] 地點 ${locName} 的背景生成失敗:`, err));
            }
        }
        
        const currentLocationForUpdate = aiResponse.roundData.LOC?.[0];
        if (locationUpdates && Array.isArray(locationUpdates) && currentLocationForUpdate) {
            processLocationUpdates(userId, currentLocationForUpdate, locationUpdates)
                .catch(err => console.error(`[檔案管理員] 地點 ${currentLocationForUpdate} 的即時更新失敗:`, err));
        }

        const { powerChange = {}, moralityChange = 0, timeOfDay: nextTimeOfDay, daysToAdvance } = aiResponse.roundData;
        
        let finalDate = { ...currentDate };
        let finalTimeOfDay = nextTimeOfDay || userProfile.timeOfDay;
        let shortActionCounter = userProfile.shortActionCounter || 0;

        const timeDidChange = (daysToAdvance && daysToAdvance > 0) || (finalTimeOfDay !== userProfile.timeOfDay);

        if (timeDidChange) {
            shortActionCounter = 0; 
            if (daysToAdvance > 0) {
                 for (let i = 0; i < daysToAdvance; i++) { finalDate = advanceDate(finalDate); }
            } else {
                 const oldTimeIndex = TIME_SEQUENCE.indexOf(userProfile.timeOfDay);
                 const newTimeIndex = TIME_SEQUENCE.indexOf(finalTimeOfDay);
                 if (newTimeIndex < oldTimeIndex) { finalDate = advanceDate(finalDate); }
            }
        } else {
            shortActionCounter++;
            if (shortActionCounter >= 3) {
                console.log(`[遊戲機制] 短時行動計數器達到3，強制推進時間。`);
                const currentTimeIndex = TIME_SEQUENCE.indexOf(userProfile.timeOfDay);
                const nextTimeIndex = (currentTimeIndex + 1) % TIME_SEQUENCE.length;
                finalTimeOfDay = TIME_SEQUENCE[nextTimeIndex];
                if (nextTimeIndex === 0) { 
                    finalDate = advanceDate(finalDate);
                }
                shortActionCounter = 0;
            }
        }
        
        const newInternalPower = Math.max(0, Math.min(999, (userProfile.internalPower || 0) + (powerChange.internal || 0)));
        const newExternalPower = Math.max(0, Math.min(999, (userProfile.externalPower || 0) + (powerChange.external || 0)));
        const newLightness = Math.max(0, Math.min(999, (userProfile.lightness || 0) + (powerChange.lightness || 0)));
        let newMorality = Math.max(-100, Math.min(100, (userProfile.morality || 0) + moralityChange));

        Object.assign(aiResponse.roundData, { internalPower: newInternalPower, externalPower: newExternalPower, lightness: newLightness, morality: newMorality, stamina: newStamina, timeOfDay: finalTimeOfDay, ...finalDate });
        
        if (aiResponse.roundData.playerState === 'dead') {
             await userDocRef.update({ isDeceased: true });
             aiResponse.roundData.PC = aiResponse.roundData.causeOfDeath || '你在這次事件中不幸殞命。';
        }

        if (userProfile.deathCountdown) {
            aiResponse.roundData.deathCountdown = userProfile.deathCountdown;
        }

        const playerUpdatesForDb = {
            timeOfDay: finalTimeOfDay,
            internalPower: newInternalPower,
            externalPower: newExternalPower,
            lightness: newLightness,
            morality: newMorality,
            stamina: newStamina, 
            shortActionCounter: shortActionCounter,
            ...finalDate
        };
        
        if (newInternalPower > (userProfile.maxInternalPowerAchieved || 0)) {
            playerUpdatesForDb.maxInternalPowerAchieved = newInternalPower;
        }
        if (newExternalPower > (userProfile.maxExternalPowerAchieved || 0)) {
            playerUpdatesForDb.maxExternalPowerAchieved = newExternalPower;
        }
        if (newLightness > (userProfile.maxLightnessAchieved || 0)) {
            playerUpdatesForDb.maxLightnessAchieved = newLightness;
        }

        await Promise.all([
             userDocRef.update(playerUpdatesForDb),
            summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber }),
            userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData)
        ]);

        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗:", err));

        if (newRoundNumber > 5 && Math.random() < 0.2) { 
            triggerBountyGeneration(userId, newSummary).catch(err => console.error("背景生成懸賞失敗:", err));
        }

        aiResponse.locationData = await getMergedLocationData(userId, aiResponse.roundData.LOC);

        if (!aiResponse.roundData.enterCombat && aiResponse.roundData.playerState !== 'dead') {
             aiResponse.proactiveChat = await proactiveChatEngine(userId, { ...userProfile, username }, aiResponse.roundData);
             if(aiResponse.proactiveChat) {
                 const finalInventoryState = await getInventoryState(userId);
                 aiResponse.roundData.ITM = finalInventoryState.itemsString;
                 aiResponse.roundData.money = finalInventoryState.money;
             }
        }

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

    if (!fullChatHistory || fullChatHistory.length === 0) {
        return res.json({ message: '對話已結束，江湖故事繼續。' });
    }

    try {
        const chatSummary = await getAIChatSummary(playerModelChoice, username, npcName, fullChatHistory);
        if (!chatSummary) throw new Error('AI未能成功總結對話內容。');

        const savesSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const currentRound = savesSnapshot.empty ? 0 : savesSnapshot.docs[0].data().R;
        
        req.body.action = chatSummary;
        req.body.round = currentRound;
        req.body.model = playerModelChoice;
        
        interactRouteHandler(req, res);

    } catch (error) {
        console.error(`[密談系統] 結束與NPC(${npcName})的對話時出錯:`, error);
        res.status(500).json({ message: '結束對話並更新世界時發生錯誤。' });
    }
});

module.exports = router;
