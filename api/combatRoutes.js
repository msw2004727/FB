// /api/combatRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAICombatSetup, getAICombatAction, getAISurrenderResult, getAIPostCombatResult, getAISummary, getAISuggestion } = require('../services/aiService');

const { getMergedNpcProfile, getFriendlinessLevel, processNpcUpdates } = require('./npcHelpers');
const { getPlayerSkills, updateInventory, getInventoryState } = require('./playerStateHelpers');
const { updateLibraryNovel, invalidateNovelCache, getMergedLocationData } = require('./worldStateHelpers');
const { processReputationChangesAfterDeath } = require('./reputationManager');

const db = admin.firestore();

const getNpcTags = (skills = []) => {
    if (!skills || skills.length === 0) return [{ name: '凡人', type: 'support' }];
    const tags = new Set();
    const tagMap = {
        '攻擊': { type: 'attack', keywords: ['劍', '刀', '拳', '掌', '指', '鏢'] },
        '防禦': { type: 'defend', keywords: ['罩', '盾', '罡', '體'] },
        '治癒': { type: 'heal', keywords: ['療傷', '回春', '治癒'] },
        '輔助': { type: 'support', keywords: ['陣', '歌', '舞'] }
    };
    skills.forEach(skill => {
        if (skill && skill.name) {
            if (skill.skillType === '醫術') tags.add('治癒');
            if (skill.skillType === '毒術') tags.add('攻擊');
            for (const [tagName, { type, keywords }] of Object.entries(tagMap)) {
                if (keywords.some(kw => skill.name.includes(kw))) {
                    tags.add(tagName);
                }
            }
        }
    });
    if (tags.size === 0) tags.add('攻擊');
    const typeMapping = { '攻擊': 'attack', '防禦': 'defend', '治癒': 'heal', '輔助': 'support' };
    return Array.from(tags).map(tagName => ({ name: tagName, type: typeMapping[tagName] || 'attack' }));
};

const initiateCombatHandler = async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const { targetNpcName, intention } = req.body;

    if (!targetNpcName) {
        return res.status(400).json({ message: "未指定對決目標。" });
    }

    try {
        const userDocRef = db.collection('users').doc(userId);
        const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        if (savesSnapshot.empty) {
            return res.status(404).json({ message: "找不到玩家存檔。" });
        }
        const lastSave = savesSnapshot.docs[0].data();
        
        const playerLocationHierarchy = lastSave.LOC;
        const targetNpcProfile = await getMergedNpcProfile(userId, targetNpcName);
        
        if (!targetNpcProfile) {
            return res.status(404).json({ message: `找不到名為 ${targetNpcName} 的目標。` });
        }
        
        const npcLocation = targetNpcProfile.currentLocation;

        if (!Array.isArray(playerLocationHierarchy) || !playerLocationHierarchy.includes(npcLocation)) {
            return res.status(403).json({ message: `你必須和 ${targetNpcName} 在同一個地方才能對其動手。` });
        }

        const simulatedPlayerAction = `我決定要「${intention}」${targetNpcName}。`;
        
        const combatSetupResult = await getAICombatSetup(simulatedPlayerAction, lastSave);

        const playerSkills = await getPlayerSkills(userId);
        const userProfile = (await userDocRef.get()).data();
        const maxHp = (userProfile.externalPower || 5) * 10 + 50;
        const maxMp = (userProfile.internalPower || 5) * 5 + 20;

        const allNpcNames = [
            ...combatSetupResult.combatants.map(c => c.name),
            ...combatSetupResult.allies.map(a => a.name)
        ];
        
        const npcDocs = await Promise.all(
            allNpcNames.map(name => db.collection('npcs').doc(name).get())
        );

        const npcProfiles = npcDocs.reduce((acc, doc) => {
            if (doc.exists) {
                acc[doc.id] = doc.data();
            }
            return acc;
        }, {});

        combatSetupResult.combatants.forEach(c => {
            const profile = npcProfiles[c.name];
            c.tags = profile ? getNpcTags(profile.skills) : [{ name: '攻擊', type: 'attack' }];
        });
        combatSetupResult.allies.forEach(a => {
            const profile = npcProfiles[a.name];
            a.tags = profile ? getNpcTags(profile.skills) : [{ name: '輔助', type: 'support' }];
        });

        const combatState = { 
            turn: 1, 
            player: { 
                username, 
                skills: playerSkills, 
                hp: maxHp, 
                maxHp, 
                mp: maxMp, 
                maxMp,
                tags: [{ name: '主角', type: 'attack' }]
            }, 
            enemies: combatSetupResult.combatants,
            allies: combatSetupResult.allies || [], 
            bystanders: combatSetupResult.bystanders || [], 
            log: [combatSetupResult.combatIntro || '戰鬥開始了！'],
            isSparring: intention === '切磋',
            intention: intention
        };

        await userDocRef.collection('game_state').doc('current_combat').set(combatState);
        
        console.log(`[戰鬥系統] 由玩家 ${username} 主動對 ${targetNpcName} 發起戰鬥，意圖為「${intention}」。`);
        res.json({ status: 'COMBAT_START', initialState: combatState });

    } catch (error) {
        console.error(`[UserID: ${userId}] /initiate-combat 錯誤:`, error);
        res.status(500).json({ message: error.message || "發起戰鬥時發生未知錯誤" });
    }
};

const combatActionRouteHandler = async (req, res) => {
    const userId = req.user.id;
    const { strategy, skill, model: playerModelChoice } = req.body;

    try {
        const userDocRef = db.collection('users').doc(userId);
        const combatDocRef = userDocRef.collection('game_state').doc('current_combat');

        const combatDoc = await combatDocRef.get();
        if (!combatDoc.exists) {
            return res.status(404).json({ message: "戰鬥不存在或已結束。" });
        }

        let combatState = combatDoc.data();
        
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

        const combatResult = await getAICombatAction(playerModelChoice, playerProfile, combatState, { strategy, skill });

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
        
        // 【核心修改】使用 Transaction 來更新玩家數值
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
        
        // 【核心修改】使用 Transaction 來更新玩家數值
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
