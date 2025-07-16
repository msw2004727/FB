// /api/combatRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAICombatAction, getAISurrenderResult, getAIPostCombatResult, getAISummary, getAISuggestion } = require('../services/aiService');
const { getMergedNpcProfile, getFriendlinessLevel, processNpcUpdates } = require('./npcHelpers');
const { getPlayerSkills, getRawInventory, updateInventory, getInventoryState, getOrGenerateSkillTemplate } = require('./playerStateHelpers');
const { updateLibraryNovel, invalidateNovelCache, getMergedLocationData } = require('./worldStateHelpers');
const { processReputationChangesAfterDeath } = require('./reputationManager');
// 【核心修正】將路徑從 '../gameplay/combatManager' 改為 './gameplay/combatManager'
const { initiateCombat } = require('./gameplay/combatManager'); 

const db = admin.firestore();

const initiateCombatHandler = async (req, res) => {
    const { id: userId, username } = req.user;
    const { targetNpcName, intention } = req.body;

    try {
        const initialState = await initiateCombat(userId, username, targetNpcName, intention);
        res.json({ status: 'COMBAT_START', initialState: initialState });
    } catch (error) {
        console.error(`[UserID: ${userId}] /initiate-combat 錯誤:`, error);
        res.status(500).json({ message: error.message || "發起戰鬥時發生未知錯誤" });
    }
};

const combatActionRouteHandler = async (req, res) => {
    const userId = req.user.id;
    const { strategy, skill: selectedSkillName, model: playerModelChoice } = req.body;

    try {
        const userDocRef = db.collection('users').doc(userId);
        const combatDocRef = userDocRef.collection('game_state').doc('current_combat');

        const combatDoc = await combatDocRef.get();
        if (!combatDoc.exists) {
            return res.status(404).json({ message: "戰鬥不存在或已結束。" });
        }

        let combatState = combatDoc.data();
        
        if (selectedSkillName) {
            const playerSkills = combatState.player?.skills || [];
            const skillExists = playerSkills.some(s => s.skillName === selectedSkillName);

            if (!skillExists) {
                console.warn(`[後端驗證失敗] 玩家 ${req.user.username} 試圖使用一個他不會的武學！武學: ${selectedSkillName}`);
                return res.status(403).json({ message: `你氣沉丹田，試圖運轉「${selectedSkillName}」的內力，卻發現腦中一片空白，原來你根本不會這門功夫。` });
            }

            const skillTemplateResult = await getOrGenerateSkillTemplate(selectedSkillName);
            if (!skillTemplateResult || !skillTemplateResult.template) {
                return res.status(404).json({ message: `找不到武學「${selectedSkillName}」的資料。`});
            }
            const requiredWeaponType = skillTemplateResult.template.requiredWeaponType;
            const currentWeaponType = combatState.player.currentWeaponType;
            
            const isWeaponMatch = 
                (requiredWeaponType && requiredWeaponType !== '無' && requiredWeaponType === currentWeaponType) ||
                (requiredWeaponType === '無' && currentWeaponType === null);

            if (!isWeaponMatch) {
                const weaponName = currentWeaponType ? `${currentWeaponType}類武器` : '空手';
                console.warn(`[後端驗證失敗] 玩家 ${req.user.username} 試圖使用與武器不符的武學！武學: ${selectedSkillName}, 需求: ${requiredWeaponType}, 現有: ${weaponName}`);
                return res.status(403).json({ message: `你目前的「${weaponName}」狀態，無法施展「${selectedSkillName}」。` });
            }
        }
        
        const [userDoc, skills] = await Promise.all([
            userDocRef.get(),
            getPlayerSkills(userId)
        ]);
        
        let playerProfile = userDoc.exists ? userDoc.data() : {};
        playerProfile.skills = skills;
        playerProfile.hp = combatState.player.hp;
        playerProfile.maxHp = combatState.player.maxHp;
        playerProfile.mp = combatState.player.mp;
        playerProfile.maxMp = combatState.player.maxMp;

        const combatResult = await getAICombatAction(playerModelChoice, playerProfile, combatState, { strategy, skill: selectedSkillName });

        if (!combatResult) throw new Error("戰鬥裁判AI未能生成有效回應。");

        let finalUpdatedState = { ...combatState };
        finalUpdatedState.turn = (finalUpdatedState.turn || 1) + 1;
        finalUpdatedState.log.push(combatResult.narrative);

        if (combatResult.updatedState) {
            if (combatResult.updatedState.player) {
                const originalSkills = finalUpdatedState.player.skills;
                finalUpdatedState.player = { ...finalUpdatedState.player, ...combatResult.updatedState.player };
                finalUpdatedState.player.skills = originalSkills;
                if (finalUpdatedState.player.hp < 0) finalUpdatedState.player.hp = 0;
                if (finalUpdatedState.player.mp < 0) finalUpdatedState.player.mp = 0;
            }
            if (combatResult.updatedState.enemies) {
                finalUpdatedState.enemies = finalUpdatedState.enemies.map(enemy => {
                    const updatedEnemy = combatResult.updatedState.enemies.find(u => u.name === enemy.name);
                    if (updatedEnemy) {
                        const newEnemy = { ...enemy, ...updatedEnemy };
                        if (newEnemy.hp < 0) newEnemy.hp = 0;
                        if (newEnemy.mp < 0) newEnemy.mp = 0;
                        return newEnemy;
                    }
                    return enemy;
                });
            }
            if (combatResult.updatedState.allies) {
                finalUpdatedState.allies = finalUpdatedState.allies.map(ally => {
                    const updatedAlly = combatResult.updatedState.allies.find(u => u.name === ally.name);
                     if (updatedAlly) {
                        const newAlly = { ...ally, ...updatedAlly };
                        if (newAlly.hp < 0) newAlly.hp = 0;
                        if (newAlly.mp < 0) newAlly.mp = 0;
                        return newAlly;
                    }
                    return ally;
                });
            }
        }
        
        if (combatResult.status === 'COMBAT_END') {
            await combatDocRef.delete();
            
            res.json({
                status: 'COMBAT_END',
                narrative: combatResult.narrative, 
                updatedState: finalUpdatedState,
                combatResult: {
                    finalState: finalUpdatedState,
                    log: combatState.log
                }
            });

        } else { 
            await combatDocRef.set(finalUpdatedState);
            res.json({
                status: 'COMBAT_ONGOING',
                narrative: combatResult.narrative,
                updatedState: finalUpdatedState,
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
        
        await db.runTransaction(async (transaction) => {
            const currentUserDoc = await transaction.get(userDocRef);
            if (!currentUserDoc.exists) throw "Document does not exist!";
            
            const currentData = currentUserDoc.data();
            const powerChange = playerChanges.powerChange || {};

            const newInternal = Math.max(0, (currentData.internalPower || 0) + (powerChange.internal || 0));
            const newExternal = Math.max(0, (currentData.externalPower || 0) + (powerChange.external || 0));
            const newLightness = Math.max(0, (currentData.lightness || 0) + (powerChange.lightness || 0));
            const newMorality = (currentData.morality || 0) + (playerChanges.moralityChange || 0);

            const finalPowerUpdate = {
                internalPower: newInternal,
                externalPower: newExternal,
                lightness: newLightness,
                morality: newMorality
            };
            transaction.update(userDocRef, finalPowerUpdate);
        });

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
        updateLibraryNovel(userId, playerProfile.username).catch(err => console.error("背景更新圖書館失敗(認輸):", err));

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
        const playerWon = finalState.enemies.every(e => e.hp <= 0);
        let killerName = null;
        if (playerWon && finalState.intention === '打死') {
            killerName = username;
        }

        const postCombatOutcome = await getAIPostCombatResult(playerModelChoice, { ...userProfile, username }, finalState, combatResult.log, killerName);
        
        if (!postCombatOutcome || !postCombatOutcome.outcome) {
             throw new Error("戰後結算AI未能生成有效回應。");
        }
        
        let { summary, EVT, playerChanges, itemChanges, npcUpdates } = postCombatOutcome.outcome;
        
        await updateInventory(userId, itemChanges || [], preCombatRoundData);
        
        if (playerChanges && (playerChanges.powerChange || playerChanges.moralityChange)) {
            await db.runTransaction(async (transaction) => {
                const currentUserDoc = await transaction.get(userDocRef);
                if (!currentUserDoc.exists) throw "Document does not exist!";
                
                const currentData = currentUserDoc.data();
                const powerChange = playerChanges.powerChange || {};
                
                const updates = {};
                updates.internalPower = Math.max(0, (currentData.internalPower || 0) + (powerChange.internal || 0));
                updates.externalPower = Math.max(0, (currentData.externalPower || 0) + (powerChange.external || 0));
                updates.lightness = Math.max(0, (currentData.lightness || 0) + (powerChange.lightness || 0));
                
                if (playerChanges.moralityChange) {
                    updates.morality = (currentData.morality || 0) + playerChanges.moralityChange;
                }
                
                if (killedNpcNames.length > 0) {
                    updates.deathAftermathCooldown = 5;
                }

                transaction.update(userDocRef, updates);
            });
        }
        
        const killedNpcNames = (npcUpdates || []).filter(u => u.fieldToUpdate === 'isDeceased' && u.newValue === true).map(u => u.npcName);

        if (killedNpcNames.length > 0) {
            const reputationSummary = await processReputationChangesAfterDeath(
                userId, 
                killedNpcNames, 
                preCombatRoundData.LOC[0], 
                combatResult.finalState.allies.map(a => a.name), 
                killerName
            );
            if (reputationSummary) {
                summary += `\n\n**【江湖反應】** ${reputationSummary}`;
            }
        }
        
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

router.post('/initiate', initiateCombatHandler);
router.post('/action', combatActionRouteHandler);
router.post('/surrender', surrenderRouteHandler);
router.post('/finalize-combat', finalizeCombatHandler);

module.exports = router;
