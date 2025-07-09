// /api/combatRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAICombatAction, getAISurrenderResult } = require('../services/aiService');
const { 
    updateInventory, 
    updateFriendlinessValues, 
    updateRomanceValues, 
    getInventoryState, 
    invalidateNovelCache, 
    updateLibraryNovel, 
    getPlayerSkills 
} = require('./gameHelpers');

const db = admin.firestore();

// 處理玩家戰鬥指令的核心函式
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

        const knownSkill = skills.find(s => action.includes(s.name) && s.level > 0);
        let combatResult;

        if (knownSkill) {
            combatResult = await getAICombatAction(playerModelChoice, playerProfile, combatState, action);
        } else {
            console.log(`[戰鬥系統] 玩家 ${playerProfile.username} 試圖使用未知或未掌握的招式。`);
            combatResult = {
                narrative: `你憑著記憶，試圖施展「${action}」，卻只覺劍招散亂，不成章法，破綻百出。`,
                damageDealt: [],
                enemies: combatState.enemies,
                allies: combatState.allies,
                combatOver: false
            };
        }

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

// 處理玩家認輸指令的核心函式
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

// 將路由綁定到對應的處理函式
router.post('/combat-action', combatActionRouteHandler);
router.post('/combat-surrender', surrenderRouteHandler);

module.exports = router;
