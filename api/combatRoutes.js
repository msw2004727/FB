// /api/combatRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAICombatSetup, getAICombatAction, getAISurrenderResult, getAIPostCombatResult } = require('../services/aiService');
const { 
    updateFriendlinessValues, 
    getInventoryState, 
    invalidateNovelCache, 
    updateLibraryNovel, 
    getPlayerSkills,
    updateInventory,
    processNpcUpdates
} = require('./gameHelpers');
const { processReputationChangesAfterDeath } = require('./reputationManager');

const db = admin.firestore();

// 輔助函式：根據NPC技能推斷其戰鬥特性標籤
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
        // 【核心修改】增加對 skill 和 skill.name 的有效性檢查
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

    if (tags.size === 0) tags.add('攻擊'); // 如果沒有匹配，預設為攻擊

    const typeMapping = { '攻擊': 'attack', '防禦': 'defend', '治癒': 'heal', '輔助': 'support' };
    return Array.from(tags).map(tagName => ({
        name: tagName,
        type: typeMapping[tagName] || 'attack'
    }));
};


// 處理戰鬥發起的核心函式
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
            // 玩家數值修正
            if (combatResult.updatedState.player) {
                const originalSkills = finalUpdatedState.player.skills;
                finalUpdatedState.player = { ...finalUpdatedState.player, ...combatResult.updatedState.player };
                finalUpdatedState.player.skills = originalSkills;
                if (finalUpdatedState.player.hp < 0) finalUpdatedState.player.hp = 0;
                if (finalUpdatedState.player.mp < 0) finalUpdatedState.player.mp = 0;
            }
            // 敵人數值修正
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
            // 盟友數值修正
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

router.post('/initiate', initiateCombatHandler);
router.post('/action', combatActionRouteHandler);
router.post('/surrender', surrenderRouteHandler);

module.exports = router;
