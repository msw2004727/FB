// /api/interactionRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIStory, getAISummary, getAISuggestion, getAIProactiveChat, getAICombatSetup, getAIChatSummary } = require('../services/aiService');
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
    getMergedLocationData
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

    const npcsSnapshot = await db.collection('users').doc(userId).collection('npcs')
        .where('currentLocation', '==', playerLocation)
        .get();

    if (npcsSnapshot.empty) return null;
    
    for (const npcDoc of npcsSnapshot.docs) {
        const npcProfile = npcDoc.data();
        const npcId = npcDoc.id;
        
        if (!npcProfile.triggeredProactiveEvents) {
            npcProfile.triggeredProactiveEvents = [];
        }

        let triggerEvent = null;

        const trustEventId = `trust_${npcId}`;
        if (npcProfile.friendlinessValue >= 70 && !npcProfile.triggeredProactiveEvents.includes(trustEventId)) {
            triggerEvent = { type: 'TRUST_BREAKTHROUGH', details: '友好度達到信賴' };
            npcProfile.triggeredProactiveEvents.push(trustEventId);
        }
        const romanceEventId = `romance_${npcId}`;
        if (!triggerEvent && npcProfile.romanceValue >= 50 && !npcProfile.triggeredProactiveEvents.includes(romanceEventId)) {
            triggerEvent = { type: 'ROMANCE_BREAKTHROUGH', details: '心動值達到曖昧' };
            npcProfile.triggeredProactiveEvents.push(romanceEventId);
        }

        if (triggerEvent) {
            console.log(`[主動互動引擎] 偵測到觸發事件: ${npcProfile.name} 的 ${triggerEvent.type}`);
            
            const proactiveChatResult = await getAIProactiveChat(playerProfile, npcProfile, triggerEvent);

            await npcDoc.ref.update({ triggeredProactiveEvents: npcProfile.triggeredProactiveEvents });
            
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
        
        const romanceEventData = await checkAndTriggerRomanceEvent(userId, { ...userProfile, username });
        const romanceEventToWeave = romanceEventData ? romanceEventData.eventStory : null;
        const recentHistoryRounds = savesSnapshot.docs.map(doc => doc.data()).sort((a, b) => a.R - b.R);
        const playerPower = { internal: userProfile.internalPower || 5, external: userProfile.externalPower || 5, lightness: userProfile.lightness || 5 };
        const playerMorality = userProfile.morality === undefined ? 0 : userProfile.morality;
        
        const currentDate = {
            yearName: userProfile.yearName || lastSave.yearName || '元祐',
            year: userProfile.year || lastSave.year || 1,
            month: userProfile.month || lastSave.month || 1,
            day: userProfile.day || lastSave.day || 1,
        };

        const currentTimeOfDay = userProfile.timeOfDay || '上午';
        const levelUpEvents = await updateSkills(userId, req.body.skillChanges || []);
        const locationContext = await getMergedLocationData(userId, lastSave.LOC);
        const npcContext = {};
        if (lastSave.NPC && lastSave.NPC.length > 0) {
            const npcPromises = lastSave.NPC.map(npcInScene => 
                db.collection('users').doc(userId).collection('npcs').doc(npcInScene.name).get()
            );
            const npcDocs = await Promise.all(npcPromises);
            npcDocs.forEach(doc => {
                if (doc.exists) {
                    npcContext[doc.id] = doc.data();
                }
            });
        }
        
        const aiResponse = await getAIStory(playerModelChoice, longTermSummary, JSON.stringify(recentHistoryRounds), playerAction, { ...userProfile, ...currentDate }, username, currentTimeOfDay, playerPower, playerMorality, levelUpEvents, romanceEventToWeave, locationContext, npcContext, totalBulkScore);
        if (!aiResponse || !aiResponse.roundData) throw new Error("主AI未能生成有效回應。");

        
        const newRoundNumber = (currentRound || 0) + 1;
        aiResponse.roundData.R = newRoundNumber;
        aiResponse.story = aiResponse.story || "江湖靜悄悄，似乎什麼也沒發生。";
        
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
        
        await Promise.all([
            updateInventory(userId, aiResponse.roundData.itemChanges, aiResponse.roundData),
            updateRomanceValues(userId, aiResponse.roundData.romanceChanges),
            updateFriendlinessValues(userId, aiResponse.roundData.NPC),
            updateSkills(userId, aiResponse.roundData.skillChanges),
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
            const npcUpdatePromises = aiResponse.roundData.NPC.map(npc => {
                const npcDocRef = userDocRef.collection('npcs').doc(npc.name);
                if (npc.isDeceased) return npcDocRef.set({ isDeceased: true }, { merge: true });
                if (npc.isNew) {
                    delete npc.isNew;
                    return createNpcProfileInBackground(userId, username, npc, aiResponse.roundData, userProfile);
                } else {
                    const newSceneLocation = aiResponse.roundData.LOC[0];
                    if (newSceneLocation) {
                        return npcDocRef.set({ currentLocation: newSceneLocation }, { merge: true });
                    }
                }
                return Promise.resolve();
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
        if (daysToAdvance > 0) {
            for (let i = 0; i < daysToAdvance; i++) { finalDate = advanceDate(finalDate); }
        } else if (nextTimeOfDay) {
            const oldTimeIndex = TIME_SEQUENCE.indexOf(userProfile.timeOfDay);
            const newTimeIndex = TIME_SEQUENCE.indexOf(nextTimeOfDay);
            if (newTimeIndex < oldTimeIndex) { finalDate = advanceDate(finalDate); }
        }

        const newInternalPower = Math.max(0, Math.min(999, (userProfile.internalPower || 0) + (powerChange.internal || 0)));
        const newExternalPower = Math.max(0, Math.min(999, (userProfile.externalPower || 0) + (powerChange.external || 0)));
        const newLightness = Math.max(0, Math.min(999, (userProfile.lightness || 0) + (powerChange.lightness || 0)));
        let newMorality = Math.max(-100, Math.min(100, (userProfile.morality || 0) + moralityChange));

        Object.assign(aiResponse.roundData, { internalPower: newInternalPower, externalPower: newExternalPower, lightness: newLightness, morality: newMorality, timeOfDay: nextTimeOfDay || userProfile.timeOfDay, ...finalDate });
        
        if (aiResponse.roundData.playerState === 'dead') {
             await userDocRef.update({ isDeceased: true });
             aiResponse.roundData.PC = aiResponse.roundData.causeOfDeath || '你在這次事件中不幸殞命。';
        }

        if (userProfile.deathCountdown) {
            aiResponse.roundData.deathCountdown = userProfile.deathCountdown;
        }

        const playerUpdatesForDb = {
            timeOfDay: aiResponse.roundData.timeOfDay,
            internalPower: newInternalPower,
            externalPower: newExternalPower,
            lightness: newLightness,
            morality: newMorality,
            ...finalDate
        };

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
