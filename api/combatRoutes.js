const express = require('express');
const admin = require('firebase-admin');
const {
    getAICombatAction,
    getAISurrenderResult,
    getAIPostCombatResult,
    getAISummary,
    getAISuggestion
} = require('../services/aiService');
const { getMergedNpcProfile, getFriendlinessLevel, processNpcUpdates } = require('./npcHelpers');
const {
    getPlayerSkills,
    updateInventory,
    getInventoryState,
    getOrGenerateSkillTemplate
} = require('./playerStateHelpers');
const { updateLibraryNovel, invalidateNovelCache, getMergedLocationData } = require('./worldStateHelpers');
const { processReputationChangesAfterDeath } = require('./reputationManager');
const { initiateCombat } = require('./gameplay/combatManager');

const router = express.Router();
const db = admin.firestore();

const VALID_COMBAT_STRATEGIES = new Set(['attack', 'defend', 'evade', 'support', 'heal']);
const PENDING_COMBAT_RESULT_DOC_ID = 'pending_combat_result';
const COMBAT_INTENTION_KILL = '打死';

function toSafeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeCombatLog(log) {
    if (!Array.isArray(log)) return [];
    return log.filter(entry => typeof entry === 'string').slice(-200);
}

function getAliveCharacters(list = []) {
    return (Array.isArray(list) ? list : []).filter(c => c && toSafeNumber(c.hp, 0) > 0);
}

function getCharacterName(character) {
    return String(character?.name || character?.username || '').trim();
}

function buildTargetPool(combatState, strategy) {
    const player = combatState?.player;
    const allies = Array.isArray(combatState?.allies) ? combatState.allies : [];
    const enemies = Array.isArray(combatState?.enemies) ? combatState.enemies : [];
    const selfTarget = player ? [{ name: getCharacterName(player), side: 'player' }] : [];
    const allyTargets = getAliveCharacters(allies).map(a => ({ name: getCharacterName(a), side: 'ally' }));
    const enemyTargets = getAliveCharacters(enemies).map(e => ({ name: getCharacterName(e), side: 'enemy' }));

    switch (strategy) {
        case 'attack':
            return enemyTargets;
        case 'heal':
        case 'support':
            return [...selfTarget, ...allyTargets];
        case 'defend':
        case 'evade':
            return selfTarget;
        default:
            return [];
    }
}

function resolveCombatTarget(combatState, strategy, requestedTarget) {
    const pool = buildTargetPool(combatState, strategy);
    if (pool.length === 0) {
        return { targetName: null, validPool: [] };
    }

    const requestedName = String(requestedTarget || '').trim();
    const allowedNames = new Set(pool.map(t => t.name));
    if (requestedName) {
        if (!allowedNames.has(requestedName)) {
            const error = new Error(`目標 ${requestedName} 不在可選戰場目標中。`);
            error.statusCode = 400;
            throw error;
        }
        return { targetName: requestedName, validPool: pool };
    }

    return { targetName: pool[0].name, validPool: pool };
}

function clampCombatantResourceValue(character) {
    if (!character || typeof character !== 'object') return character;
    const next = { ...character };
    if (next.maxHp !== undefined) {
        next.maxHp = Math.max(1, toSafeNumber(next.maxHp, 1));
        next.hp = clampNumber(toSafeNumber(next.hp, next.maxHp), 0, next.maxHp);
    }
    if (next.maxMp !== undefined) {
        next.maxMp = Math.max(0, toSafeNumber(next.maxMp, 0));
        next.mp = clampNumber(toSafeNumber(next.mp, next.maxMp), 0, next.maxMp);
    }
    return next;
}

function normalizeCombatantUpdatesArray(rawUpdates) {
    if (Array.isArray(rawUpdates)) {
        return rawUpdates.filter(u => u && typeof u === 'object');
    }

    if (rawUpdates && typeof rawUpdates === 'object') {
        return Object.entries(rawUpdates).map(([name, delta]) => {
            const base = delta && typeof delta === 'object' ? delta : {};
            return { ...base, name: base.name || name };
        });
    }

    return null;
}

function findCombatantDeltaByNameOrIndex(updates, originalCombatant, index) {
    if (!Array.isArray(updates)) return null;

    const originalName = getCharacterName(originalCombatant);
    if (originalName) {
        const byName = updates.find(u => getCharacterName(u) === originalName);
        if (byName) return byName;
    }

    const byIndex = updates[index];
    return byIndex && typeof byIndex === 'object' ? byIndex : null;
}

function projectCombatResources(state) {
    const normalizeList = (list) => (Array.isArray(list) ? list : []).map((c, index) => ({
        key: getCharacterName(c) || `#${index}`,
        hp: toSafeNumber(c?.hp, 0),
        maxHp: toSafeNumber(c?.maxHp, 0),
        mp: toSafeNumber(c?.mp, 0),
        maxMp: toSafeNumber(c?.maxMp, 0)
    }));

    return {
        player: state?.player ? {
            key: getCharacterName(state.player) || 'player',
            hp: toSafeNumber(state.player.hp, 0),
            maxHp: toSafeNumber(state.player.maxHp, 0),
            mp: toSafeNumber(state.player.mp, 0),
            maxMp: toSafeNumber(state.player.maxMp, 0)
        } : null,
        allies: normalizeList(state?.allies),
        enemies: normalizeList(state?.enemies)
    };
}

function applyDeterministicCombatFallback(beforeState, nextState, actionContext = {}) {
    if (!nextState || typeof nextState !== 'object') return nextState;

    const strategy = String(actionContext.strategy || '').trim().toLowerCase();
    const targetName = String(actionContext.targetName || '').trim();
    const selectedSkill = actionContext.selectedSkill && typeof actionContext.selectedSkill === 'object'
        ? actionContext.selectedSkill
        : null;
    const powerLevel = Math.max(1, Math.floor(toSafeNumber(actionContext.powerLevel, 1)));

    const beforePlayer = beforeState?.player || null;
    const nextPlayer = nextState.player || null;
    const expectedMpCost = selectedSkill
        ? Math.max(0, toSafeNumber(selectedSkill.cost, 5)) * powerLevel
        : 0;

    if (nextPlayer && expectedMpCost > 0) {
        const beforeMp = toSafeNumber(beforePlayer?.mp, toSafeNumber(nextPlayer.mp, 0));
        const currentMp = toSafeNumber(nextPlayer.mp, beforeMp);
        if (currentMp >= beforeMp) {
            nextPlayer.mp = Math.max(0, beforeMp - expectedMpCost);
            nextState.player = clampCombatantResourceValue(nextPlayer);
        }
    }

    const beforeResources = JSON.stringify(projectCombatResources(beforeState));
    const afterResources = JSON.stringify(projectCombatResources(nextState));
    if (beforeResources !== afterResources) {
        return nextState;
    }

    const skillLevel = Math.max(1, Math.floor(toSafeNumber(selectedSkill?.level, 1)));
    const baseMagnitude = Math.max(4, (skillLevel * 2) + (powerLevel * 3));

    const applyEnemyDamage = () => {
        const enemies = Array.isArray(nextState.enemies) ? nextState.enemies : [];
        if (enemies.length === 0) return false;

        let targetIndex = enemies.findIndex(e => getCharacterName(e) === targetName);
        if (targetIndex < 0) targetIndex = enemies.findIndex(e => toSafeNumber(e?.hp, 0) > 0);
        if (targetIndex < 0) return false;

        const target = { ...enemies[targetIndex] };
        const targetBefore = (Array.isArray(beforeState?.enemies) ? beforeState.enemies : [])[targetIndex] || {};
        const beforeHp = toSafeNumber(targetBefore.hp, toSafeNumber(target.hp, 0));
        const damage = Math.max(1, baseMagnitude + (selectedSkill ? 3 : 0));
        target.hp = Math.max(0, beforeHp - damage);
        enemies[targetIndex] = clampCombatantResourceValue(target);
        nextState.enemies = enemies;

        if (nextState.player && target.hp > 0) {
            const player = { ...nextState.player };
            const beforeHpPlayer = toSafeNumber(beforeState?.player?.hp, toSafeNumber(player.hp, 0));
            const counterDamage = Math.max(0, Math.floor(baseMagnitude * 0.45));
            if (counterDamage > 0) {
                player.hp = Math.max(0, beforeHpPlayer - counterDamage);
                nextState.player = clampCombatantResourceValue(player);
            }
        }
        return true;
    };

    const applyAllyHealOrSupport = (mode) => {
        const allies = [nextState.player, ...(Array.isArray(nextState.allies) ? nextState.allies : [])];
        const beforeAllies = [beforeState?.player, ...((Array.isArray(beforeState?.allies) ? beforeState.allies : []))];
        if (allies.length === 0) return false;

        let targetIndex = allies.findIndex(a => getCharacterName(a) === targetName);
        if (targetIndex < 0) {
            if (mode === 'heal') {
                targetIndex = allies.findIndex(a => a && toSafeNumber(a.hp, 0) > 0 && toSafeNumber(a.hp, 0) < toSafeNumber(a.maxHp, a.hp || 0));
            } else {
                targetIndex = 0;
            }
        }
        if (targetIndex < 0 || !allies[targetIndex]) return false;

        const target = { ...allies[targetIndex] };
        const beforeTarget = beforeAllies[targetIndex] || {};
        if (mode === 'heal') {
            const beforeHp = toSafeNumber(beforeTarget.hp, toSafeNumber(target.hp, 0));
            const maxHp = Math.max(1, toSafeNumber(target.maxHp, beforeTarget.maxHp || beforeHp || 1));
            target.hp = Math.min(maxHp, beforeHp + Math.max(4, baseMagnitude));
        } else {
            const beforeMp = toSafeNumber(beforeTarget.mp, toSafeNumber(target.mp, 0));
            const maxMp = Math.max(0, toSafeNumber(target.maxMp, beforeTarget.maxMp || beforeMp || 0));
            target.mp = Math.min(maxMp, beforeMp + Math.max(2, Math.floor(baseMagnitude / 2)));
        }
        const clampedTarget = clampCombatantResourceValue(target);

        if (targetIndex === 0) {
            nextState.player = clampedTarget;
        } else {
            const nextAllies = Array.isArray(nextState.allies) ? [...nextState.allies] : [];
            nextAllies[targetIndex - 1] = clampedTarget;
            nextState.allies = nextAllies;
        }
        return true;
    };

    if (strategy === 'attack') {
        applyEnemyDamage();
    } else if (strategy === 'heal') {
        applyAllyHealOrSupport('heal');
    } else if (strategy === 'support') {
        applyAllyHealOrSupport('support');
    }

    return nextState;
}

function mergeCombatStateWithAIResult(combatState, combatResult, actionContext = {}) {
    const finalUpdatedState = {
        ...combatState,
        turn: (toSafeNumber(combatState.turn, 1) || 1) + 1,
        log: [...normalizeCombatLog(combatState.log), combatResult.narrative]
    };

    if (!combatResult.updatedState || typeof combatResult.updatedState !== 'object') {
        return finalUpdatedState;
    }

    if (combatResult.updatedState.player) {
        const originalSkills = finalUpdatedState.player?.skills;
        finalUpdatedState.player = clampCombatantResourceValue({
            ...(finalUpdatedState.player || {}),
            ...combatResult.updatedState.player
        });
        if (originalSkills) finalUpdatedState.player.skills = originalSkills;
    }

    const enemyUpdates = normalizeCombatantUpdatesArray(combatResult.updatedState.enemies);
    if (enemyUpdates) {
        finalUpdatedState.enemies = (finalUpdatedState.enemies || []).map((enemy, index) => {
            const updatedEnemy = findCombatantDeltaByNameOrIndex(enemyUpdates, enemy, index);
            return updatedEnemy ? clampCombatantResourceValue({ ...enemy, ...updatedEnemy }) : enemy;
        });
    }

    const allyUpdates = normalizeCombatantUpdatesArray(combatResult.updatedState.allies);
    if (allyUpdates) {
        finalUpdatedState.allies = (finalUpdatedState.allies || []).map((ally, index) => {
            const updatedAlly = findCombatantDeltaByNameOrIndex(allyUpdates, ally, index);
            return updatedAlly ? clampCombatantResourceValue({ ...ally, ...updatedAlly }) : ally;
        });
    }

    return applyDeterministicCombatFallback(combatState, finalUpdatedState, actionContext);
}

function normalizePowerChange(powerChange) {
    const base = powerChange && typeof powerChange === 'object' ? powerChange : {};
    return {
        internal: toSafeNumber(base.internal, 0),
        external: toSafeNumber(base.external, 0),
        lightness: toSafeNumber(base.lightness, 0)
    };
}

function extractKilledNpcNames(npcUpdates) {
    return (Array.isArray(npcUpdates) ? npcUpdates : [])
        .filter(update => update && update.fieldToUpdate === 'isDeceased' && update.newValue === true && update.npcName)
        .map(update => update.npcName);
}

async function initiateCombatHandler(req, res) {
    const { id: userId, username } = req.user;
    const { targetNpcName, intention } = req.body || {};

    try {
        const initialState = await initiateCombat(userId, username, targetNpcName, intention);
        await db.collection('users').doc(userId).collection('game_state').doc(PENDING_COMBAT_RESULT_DOC_ID).delete().catch(() => {});
        res.json({ status: 'COMBAT_START', initialState });
    } catch (error) {
        console.error(`[UserID: ${userId}] /initiate-combat error:`, error);
        res.status(error.statusCode || 500).json({ message: error.message || '發起戰鬥失敗。' });
    }
}

async function combatActionRouteHandler(req, res) {
    const userId = req.user.id;
    const { strategy, skill: selectedSkillName, model: playerModelChoice, powerLevel: rawPowerLevel, target: requestedTarget } = req.body || {};

    try {
        if (!VALID_COMBAT_STRATEGIES.has(strategy)) {
            return res.status(400).json({ message: '無效的戰鬥策略。' });
        }

        const userDocRef = db.collection('users').doc(userId);
        const combatDocRef = userDocRef.collection('game_state').doc('current_combat');
        const pendingCombatDocRef = userDocRef.collection('game_state').doc(PENDING_COMBAT_RESULT_DOC_ID);

        const combatDoc = await combatDocRef.get();
        if (!combatDoc.exists) {
            return res.status(404).json({ message: '找不到進行中的戰鬥。' });
        }

        const combatState = combatDoc.data() || {};
        const playerInCombat = combatState.player || {};
        const playerSkills = Array.isArray(playerInCombat.skills) ? playerInCombat.skills : [];

        let selectedSkill = null;
        if (selectedSkillName) {
            selectedSkill = playerSkills.find(s => s && s.skillName === selectedSkillName);
            if (!selectedSkill) {
                console.warn(`[後端驗證失敗] 玩家 ${req.user.username} 試圖使用未學會武學: ${selectedSkillName}`);
                return res.status(403).json({ message: `你尚未學會「${selectedSkillName}」。` });
            }

            const skillTemplateResult = await getOrGenerateSkillTemplate(selectedSkillName);
            if (!skillTemplateResult || !skillTemplateResult.template) {
                return res.status(404).json({ message: `找不到武學模板：${selectedSkillName}` });
            }

            const requiredWeaponType = skillTemplateResult.template.requiredWeaponType;
            const currentWeaponType = playerInCombat.currentWeaponType;
            const isWeaponMatch =
                !requiredWeaponType ||
                (requiredWeaponType && requiredWeaponType !== '無' && requiredWeaponType === currentWeaponType) ||
                (requiredWeaponType === '無' && currentWeaponType === null);

            if (!isWeaponMatch) {
                const weaponName = currentWeaponType ? `${currentWeaponType}武器` : '空手';
                console.warn(`[後端驗證失敗] 玩家 ${req.user.username} 武器不符武學 ${selectedSkillName}: need=${requiredWeaponType} current=${weaponName}`);
                return res.status(403).json({ message: `你目前使用的是 ${weaponName}，無法施展「${selectedSkillName}」。` });
            }
        }

        let powerLevel = Math.max(1, Math.floor(toSafeNumber(rawPowerLevel, 1)));
        if (selectedSkill) {
            const skillLevel = Math.max(1, Math.floor(toSafeNumber(selectedSkill.level, 1)));
            powerLevel = clampNumber(powerLevel, 1, skillLevel);

            const baseCost = Math.max(0, toSafeNumber(selectedSkill.cost, 5));
            const totalCost = baseCost * powerLevel;
            const currentMp = Math.max(0, toSafeNumber(playerInCombat.mp, 0));
            if (totalCost > currentMp) {
                return res.status(400).json({ message: `內力不足，施展「${selectedSkillName}」${powerLevel} 成需要 ${totalCost} 點內力。` });
            }
        } else {
            powerLevel = 1;
        }

        let targetName;
        try {
            ({ targetName } = resolveCombatTarget(combatState, strategy, requestedTarget));
        } catch (targetError) {
            return res.status(targetError.statusCode || 400).json({ message: targetError.message || '目標選擇無效。' });
        }

        const [userDoc, skills] = await Promise.all([
            userDocRef.get(),
            getPlayerSkills(userId)
        ]);

        const playerProfile = userDoc.exists ? userDoc.data() : {};
        playerProfile.skills = skills;
        playerProfile.hp = toSafeNumber(playerInCombat.hp, playerProfile.hp || 0);
        playerProfile.maxHp = toSafeNumber(playerInCombat.maxHp, playerProfile.maxHp || playerProfile.hp || 1);
        playerProfile.mp = toSafeNumber(playerInCombat.mp, playerProfile.mp || 0);
        playerProfile.maxMp = toSafeNumber(playerInCombat.maxMp, playerProfile.maxMp || playerProfile.mp || 0);

        const combatResult = await getAICombatAction(playerModelChoice, playerProfile, combatState, {
            strategy,
            skill: selectedSkillName || null,
            powerLevel,
            target: targetName || null
        });

        if (!combatResult || typeof combatResult !== 'object') {
            throw new Error('戰鬥 AI 回傳格式異常。');
        }
        if (typeof combatResult.narrative !== 'string' || !combatResult.narrative.trim()) {
            combatResult.narrative = '雙方身影交錯，戰局一時難分高下。';
        }

        const finalUpdatedState = mergeCombatStateWithAIResult(combatState, combatResult, {
            strategy,
            selectedSkill,
            powerLevel,
            targetName
        });

        const computedStatus = (Array.isArray(finalUpdatedState.enemies) && finalUpdatedState.enemies.length > 0 && finalUpdatedState.enemies.every(e => toSafeNumber(e?.hp, 0) <= 0))
            ? 'COMBAT_END'
            : 'COMBAT_ONGOING';
        const resolvedCombatStatus = combatResult.status === 'COMBAT_END' ? 'COMBAT_END' : computedStatus;
        combatResult.status = resolvedCombatStatus;

        if (combatResult.status === 'COMBAT_END') {
            const pendingPayload = {
                finalState: finalUpdatedState,
                log: normalizeCombatLog(finalUpdatedState.log),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            await pendingCombatDocRef.set(pendingPayload);
            await combatDocRef.delete();

            return res.json({
                status: 'COMBAT_END',
                narrative: combatResult.narrative,
                updatedState: finalUpdatedState,
                combatResult: { pending: true }
            });
        }

        await combatDocRef.set(finalUpdatedState);
        res.json({
            status: 'COMBAT_ONGOING',
            narrative: combatResult.narrative,
            updatedState: finalUpdatedState
        });
    } catch (error) {
        console.error(`[UserID: ${userId}] /combat-action error:`, error);
        res.status(error.statusCode || 500).json({ message: error.message || '戰鬥行動失敗。' });
    }
}

async function surrenderRouteHandler(req, res) {
    const userId = req.user.id;
    const { model: playerModelChoice } = req.body || {};

    try {
        const userDocRef = db.collection('users').doc(userId);
        const combatDocRef = userDocRef.collection('game_state').doc('current_combat');

        const [userDoc, combatDoc] = await Promise.all([userDocRef.get(), combatDocRef.get()]);
        if (!combatDoc.exists) {
            return res.status(404).json({ message: '找不到進行中的戰鬥，無法認輸。' });
        }
        if (!userDoc.exists) {
            return res.status(404).json({ message: '找不到玩家資料。' });
        }

        const playerProfile = userDoc.data() || {};
        const combatState = combatDoc.data() || {};
        const surrenderResult = await getAISurrenderResult(playerModelChoice, playerProfile, combatState);
        if (!surrenderResult || typeof surrenderResult !== 'object') {
            throw new Error('認輸 AI 回傳格式異常。');
        }

        combatState.log = [...normalizeCombatLog(combatState.log), String(surrenderResult.narrative || '你試圖認輸。')];
        await combatDocRef.set(combatState);

        if (!surrenderResult.accepted) {
            return res.json({
                status: 'SURRENDER_REJECTED',
                narrative: surrenderResult.narrative || '對方拒絕了你的認輸。'
            });
        }

        await combatDocRef.delete();
        await userDocRef.collection('game_state').doc(PENDING_COMBAT_RESULT_DOC_ID).delete().catch(() => {});

        const lastSaveSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        if (lastSaveSnapshot.empty) {
            throw new Error('找不到最新回合資料。');
        }
        const lastRoundData = lastSaveSnapshot.docs[0].data();
        const surrenderOutcome = surrenderResult.outcome || {};
        const playerChanges = surrenderOutcome.playerChanges || {};

        await db.runTransaction(async transaction => {
            const currentUserDoc = await transaction.get(userDocRef);
            if (!currentUserDoc.exists) throw new Error('玩家資料不存在。');

            const currentData = currentUserDoc.data() || {};
            const powerChange = normalizePowerChange(playerChanges.powerChange);
            const moralityChange = toSafeNumber(playerChanges.moralityChange, 0);

            transaction.update(userDocRef, {
                internalPower: Math.max(0, toSafeNumber(currentData.internalPower, 0) + powerChange.internal),
                externalPower: Math.max(0, toSafeNumber(currentData.externalPower, 0) + powerChange.external),
                lightness: Math.max(0, toSafeNumber(currentData.lightness, 0) + powerChange.lightness),
                morality: toSafeNumber(currentData.morality, 0) + moralityChange
            });
        });

        if (Array.isArray(playerChanges.itemChanges) && playerChanges.itemChanges.length > 0) {
            await updateInventory(userId, playerChanges.itemChanges, lastRoundData);
        }

        const [updatedUserDoc, inventoryState] = await Promise.all([
            userDocRef.get(),
            getInventoryState(userId)
        ]);
        const updatedUserProfile = updatedUserDoc.data() || {};

        const enemyNames = (combatState.enemies || []).map(e => getCharacterName(e)).filter(Boolean).join('、');
        const newRoundData = {
            ...lastRoundData,
            ...inventoryState,
            R: toSafeNumber(lastRoundData.R, 0) + 1,
            story: surrenderResult.narrative || '你低頭認輸，戰局暫止。',
            PC: playerChanges.PC || surrenderOutcome.summary || '你在戰鬥中失利，氣血翻騰。',
            EVT: `${enemyNames || '對手'} 接受了你的認輸`,
            internalPower: updatedUserProfile.internalPower,
            externalPower: updatedUserProfile.externalPower,
            lightness: updatedUserProfile.lightness,
            morality: updatedUserProfile.morality
        };

        await userDocRef.collection('game_saves').doc(`R${newRoundData.R}`).set(newRoundData);
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, playerProfile.username).catch(err => console.error('更新小說庫失敗（認輸）:', err));

        res.json({
            status: 'SURRENDER_ACCEPTED',
            narrative: surrenderResult.narrative || '你選擇認輸，對方暫且收手。',
            newRound: {
                story: newRoundData.story,
                roundData: newRoundData,
                suggestion: '先穩住傷勢，再決定下一步。'
            }
        });
    } catch (error) {
        console.error(`[UserID: ${userId}] /combat-surrender error:`, error);
        res.status(error.statusCode || 500).json({ message: error.message || '認輸處理失敗。' });
    }
}

async function finalizeCombatHandler(req, res) {
    const userId = req.user.id;
    const username = req.user.username;
    const { model: playerModelChoice } = req.body || {};

    try {
        const userDocRef = db.collection('users').doc(userId);
        const summaryDocRef = userDocRef.collection('game_state').doc('summary');
        const pendingCombatDocRef = userDocRef.collection('game_state').doc(PENDING_COMBAT_RESULT_DOC_ID);

        const [pendingSnapshot, lastSaveSnapshot, userProfileSnap] = await Promise.all([
            pendingCombatDocRef.get(),
            userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get(),
            userDocRef.get()
        ]);

        if (!pendingSnapshot.exists) {
            return res.status(409).json({ message: '找不到待結算的戰鬥結果，可能已完成或已失效。' });
        }
        if (lastSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到最新回合資料。' });
        }
        if (!userProfileSnap.exists) {
            return res.status(404).json({ message: '找不到玩家資料。' });
        }

        const pendingCombatResult = pendingSnapshot.data() || {};
        const finalState = pendingCombatResult.finalState;
        const combatLog = normalizeCombatLog(pendingCombatResult.log || finalState?.log);
        if (!finalState || !Array.isArray(finalState.enemies)) {
            return res.status(400).json({ message: '待結算戰鬥資料損毀，請重新發起戰鬥。' });
        }

        const preCombatRoundData = lastSaveSnapshot.docs[0].data();
        const userProfile = userProfileSnap.data() || {};

        const playerWon = finalState.enemies.every(e => toSafeNumber(e?.hp, 0) <= 0);
        const killerName = (playerWon && finalState.intention === COMBAT_INTENTION_KILL) ? username : null;

        const postCombatOutcome = await getAIPostCombatResult(
            playerModelChoice,
            { ...userProfile, username },
            finalState,
            combatLog,
            killerName
        );

        if (!postCombatOutcome || !postCombatOutcome.outcome) {
            throw new Error('戰後敘事生成失敗。');
        }

        const outcome = postCombatOutcome.outcome || {};
        let summary = String(outcome.summary || postCombatOutcome.narrative || '一場戰鬥落下帷幕。');
        let EVT = outcome.EVT;
        const playerChanges = outcome.playerChanges || {};
        const itemChanges = Array.isArray(outcome.itemChanges) ? outcome.itemChanges : [];
        const npcUpdates = Array.isArray(outcome.npcUpdates) ? outcome.npcUpdates : [];
        const killedNpcNames = extractKilledNpcNames(npcUpdates);

        await updateInventory(userId, itemChanges, preCombatRoundData);

        if (playerChanges && (playerChanges.powerChange || playerChanges.moralityChange || killedNpcNames.length > 0)) {
            await db.runTransaction(async transaction => {
                const currentUserDoc = await transaction.get(userDocRef);
                if (!currentUserDoc.exists) throw new Error('玩家資料不存在。');

                const currentData = currentUserDoc.data() || {};
                const powerChange = normalizePowerChange(playerChanges.powerChange);
                const moralityChange = toSafeNumber(playerChanges.moralityChange, 0);

                const updates = {
                    internalPower: Math.max(0, toSafeNumber(currentData.internalPower, 0) + powerChange.internal),
                    externalPower: Math.max(0, toSafeNumber(currentData.externalPower, 0) + powerChange.external),
                    lightness: Math.max(0, toSafeNumber(currentData.lightness, 0) + powerChange.lightness)
                };

                if (playerChanges.moralityChange !== undefined) {
                    updates.morality = toSafeNumber(currentData.morality, 0) + moralityChange;
                }
                if (killedNpcNames.length > 0) {
                    updates.deathAftermathCooldown = 5;
                }

                transaction.update(userDocRef, updates);
            });
        }

        if (killedNpcNames.length > 0) {
            const allyNames = (Array.isArray(finalState.allies) ? finalState.allies : []).map(a => getCharacterName(a)).filter(Boolean);
            const reputationSummary = await processReputationChangesAfterDeath(
                userId,
                killedNpcNames,
                Array.isArray(preCombatRoundData.LOC) ? preCombatRoundData.LOC[0] : null,
                allyNames,
                killerName
            );
            if (reputationSummary) {
                summary += `\n\n**後續影響** ${reputationSummary}`;
            }
        }

        if (npcUpdates.length > 0) {
            await processNpcUpdates(userId, npcUpdates);
        }

        const newRoundNumber = toSafeNumber(preCombatRoundData.R, 0) + 1;
        const [updatedUserDoc, inventoryState, updatedSkills] = await Promise.all([
            userDocRef.get(),
            getInventoryState(userId),
            getPlayerSkills(userId)
        ]);
        const finalUserProfile = updatedUserDoc.data() || {};

        const finalRoundData = {
            ...preCombatRoundData,
            ...finalUserProfile,
            ...inventoryState,
            R: newRoundNumber,
            story: summary,
            PC: playerChanges.PC || summary,
            EVT: EVT || '一場衝突暫時落幕',
            skills: updatedSkills
        };

        const finalNpcList = [];
        const sceneNpcNames = new Set([
            ...(Array.isArray(finalState.enemies) ? finalState.enemies : []).map(e => getCharacterName(e)),
            ...(Array.isArray(finalState.allies) ? finalState.allies : []).map(a => getCharacterName(a))
        ].filter(Boolean));

        for (const npcName of sceneNpcNames) {
            const profile = await getMergedNpcProfile(userId, npcName);
            if (!profile) continue;
            finalNpcList.push({
                name: profile.name,
                status: profile.isDeceased ? '已死亡' : (profile.status || '狀態不明'),
                friendliness: getFriendlinessLevel(profile.friendlinessValue),
                isDeceased: !!profile.isDeceased
            });
        }
        finalRoundData.NPC = finalNpcList;

        const longTermSummary = (await summaryDocRef.get()).data()?.text || '...';
        const [newSummary, suggestion] = await Promise.all([
            getAISummary(longTermSummary, finalRoundData),
            getAISuggestion(finalRoundData, playerModelChoice)
        ]);

        await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });
        await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(finalRoundData);
        await pendingCombatDocRef.delete().catch(() => {});

        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error('更新小說庫失敗（戰鬥結算）:', err));

        res.json({
            story: finalRoundData.story,
            roundData: finalRoundData,
            suggestion,
            locationData: await getMergedLocationData(userId, finalRoundData.LOC)
        });
    } catch (error) {
        console.error(`[UserID: ${userId}] /finalize-combat error:`, error);
        if (!res.headersSent) {
            res.status(error.statusCode || 500).json({ message: error.message || '戰鬥結算失敗。' });
        }
    }
}

router.post('/initiate', initiateCombatHandler);
router.post('/action', combatActionRouteHandler);
router.post('/surrender', surrenderRouteHandler);
router.post('/finalize-combat', finalizeCombatHandler);

module.exports = router;
