// /api/gameplayRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
// 【核心修改】引入新的 getAICombatSetup 函式
const { getAIStory, getAISummary, getAISuggestion, getAIActionClassification, getAICombatAction, getAISurrenderResult, getAIProactiveChat, getAICombatSetup } = require('../services/aiService');
const {
    TIME_SEQUENCE,
    advanceDate,
    updateInventory,
    updateRomanceValues,
    updateFriendlinessValues,
    checkAndTriggerRomanceEvent,
    getInventoryState,
    createNpcProfileInBackground,
    invalidateNovelCache,
    updateLibraryNovel,
    updateSkills,
    getPlayerSkills,
    getFriendlinessLevel,
    processNpcUpdates,
    getMergedLocationData
} = require('./gameHelpers');
const { triggerBountyGeneration, generateAndCacheLocation } = require('./worldEngine');
const { processLocationUpdates } = require('./locationManager');

const db = admin.firestore();

// NPC主動互動引擎
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


const interactRouteHandler = async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;

    try {
        const { action: playerAction, round: currentRound, model: playerModelChoice } = req.body;
        const userDocRef = db.collection('users').doc(userId);
        const summaryDocRef = userDocRef.collection('game_state').doc('summary');

        const [userDoc, summaryDoc, savesSnapshot, skills] = await Promise.all([
            userDocRef.get(),
            summaryDocRef.get(),
            userDocRef.collection('game_saves').orderBy('R', 'desc').limit(3).get(),
            getPlayerSkills(userId)
        ]);
        
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

        const currentLocationName = lastSave.LOC?.[0];
        const locationContext = await getMergedLocationData(userId, currentLocationName);

        const contextForClassifier = {
            location: lastSave.LOC?.[0] || '未知之地',
            npcs: lastSave.NPC?.map(n => n.name) || [],
            skills: skills?.map(s => s.name) || []
        };
        const classification = await getAIActionClassification(playerModelChoice, playerAction, contextForClassifier);
        
        let aiResponse;

        switch (classification.actionType) {
            case 'COMBAT_ATTACK':
            case 'COMBAT_SPARRING': { 
                const combatSetupResult = await getAICombatSetup(playerAction, lastSave);
                const isSparring = classification.actionType === 'COMBAT_SPARRING';

                aiResponse = {
                    story: isSparring
                        ? `你向 ${classification.details.target || '對手'} 發起了一場友好的切磋。`
                        : `你決定向 ${classification.details.target || '對手'} 發起挑戰。`,
                    roundData: {
                        ...lastSave,
                        EVT: isSparring ? `友好切磋：對決${classification.details.target}` : `遭遇戰：對決${classification.details.target}`,
                        PC: isSparring ? `你提議與${classification.details.target}比試一番。` : `你決定與${classification.details.target}一決高下。`,
                        IMP: `觸發了與${classification.details.target}的戰鬥`,
                        powerChange: { internal: 0, external: 0, lightness: 0 },
                        moralityChange: 0,
                        itemChanges: [],
                        romanceChanges: [],
                        skillChanges: [],
                        enterCombat: true,
                        combatants: combatSetupResult.combatants,
                        allies: combatSetupResult.allies,
                        bystanders: combatSetupResult.bystanders,
                        combatIntro: combatSetupResult.combatIntro,
                        isSparring: isSparring 
                    }
                };
                break;
            }
            
            case 'GENERAL_STORY':
            default:
                const recentHistoryRounds = savesSnapshot.docs.map(doc => doc.data()).sort((a, b) => a.R - b.R);
                const playerPower = { internal: userProfile.internalPower || 5, external: userProfile.externalPower || 5, lightness: userProfile.lightness || 5 };
                const playerMorality = userProfile.morality === undefined ? 0 : userProfile.morality;
                let currentDate = { yearName: userProfile.yearName || '元祐', year: userProfile.year || 1, month: userProfile.month || 1, day: userProfile.day || 1 };
                const currentTimeOfDay = userProfile.timeOfDay || '上午';
                
                const preActionSkillChanges = req.body.skillChanges || [];
                const levelUpEvents = await updateSkills(userId, preActionSkillChanges);

                aiResponse = await getAIStory(playerModelChoice, longTermSummary, JSON.stringify(recentHistoryRounds), playerAction, { ...userProfile, ...currentDate }, username, currentTimeOfDay, playerPower, playerMorality, levelUpEvents, romanceEventToWeave, locationContext);
                if (!aiResponse || !aiResponse.roundData) throw new Error("主AI未能生成有效回應。");
                break;
        }

        const newRoundNumber = (currentRound || 0) + 1;
        aiResponse.roundData.R = newRoundNumber;
        aiResponse.story = aiResponse.story || "江湖靜悄悄，似乎什麼也沒發生。";
        
        // 【核心修改】在處理其他數據前，優先處理瀕死狀態的解除
        if (aiResponse.roundData.removeDeathCountdown) {
            await userDocRef.update({ deathCountdown: admin.firestore.FieldValue.delete() });
            delete userProfile.deathCountdown; // 同步記憶體狀態，確保本回合後續邏輯正確
            // 清除回合數據中的標記，避免不必要的儲存
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
        
        userProfile = (await userDocRef.get()).data();
        
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
                    return createNpcProfileInBackground(userId, username, npc, aiResponse.roundData);
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
        let currentDate = { yearName: userProfile.yearName, year: userProfile.year, month: userProfile.month, day: userProfile.day };
        if (daysToAdvance > 0) {
            for (let i = 0; i < daysToAdvance; i++) { currentDate = advanceDate(currentDate); }
        } else if (nextTimeOfDay) {
            const oldTimeIndex = TIME_SEQUENCE.indexOf(userProfile.timeOfDay);
            const newTimeIndex = TIME_SEQUENCE.indexOf(nextTimeOfDay);
            if (newTimeIndex < oldTimeIndex) { currentDate = advanceDate(currentDate); }
        }

        const newInternalPower = Math.max(0, Math.min(999, (userProfile.internalPower || 0) + (powerChange.internal || 0)));
        const newExternalPower = Math.max(0, Math.min(999, (userProfile.externalPower || 0) + (powerChange.external || 0)));
        const newLightness = Math.max(0, Math.min(999, (userProfile.lightness || 0) + (powerChange.lightness || 0)));
        let newMorality = Math.max(-100, Math.min(100, (userProfile.morality || 0) + moralityChange));

        Object.assign(aiResponse.roundData, { internalPower: newInternalPower, externalPower: newExternalPower, lightness: newLightness, morality: newMorality, timeOfDay: nextTimeOfDay || userProfile.timeOfDay, ...currentDate });
        
        if (aiResponse.roundData.playerState === 'dead') {
             await userDocRef.update({ isDeceased: true });
             aiResponse.roundData.PC = aiResponse.roundData.causeOfDeath || '你在這次事件中不幸殞命。';
        }

        if (userProfile.deathCountdown) {
            aiResponse.roundData.deathCountdown = userProfile.deathCountdown;
        }

        await Promise.all([
             userDocRef.update({
                timeOfDay: aiResponse.roundData.timeOfDay,
                internalPower: newInternalPower, externalPower: newExternalPower, lightness: newLightness,
                morality: newMorality, preferredModel: playerModelChoice
            }),
            summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber }),
            userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData)
        ]);

        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗:", err));

        if (newRoundNumber > 5 && Math.random() < 0.2) { 
            triggerBountyGeneration(userId, newSummary).catch(err => console.error("背景生成懸賞失敗:", err));
        }

        aiResponse.locationData = await getMergedLocationData(userId, aiResponse.roundData.LOC?.[0]);

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

const combatActionRouteHandler = async (req, res) => {
    const userId = req.user.id;
    const { action, model: playerModelChoice } = req.body;

    try {
        const userDocRef = db.collection('users').doc(userId);
        const combatDocRef = userDocRef.collection('game_state').doc('current_combat');

        const combatDoc = await combatDocRef.get();
        if (!combatDoc.exists) {
            return res.status(404).json({ message: "戰鬥不存在或已結束。" });
        }

        let combatState = combatDoc.data();
        combatState.log.push(`> ${action}`);

        const [userDoc, skills] = await Promise.all([
            userDocRef.get(),
            getPlayerSkills(userId)
        ]);
        let playerProfile = userDoc.exists ? userDoc.data() : {};
        playerProfile.skills = skills;
        playerProfile.hp = combatState.player.hp;
        playerProfile.maxHp = combatState.player.maxHp;

        const combatResult = await getAICombatAction(playerModelChoice, playerProfile, combatState, action);
        if (!combatResult) throw new Error("戰鬥裁判AI未能生成有效回應。");

        combatState.log.push(combatResult.narrative);
        combatState.turn++;
        
        if (combatResult.damageDealt && combatResult.damageDealt.length > 0) {
            combatResult.damageDealt.forEach(deal => {
                if (deal.target === "玩家" || deal.target === playerProfile.username) {
                    combatState.player.hp -= deal.damage;
                }
            });
        }
        if (combatResult.enemies) combatState.enemies = combatResult.enemies;
        if (combatResult.allies) combatState.allies = combatResult.allies;

        
        if (combatState.player.hp <= 0) {
            combatResult.combatOver = true;
            combatResult.narrative += `\n你眼前一黑，失去了所有知覺...`;
            combatResult.outcome = {
                summary: '你不敵對手，身受重傷，倒在血泊之中。',
                playerChanges: {
                    PC: `你被${combatState.enemies.map(e => e.name).join('、')}擊敗，身受致命傷。`,
                    powerChange: { internal: 0, external: 0, lightness: 0 },
                    moralityChange: 0,
                },
                relationshipChanges: []
            };
        }

        if (combatResult.combatOver) {
            await combatDocRef.delete();
            
            const lastSaveSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
            const lastRoundData = lastSaveSnapshot.docs[0].data();

            const postCombatSummary = combatResult.outcome.summary || '戰鬥結束';
            const playerChanges = combatResult.outcome.playerChanges || {};
            const relationshipChanges = combatResult.outcome.relationshipChanges || [];
            
            const powerChange = playerChanges.powerChange || {};
            const finalPowerUpdate = {
                internalPower: admin.firestore.FieldValue.increment(powerChange.internal || 0),
                externalPower: admin.firestore.FieldValue.increment(powerChange.external || 0),
                lightness: admin.firestore.FieldValue.increment(powerChange.lightness || 0),
                morality: admin.firestore.FieldValue.increment(playerChanges.moralityChange || 0)
            };
            
            const relationshipPromises = [];
            if (relationshipChanges.length > 0) {
                const friendlinessChanges = relationshipChanges.map(c => ({ name: c.npcName, friendlinessChange: c.friendlinessChange })).filter(c => c.friendlinessChange);
                const romanceChanges = relationshipChanges.map(c => ({ npcName: c.npcName, valueChange: c.romanceChange })).filter(c => c.valueChange);

                if (friendlinessChanges.length > 0) {
                    relationshipPromises.push(updateFriendlinessValues(userId, friendlinessChanges));
                }
                if (romanceChanges.length > 0) {
                    relationshipPromises.push(updateRomanceValues(userId, romanceChanges));
                }
            }

            const playerUpdatePayload = { ...finalPowerUpdate };
            if (combatState.player.hp <= 0) {
                playerUpdatePayload.deathCountdown = 10;
            }
            await Promise.all([
                userDocRef.update(playerUpdatePayload),
                ...relationshipPromises
            ]);
            
            
            const updatedUserDoc = await userDocRef.get();
            const updatedUserProfile = updatedUserDoc.data();
            const inventoryState = await getInventoryState(userId);

            const newRoundData = {
                 ...lastRoundData,
                 R: lastRoundData.R + 1,
                 story: combatResult.narrative,
                 PC: playerChanges.PC || postCombatSummary,
                 EVT: postCombatSummary,
                 playerState: combatState.player.hp <= 0 ? 'dying' : 'alive',
                 causeOfDeath: null, 
                 internalPower: updatedUserProfile.internalPower,
                 externalPower: updatedUserProfile.externalPower,
                 lightness: updatedUserProfile.lightness,
                 morality: updatedUserProfile.morality,
                 ITM: inventoryState.itemsString,
                 money: inventoryState.money,
                 deathCountdown: updatedUserProfile.deathCountdown || null,
            };
            
             await userDocRef.collection('game_saves').doc(`R${newRoundData.R}`).set(newRoundData);
             await invalidateNovelCache(userId);
             updateLibraryNovel(userId, playerProfile.username).catch(err => console.error("背景更新圖書館失敗:", err));

            res.json({
                status: 'COMBAT_END',
                newRound: {
                    story: newRoundData.story,
                    roundData: newRoundData,
                    suggestion: combatState.player.hp <= 0 ? "你還有10個回合的時間自救..." : "戰鬥結束了，你接下來打算怎麼辦？"
                }
            });

        } else {
            await combatDocRef.set(combatState);
            res.json({
                status: 'COMBAT_ONGOING',
                narrative: combatResult.narrative,
                updatedState: combatState 
            });
        }
    } catch (error) {
        console.error(`[UserID: ${userId}] /combat-action 錯誤:`, error);
        res.status(500).json({ message: error.message || "戰鬥中發生未知錯誤" });
    }
};

const surrenderRouteHandler = async (req, res) => {
    const userId = req.user.id;
    const { model: playerModelChoice } = req.body;

    try {
        const userDocRef = db.collection('users').doc(userId);
        const combatDocRef = userDocRef.collection('game_state').doc('current_combat');

        const [userDoc, combatDoc] = await Promise.all([userDocRef.get(), combatDocRef.get()]);

        if (!combatDoc.exists) {
            return res.status(404).json({ message: "戰鬥不存在或已結束，無法認輸。" });
        }
        if (!userDoc.exists) {
            return res.status(404).json({ message: "找不到玩家資料。" });
        }

        const playerProfile = userDoc.data();
        const combatState = combatDoc.data();

        const surrenderResult = await getAISurrenderResult(playerModelChoice, playerProfile, combatState);
        if (!surrenderResult) throw new Error("談判專家AI未能生成有效回應。");

        combatState.log.push(surrenderResult.narrative);
        await combatDocRef.set(combatState);

        if (!surrenderResult.accepted) {
            return res.json({
                status: 'SURRENDER_REJECTED',
                narrative: surrenderResult.narrative
            });
        }
        
        await combatDocRef.delete(); 
        const lastSaveSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const lastRoundData = lastSaveSnapshot.docs[0].data();
        const playerChanges = surrenderResult.outcome.playerChanges || {};
        
        const powerChange = playerChanges.powerChange || {};
        const finalPowerUpdate = {
            internalPower: admin.firestore.FieldValue.increment(powerChange.internal || 0),
            externalPower: admin.firestore.FieldValue.increment(powerChange.external || 0),
            lightness: admin.firestore.FieldValue.increment(powerChange.lightness || 0),
            morality: admin.firestore.FieldValue.increment(playerChanges.moralityChange || 0)
        };
        await userDocRef.update(finalPowerUpdate);
        
        if (playerChanges.itemChanges) {
            await updateInventory(userId, playerChanges.itemChanges, lastRoundData);
        }

        const updatedUserDoc = await userDocRef.get();
        const updatedUserProfile = updatedUserDoc.data();
        const inventoryState = await getInventoryState(userId);

        const newRoundData = {
             ...lastRoundData,
             R: lastRoundData.R + 1,
             story: surrenderResult.narrative,
             PC: playerChanges.PC || surrenderResult.outcome.summary,
             EVT: `向 ${combatState.enemies.map(e => e.name).join('、')} 認輸`,
             internalPower: updatedUserProfile.internalPower,
             externalPower: updatedUserProfile.externalPower,
             lightness: updatedUserProfile.lightness,
             morality: updatedUserProfile.morality,
             ITM: inventoryState.itemsString,
             money: inventoryState.money,
        };
        
        await userDocRef.collection('game_saves').doc(`R${newRoundData.R}`).set(newRoundData);
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, playerProfile.username).catch(err => console.error("背景更新圖書館失敗:", err));

        res.json({
            status: 'SURRENDER_ACCEPTED',
            narrative: surrenderResult.narrative,
            newRound: {
                story: newRoundData.story,
                roundData: newRoundData,
                suggestion: "留得青山在，不怕沒柴燒。接下來你打算怎麼辦？"
            }
        });

    } catch (error) {
        console.error(`[UserID: ${userId}] /combat-surrender 錯誤:`, error);
        res.status(500).json({ message: error.message || "認輸時發生未知錯誤" });
    }
};

router.post('/interact', interactRouteHandler);
router.post('/combat-action', combatActionRouteHandler);
router.post('/combat-surrender', surrenderRouteHandler);

router.post('/end-chat', async (req, res) => {
    const { getAIChatSummary } = require('../services/aiService');
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
