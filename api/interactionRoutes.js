// /api/interactionRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIStory, getAISummary, getAISuggestion, getAIProactiveChat, getAIChatSummary, getAIPostCombatResult } = require('../services/aiService'); 
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
    getMergedNpcProfile,
    getFriendlinessLevel
} = require('./gameHelpers');
const { triggerBountyGeneration, generateAndCacheLocation } = require('./worldEngine');
const { processLocationUpdates } = require('./locationManager');
const { processReputationChangesAfterDeath } = require('./reputationManager');


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
        if (!npcProfile || npcProfile.isDeceased) continue;
        
        // 復仇邏輯優先判斷
        if (npcState.revengeInfo && npcState.revengeInfo.target === playerProfile.username) {
            console.log(`[復仇引擎] 偵測到 ${npcName} 對玩家 ${playerProfile.username} 的復仇意圖！`);
            // 清除復仇標記，避免重複觸發
            await npcDoc.ref.update({ revengeInfo: admin.firestore.FieldValue.delete() });
            return {
                type: 'REVENGE_COMBAT',
                npcName: npcName,
                reason: npcState.revengeInfo.reason
            };
        }

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
                type: 'PROACTIVE_CHAT',
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
        
        const lastSaveSnapshotBeforeAction = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const lastSaveBeforeAction = lastSaveSnapshotBeforeAction.docs[0].data();

        // 檢查復仇事件
        const playerProfileForEngine = (await userDocRef.get()).data();
        const revengeEvent = await proactiveChatEngine(userId, { ...playerProfileForEngine, username }, lastSaveBeforeAction);
        if (revengeEvent && revengeEvent.type === 'REVENGE_COMBAT') {
            const combatStory = `${revengeEvent.npcName}見到你，想起${revengeEvent.reason}，怒火中燒，大喝一聲「納命來！」，便朝你攻了過來！`;
            const combatRound = {
                ...lastSaveBeforeAction,
                R: lastSaveBeforeAction.R + 1,
                story: combatStory,
                PC: `你遭遇了 ${revengeEvent.npcName} 的尋仇。`,
                EVT: '血親尋仇',
                enterCombat: true,
                combatants: [{ name: revengeEvent.npcName, status: "怒不可遏，前來尋仇！" }],
                combatIntro: combatStory
            };
             await userDocRef.collection('game_saves').doc(`R${combatRound.R}`).set(combatRound);
             return res.json({ roundData: combatRound, story: combatStory });
        }


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
        
        const worldEventsRef = userDocRef.collection('world_events').orderBy('createdAt', 'asc').limit(1);
        const activeEventsSnapshot = await worldEventsRef.get();
        let worldEventToWeave = null;
        if (!activeEventsSnapshot.empty) {
            const eventDoc = activeEventsSnapshot.docs[0];
            const worldEvent = eventDoc.data();
            worldEventToWeave = worldEvent;
            console.log(`[世界因果引擎] 偵測到活動事件: ${worldEvent.eventType}，已傳遞給主AI處理。`);

            if (worldEvent.turnsRemaining - 1 <= 0) {
                await eventDoc.ref.delete();
                console.log(`[世界因果引擎] 事件 ${worldEvent.eventType} 已結束。`);
            } else {
                await eventDoc.ref.update({
                    turnsRemaining: admin.firestore.FieldValue.increment(-1),
                    lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        }

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

        const aiResponse = await getAIStory(playerModelChoice, longTermSummary, JSON.stringify(recentHistoryRounds), playerAction, { ...userProfile, ...currentDate }, username, currentTimeOfDay, playerPower, playerMorality, [], romanceEventToWeave, worldEventToWeave, locationContext, npcContext, totalBulkScore, Array.from(actorCandidates));
        if (!aiResponse || !aiResponse.roundData) throw new Error("主AI未能生成有效回應。");
        
        if (aiResponse.roundData.NPC && Array.isArray(aiResponse.roundData.NPC)) {
            const npcProfiles = await Promise.all(
                aiResponse.roundData.NPC.map(npc => getMergedNpcProfile(userId, npc.name))
            );
            
            aiResponse.roundData.NPC.forEach((sceneNpc, index) => {
                const profile = npcProfiles[index];
                if (profile && profile.isDeceased === true) {
                    sceneNpc.isDeceased = true;
                }
            });
        }
        
        const newRoundNumber = (lastSave.R || 0) + 1;
        aiResponse.roundData.R = newRoundNumber;
        
        const { timeOfDay: aiNextTimeOfDay, daysToAdvance: aiDaysToAdvance, staminaChange = 0 } = aiResponse.roundData;
        let newStamina = (userProfile.stamina === undefined) ? 100 : userProfile.stamina;

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
            shortActionCounter = 0;
        }

        let finalTimeOfDay = aiNextTimeOfDay || currentTimeOfDay;
        let finalDate = { year: userProfile.year, month: userProfile.month, day: userProfile.day, yearName: userProfile.yearName };
        let daysToAdd = aiDaysToAdvance || 0;
        
        if (shortActionCounter >= 3) {
            const currentTimeIndex = TIME_SEQUENCE.indexOf(finalTimeOfDay);
            const nextTimeIndex = (currentTimeIndex + 1) % TIME_SEQUENCE.length;
            finalTimeOfDay = TIME_SEQUENCE[nextTimeIndex];
            if (nextTimeIndex === 0) {
                daysToAdd += 1;
            }
            shortActionCounter = 0;
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
        
        const currentLongTermSummary = (await summaryDocRef.get()).exists ? (await summaryDocRef.get()).data().text : "遊戲剛剛開始...";
        
        if (levelUpEvents.length > 0) {
            aiResponse.roundData.levelUpEvents = levelUpEvents;
            const levelUpNarrative = await getAIStory(playerModelChoice, currentLongTermSummary, JSON.stringify([aiResponse.roundData]), "我剛剛武學境界有所突破", { ...userProfile, ...finalDate }, username, finalTimeOfDay, playerPower, userProfile.morality, levelUpEvents, null, null, locationContext, npcContext, totalBulkScore, []);
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
                generateAndCacheLocation(userId, locName, '未知', currentLongTermSummary)
            );
            await Promise.all(locationPromises);
        }
        
        const updatedUserProfileDoc = await userDocRef.get();
        const finalUserProfile = updatedUserProfileDoc.exists ? updatedUserProfileDoc.data() : {};
        
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
                    return createNpcProfileInBackground(userId, username, npc, aiResponse.roundData, finalUserProfile);
                 }
                 return Promise.resolve();
            });
            await Promise.all(npcUpdatePromises);
        }

        if (Math.random() < 0.05) {
            triggerBountyGeneration(userId, newSummary);
        }

        const { powerChange = {}, moralityChange = 0 } = aiResponse.roundData;
        
        const newInternalPower = Math.max(0, Math.min(999, (finalUserProfile.internalPower || 0) + (powerChange.internal || 0)));
        const newExternalPower = Math.max(0, Math.min(999, (finalUserProfile.externalPower || 0) + (powerChange.external || 0)));
        const newLightness = Math.max(0, Math.min(999, (finalUserProfile.lightness || 0) + (powerChange.lightness || 0)));
        let newMorality = Math.max(-100, Math.min(100, (finalUserProfile.morality || 0) + moralityChange));
        
        const newStory = aiResponse.story || "江湖靜悄悄，似乎什麼也沒發生。";
        aiResponse.roundData = { 
            ...lastSave, 
            ...aiResponse.roundData, 
            ...inventoryState, 
            ...finalUserProfile, 
            ...finalDate, 
            timeOfDay: finalTimeOfDay,
            story: newStory 
        };
        
        const playerUpdatesForDb = {
            timeOfDay: finalTimeOfDay,
            internalPower: newInternalPower, externalPower: newExternalPower, lightness: newLightness,
            morality: newMorality, stamina: newStamina, ...finalDate, shortActionCounter
        };
        
        // 【核心修改】死亡後續回合計時器邏輯
        if (userProfile.deathAftermathCooldown && userProfile.deathAftermathCooldown > 1) {
            playerUpdatesForDb.deathAftermathCooldown = admin.firestore.FieldValue.increment(-1);
        } else if (userProfile.deathAftermathCooldown === 1) {
            playerUpdatesForDb.deathAftermathCooldown = admin.firestore.FieldValue.delete();
        }
        
        if (revengeEvent && revengeEvent.type === 'PROACTIVE_CHAT') {
            aiResponse.proactiveChat = revengeEvent;
        } else {
             const proactiveChatResult = await proactiveChatEngine(userId, { ...userProfile, ...playerUpdatesForDb, username }, aiResponse.roundData);
            if (proactiveChatResult) {
                aiResponse.proactiveChat = proactiveChatResult;
            }
        }


        await Promise.all([
             userDocRef.update(playerUpdatesForDb),
            summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber }),
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

const finalizeCombatHandler = async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const { combatResult, model: playerModelChoice } = req.body;

    if (!combatResult || !combatResult.finalState) {
        return res.status(400).json({ message: '缺少完整的戰鬥結果數據。' });
    }

    try {
        const userDocRef = db.collection('users').doc(userId);
        const summaryDocRef = userDocRef.collection('game_state').doc('summary');

        const lastSaveSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const preCombatRoundData = lastSaveSnapshot.docs[0].data();
        
        const userProfile = (await userDocRef.get()).data();
        
        const { finalState } = combatResult;
        
        // 【核心修改】找出兇手是誰
        const playerWon = finalState.enemies.every(e => e.hp <= 0);
        let killerName = null;
        if (playerWon && finalState.intention === '打死') {
            killerName = username; // 如果玩家贏了且意圖是打死，兇手就是玩家
        } else if (!playerWon && finalState.player.hp <= 0) {
            // 如果玩家輸了且死了，需要判斷是誰殺的（這裡簡化為第一個還有血的敵人）
            killerName = finalState.enemies.find(e => e.hp > 0)?.name || '未知敵人';
        }

        const postCombatOutcome = await getAIPostCombatResult(playerModelChoice, { ...userProfile, username }, finalState, combatResult.log, killerName);
        
        if (!postCombatOutcome || !postCombatOutcome.outcome) {
             throw new Error("戰後結算AI未能生成有效回應。");
        }
        
        let { summary, EVT, playerChanges, itemChanges, npcUpdates } = postCombatOutcome.outcome;
        
        await updateInventory(userId, itemChanges || [], preCombatRoundData);
        
        const updates = {};
        if (playerChanges && playerChanges.powerChange) {
            updates.internalPower = admin.firestore.FieldValue.increment(playerChanges.powerChange.internal || 0);
            updates.externalPower = admin.firestore.FieldValue.increment(playerChanges.powerChange.external || 0);
            updates.lightness = admin.firestore.FieldValue.increment(playerChanges.powerChange.lightness || 0);
        }
        if (playerChanges && playerChanges.moralityChange) {
            updates.morality = admin.firestore.FieldValue.increment(playerChanges.moralityChange || 0);
        }

        // 【核心修改】找出所有死亡NPC，並呼叫關係處理器
        const killedNpcNames = (npcUpdates || []).filter(u => u.fieldToUpdate === 'isDeceased' && u.newValue === true).map(u => u.npcName);

        if (killedNpcNames.length > 0) {
            // 如果有NPC死亡，則重置計時器
            updates.deathAftermathCooldown = 5;
            
            const reputationSummary = await processReputationChangesAfterDeath(
                userId, 
                killedNpcNames, // 傳遞整個死亡名單
                preCombatRoundData.LOC[0], 
                combatResult.finalState.allies.map(a => a.name), 
                killerName
            );
            if (reputationSummary) {
                summary += `\n\n**【江湖反應】** ${reputationSummary}`;
            }
        }
        
        // 統一更新玩家狀態
        if (Object.keys(updates).length > 0) {
            await userDocRef.update(updates);
        }
        
        // 統一更新所有NPC狀態
        if (npcUpdates && npcUpdates.length > 0) {
            await processNpcUpdates(userId, npcUpdates);
        }
        
        const newRoundNumber = preCombatRoundData.R + 1;
        
        const [updatedUserDoc, inventoryState, updatedSkills] = await Promise.all([
            userDocRef.get(),
            getInventoryState(userId),
            getPlayerSkills(userId)
        ]);
        const finalUserProfile = updatedUserDoc.data();
        
        const finalRoundData = {
            ...preCombatRoundData,
            ...finalUserProfile,
            ...inventoryState,
            R: newRoundNumber,
            story: summary,
            PC: playerChanges.PC || summary,
            EVT: EVT || '一場激鬥之後',
            skills: updatedSkills,
        };
        
        const finalNpcList = [];
        const sceneNpcNames = new Set(finalState.enemies.map(e => e.name).concat(finalState.allies.map(a => a.name)));
        
        for (const npcName of sceneNpcNames) {
            const profile = await getMergedNpcProfile(userId, npcName);
            if (profile) {
                finalNpcList.push({
                    name: profile.name,
                    status: profile.isDeceased ? '已無氣息' : (profile.status || '狀態不明'),
                    friendliness: getFriendlinessLevel(profile.friendlinessValue),
                    isDeceased: profile.isDeceased || false
                });
            }
        }
        finalRoundData.NPC = finalNpcList;

        const longTermSummary = (await summaryDocRef.get()).data()?.text || '...';
        const newSummary = await getAISummary(longTermSummary, finalRoundData);
        const suggestion = await getAISuggestion(finalRoundData);

        await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });
        await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(finalRoundData);
        
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗(戰後):", err));

        res.json({
            story: finalRoundData.story,
            roundData: finalRoundData,
            suggestion: suggestion,
            locationData: await getMergedLocationData(userId, finalRoundData.LOC)
        });

    } catch (error) {
        console.error(`[UserID: ${userId}] /finalize-combat 錯誤:`, error);
        if (!res.headersSent) {
            res.status(500).json({ message: error.message || "結算戰鬥時發生未知錯誤" });
        }
    }
};

router.post('/finalize-combat', finalizeCombatHandler);

module.exports = router;
