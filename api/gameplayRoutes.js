// /api/gameplayRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIStory, getAISummary, getAISuggestion, getAIActionClassification, getAICombatAction, getAISurrenderResult } = require('../services/aiService');
const {
    TIME_SEQUENCE,
    advanceDate,
    updateInventory,
    updateRomanceValues,
    checkAndTriggerRomanceEvent,
    getInventoryState,
    createNpcProfileInBackground,
    invalidateNovelCache,
    updateLibraryNovel,
    updateSkills,
    getPlayerSkills,
    getFriendlinessLevel
} = require('./gameHelpers');
const { triggerBountyGeneration, generateAndCacheLocation } = require('./worldEngine');
const { processLocationUpdates } = require('./locationManager');

const db = admin.firestore();

const updateFriendlinessValues = async (userId, npcChanges) => {
    if (!npcChanges || npcChanges.length === 0) return;
    const userNpcsRef = db.collection('users').doc(userId).collection('npcs');

    const promises = npcChanges.map(async (change) => {
        if (!change.name || typeof change.friendlinessChange !== 'number' || change.friendlinessChange === 0) {
            return;
        }

        const npcDocRef = userNpcsRef.doc(change.name);
        try {
            await db.runTransaction(async (transaction) => {
                const npcDoc = await transaction.get(npcDocRef);
                if (!npcDoc.exists) {
                    console.warn(`[友好度系統] 嘗試更新一個不存在的NPC檔案: ${change.name}`);
                    return;
                }
                const currentFriendliness = npcDoc.data().friendlinessValue || 0;
                const newFriendlinessValue = currentFriendliness + change.friendlinessChange;
                
                transaction.update(npcDocRef, { 
                    friendlinessValue: newFriendlinessValue,
                    friendliness: getFriendlinessLevel(newFriendlinessValue)
                });
            });
        } catch (error) {
            console.error(`[友好度系統] 更新NPC "${change.name}" 友好度時出錯:`, error);
        }
    });

    await Promise.all(promises);
};


const interactRouteHandler = async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;

    try {
        const { action: playerAction, round: currentRound, model: modelName = 'gemini' } = req.body;
        const userDocRef = db.collection('users').doc(userId);
        const summaryDocRef = userDocRef.collection('game_state').doc('summary');

        const [userDoc, summaryDoc, savesSnapshot, skills] = await Promise.all([
            userDocRef.get(),
            summaryDocRef.get(),
            userDocRef.collection('game_saves').orderBy('R', 'desc').limit(3).get(),
            getPlayerSkills(userId)
        ]);
        
        const userProfile = userDoc.exists ? userDoc.data() : {};
        if (userProfile.isDeceased) {
            return res.status(403).json({ message: '逝者已矣，無法再有任何動作。' });
        }
        
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";
        const lastSave = savesSnapshot.docs[0]?.data() || {};
        
        const romanceEventToWeave = await checkAndTriggerRomanceEvent(userId);

        const currentLocationName = lastSave.LOC?.[0];
        let locationContext = null;
        if (currentLocationName) {
            const locationDoc = await db.collection('locations').doc(currentLocationName).get();
            if (locationDoc.exists) {
                locationContext = locationDoc.data();
            }
        }

        const contextForClassifier = {
            location: lastSave.LOC?.[0] || '未知之地',
            npcs: lastSave.NPC?.map(n => n.name) || [],
            skills: skills?.map(s => s.name) || []
        };
        const classification = await getAIActionClassification(modelName, playerAction, contextForClassifier);
        
        let aiResponse;

        switch (classification.actionType) {
            case 'COMBAT_ATTACK':
                // 【核心修改】將固定的攻擊描述，改為更中立、更具張力的文字
                const combatIntroText = `空氣中的氣氛陡然緊張，一場交鋒在所難免。你屏氣凝神，準備應對接下來的一切！`;
                aiResponse = {
                    story: `你決定向 ${classification.details.target || '對手'} 發起挑戰。`,
                    roundData: {
                        ...lastSave,
                        EVT: `遭遇戰：對決${classification.details.target}`,
                        PC: `你決定與${classification.details.target}一決高下。`,
                        IMP: `觸發了與${classification.details.target}的戰鬥`,
                        powerChange: { internal: 0, external: 0, lightness: 0 },
                        moralityChange: 0,
                        itemChanges: [],
                        romanceChanges: [],
                        skillChanges: [],
                        enterCombat: true,
                        combatants: [{ name: classification.details.target, status: '準備應戰' }],
                        combatIntro: combatIntroText, // 使用新的開場白
                    }
                };
                break;
            
            case 'GENERAL_STORY':
            default:
                const recentHistoryRounds = savesSnapshot.docs.map(doc => doc.data()).sort((a, b) => a.R - b.R);
                const playerPower = { internal: userProfile.internalPower || 5, external: userProfile.externalPower || 5, lightness: userProfile.lightness || 5 };
                const playerMorality = userProfile.morality === undefined ? 0 : userProfile.morality;
                let currentDate = { yearName: userProfile.yearName || '元祐', year: userProfile.year || 1, month: userProfile.month || 1, day: userProfile.day || 1 };
                const currentTimeOfDay = userProfile.timeOfDay || '上午';
                
                const preActionSkillChanges = req.body.skillChanges || [];
                const levelUpEvents = await updateSkills(userId, preActionSkillChanges);

                aiResponse = await getAIStory(modelName, longTermSummary, JSON.stringify(recentHistoryRounds), playerAction, { ...userProfile, ...currentDate }, username, currentTimeOfDay, playerPower, playerMorality, levelUpEvents, romanceEventToWeave, locationContext);
                if (!aiResponse || !aiResponse.roundData) throw new Error("主AI未能生成有效回應。");
                break;
        }

        const newRoundNumber = (currentRound || 0) + 1;
        aiResponse.roundData.R = newRoundNumber;
        aiResponse.story = aiResponse.story || "江湖靜悄悄，似乎什麼也沒發生。";
        
        aiResponse.roundData.story = aiResponse.story;
        
        await Promise.all([
            updateInventory(userId, aiResponse.roundData.itemChanges, aiResponse.roundData),
            updateRomanceValues(userId, aiResponse.roundData.romanceChanges),
            updateFriendlinessValues(userId, aiResponse.roundData.NPC),
            updateSkills(userId, aiResponse.roundData.skillChanges)
        ]);

        const [newSummary, suggestion, inventoryState, updatedSkills] = await Promise.all([
            getAISummary(modelName, longTermSummary, aiResponse.roundData),
            getAISuggestion('deepseek', aiResponse.roundData),
            getInventoryState(userId),
            getPlayerSkills(userId),
        ]);
        
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
            const combatState = { 
                turn: 1, 
                player: { 
                    username: username,
                    skills: skills 
                }, 
                enemies: aiResponse.roundData.combatants, 
                log: [aiResponse.roundData.combatIntro || '戰鬥開始了！'] 
            };
            await userDocRef.collection('game_state').doc('current_combat').set(combatState);
            aiResponse.combatInfo = { status: 'COMBAT_START', initialState: combatState };
        }
        
        const { mentionedLocations, locationUpdates } = aiResponse.roundData;

        if (mentionedLocations && Array.isArray(mentionedLocations)) {
            for (const locName of mentionedLocations) {
                generateAndCacheLocation(locName, '未知', newSummary)
                    .catch(err => console.error(`[世界引擎] 地點 ${locName} 的背景生成失敗:`, err));
            }
        }
        
        const currentLocationForUpdate = aiResponse.roundData.LOC?.[0];
        if (locationUpdates && Array.isArray(locationUpdates) && currentLocationForUpdate) {
            processLocationUpdates(currentLocationForUpdate, locationUpdates)
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
             aiResponse.roundData.PC = aiResponse.roundData.causeOfDeath || '你在這次事件中不幸殞命。';
             await userDocRef.update({ isDeceased: true });
        }

        await Promise.all([
             userDocRef.update({
                timeOfDay: aiResponse.roundData.timeOfDay,
                internalPower: newInternalPower, externalPower: newExternalPower, lightness: newLightness,
                morality: newMorality, preferredModel: modelName, ...currentDate
            }),
            summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber }),
            userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData)
        ]);

        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗:", err));

        if (newRoundNumber > 5 && Math.random() < 0.2) { 
            triggerBountyGeneration(userId, newSummary).catch(err => console.error("背景生成懸賞失敗:", err));
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
    const { action, model } = req.body;
    const modelName = model || 'deepseek';

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

        const combatResult = await getAICombatAction(modelName, playerProfile, combatState, action);
        if (!combatResult) throw new Error("戰鬥裁判AI未能生成有效回應。");

        combatState.log.push(combatResult.narrative);
        combatState.turn++;

        if (combatResult.combatOver) {
            await combatDocRef.delete();
            
            const lastSaveSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
            const lastRoundData = lastSaveSnapshot.docs[0].data();

            const postCombatSummary = combatResult.outcome.summary || '戰鬥結束';
            const playerChanges = combatResult.outcome.playerChanges || {};
            
            const powerChange = playerChanges.powerChange || {};
            const finalPowerUpdate = {
                internalPower: admin.firestore.FieldValue.increment(powerChange.internal || 0),
                externalPower: admin.firestore.FieldValue.increment(powerChange.external || 0),
                lightness: admin.firestore.FieldValue.increment(powerChange.lightness || 0),
                morality: admin.firestore.FieldValue.increment(playerChanges.moralityChange || 0)
            };
            await userDocRef.update(finalPowerUpdate);
            
            if (combatResult.outcome.itemChanges) {
                await updateInventory(userId, combatResult.outcome.itemChanges, lastRoundData);
            }

            const updatedUserDoc = await userDocRef.get();
            const updatedUserProfile = updatedUserDoc.data();
            const inventoryState = await getInventoryState(userId);

            const newRoundData = {
                 ...lastRoundData,
                 R: lastRoundData.R + 1,
                 story: combatResult.narrative,
                 PC: playerChanges.PC || postCombatSummary,
                 EVT: postCombatSummary,
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
                status: 'COMBAT_END',
                newRound: {
                    story: newRoundData.story,
                    roundData: newRoundData,
                    suggestion: "戰鬥結束了，你接下來打算怎麼辦？"
                }
            });

        } else {
            await combatDocRef.set(combatState);
            res.json({
                status: 'COMBAT_ONGOING',
                narrative: combatResult.narrative
            });
        }
    } catch (error) {
        console.error(`[UserID: ${userId}] /combat-action 錯誤:`, error);
        res.status(500).json({ message: error.message || "戰鬥中發生未知錯誤" });
    }
};

const surrenderRouteHandler = async (req, res) => {
    const userId = req.user.id;
    const { model } = req.body;
    const modelName = model || 'deepseek';

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

        const surrenderResult = await getAISurrenderResult(modelName, playerProfile, combatState);
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
    const { npcName, fullChatHistory, model } = req.body;

    if (!fullChatHistory || fullChatHistory.length === 0) {
        return res.json({ message: '對話已結束，江湖故事繼續。' });
    }

    try {
        const chatSummary = await getAIChatSummary(model, username, npcName, fullChatHistory);
        if (!chatSummary) throw new Error('AI未能成功總結對話內容。');

        const savesSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const currentRound = savesSnapshot.empty ? 0 : savesSnapshot.docs[0].data().R;
        
        req.body.action = chatSummary;
        req.body.round = currentRound;
        
        interactRouteHandler(req, res);

    } catch (error) {
        console.error(`[密談系統] 結束與NPC(${npcName})的對話時出錯:`, error);
        res.status(500).json({ message: '結束對話並更新世界時發生錯誤。' });
    }
});

module.exports = router;
