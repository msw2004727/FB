// client/engine/gameEngine.js
// 遊戲引擎主模組 — 整合所有子系統，提供統一的遊戲操作 API
// 這是 api.js 改寫時的主要對接點

import clientDB from '../db/clientDB.js';
import aiProxy from '../ai/aiProxy.js';
import { buildContext, buildLightContext } from './contextBuilder.js';
import { applyAllChanges } from './stateManager.js';
import {
    deepClone, calculateBulkScore, calculateCultivationOutcome,
    toFiniteNumber, clamp, MAX_POWER, nextTimeOfDay, isCurrencyLikeItem,
    getFriendlinessLevel, normalizeLocationHierarchy
} from '../utils/gameUtils.js';

// ── 當前活躍檔案 ────────────────────────────────────

let _activeProfileId = null;

export function setActiveProfile(profileId) {
    _activeProfileId = profileId;
}

export function getActiveProfileId() {
    return _activeProfileId;
}

// ── 遊戲初始化 ──────────────────────────────────────

/**
 * 建立新遊戲
 */
export async function createNewGame(username, gender) {
    await clientDB.init();

    const profile = await clientDB.profiles.create({ username, gender });
    const profileId = profile.id;

    // 建立初始技能
    await clientDB.skills.add(profileId, {
        skillName: '現代搏擊',
        level: 1, exp: 0,
        power_type: 'external',
        combatCategory: 'attack',
        base_description: '源自現代的基礎搏鬥技巧。',
        isCustom: false,
        skillType: '外功'
    });

    // 建立初始貨幣
    await clientDB.inventory.add(profileId, {
        itemName: '銀兩',
        templateId: '銀兩',
        quantity: 50,
        itemType: '財寶',
        category: '貨幣',
        bulk: '輕',
        baseDescription: '行走江湖的盤纏。',
        value: 50
    });

    // 建立 R0 存檔
    const initialRound = {
        R: 0,
        EVT: '初入江湖',
        story: `${username}踏上了充滿未知的江湖之路。眼前是一片陌生的景象，遠方傳來隱約的市集喧嘩聲。`,
        ATM: ['晨光微曦', '空氣中帶著泥土與草木的氣息'],
        WRD: '晴',
        LOC: ['梁國', '東境', '臨川', '無名村'],
        PC: `${username}初來乍到，對這個武林世界充滿好奇與警惕。`,
        NPC: [],
        QST: '',
        PSY: '對未知的世界既期待又不安。',
        CLS: '',
        IMP: '',
        timeOfDay: '上午',
        internalPower: 5,
        externalPower: 5,
        lightness: 5,
        morality: 0,
        stamina: 100,
        yearName: '元祐',
        year: 1, month: 1, day: 1,
        playerState: 'alive',
        powerChange: { internal: 0, external: 0, lightness: 0 },
        moralityChange: 0,
        suggestion: '先四處探索，了解周遭環境。'
    };

    await clientDB.saves.add(profileId, initialRound);
    setActiveProfile(profileId);
    return { profile, roundData: initialRound };
}

// ── 遊戲載入 ────────────────────────────────────────

/**
 * 載入最新遊戲狀態（取代 GET /api/game/state/latest-game）
 */
export async function getLatestGame() {
    const profileId = getActiveProfileId();
    const profile = await clientDB.profiles.get(profileId);

    if (profile.isDeceased) {
        const lastSave = await clientDB.saves.getLatest(profileId);
        return {
            gameState: 'deceased',
            roundData: lastSave,
            inventory: await clientDB.inventory.list(profileId),
            locationData: null
        };
    }

    const lastSave = await clientDB.saves.getLatest(profileId);
    if (!lastSave) throw new Error('找不到存檔資料。');

    const inventory = await clientDB.inventory.list(profileId);
    const skills = await clientDB.skills.list(profileId);
    const bulkScore = calculateBulkScore(inventory);

    // 合併 profile 資料到 roundData
    const roundData = {
        ...lastSave,
        internalPower: profile.internalPower,
        externalPower: profile.externalPower,
        lightness: profile.lightness,
        morality: profile.morality,
        stamina: profile.stamina,
        bulkScore,
        skills,
        inventory,
        money: getSilverAmount(inventory),
        silver: getSilverAmount(inventory),
        suggestion: lastSave.suggestion || '先觀察場面，再採取行動。'
    };

    // 載入地點資料
    let locationData = null;
    if (lastSave.LOC) {
        const locName = Array.isArray(lastSave.LOC)
            ? lastSave.LOC[lastSave.LOC.length - 1]
            : lastSave.LOC;
        const staticLoc = await clientDB.locations.getTemplate(locName);
        const dynamicLoc = await clientDB.locations.getState(profileId, locName);
        locationData = staticLoc || dynamicLoc || null;
    }

    // 檢查是否有新懸賞
    const allBounties = await clientDB.bounties.list(profileId);
    const hasNewBounties = allBounties.some(b => !b.isRead);

    return {
        gameState: 'alive',
        story: lastSave.story,
        prequel: null,
        roundData,
        suggestion: roundData.suggestion,
        locationData,
        inventory,
        hasNewBounties
    };
}

// ── 玩家行動 ────────────────────────────────────────

/**
 * 處理玩家行動（取代 POST /api/game/play/interact）
 */
export async function interact({ action, model }) {
    const profileId = getActiveProfileId();
    const context = await buildContext(profileId);

    // 呼叫 AI Proxy 生成故事（映射 context 欄位到 proxy 期望的格式）
    const aiResult = await aiProxy.generate('story', model, {
        ...context,
        playerAction: action,
        // 映射欄位名稱以匹配 AI Proxy 的 task handler
        userProfile: context.player,
        username: context.player.username,
        currentTimeOfDay: context.player.currentTimeOfDay,
        playerPower: context.player.power,
        playerMorality: context.player.morality,
        playerBulkScore: context.bulkScore,
        actorCandidates: (context.npcContext ? Object.keys(context.npcContext) : []),
        levelUpEvents: [],
        romanceEventToWeave: null,
        worldEventToWeave: null,
        blackShadowEvent: Math.random() < 0.1
    });

    if (!aiResult || !aiResult.roundData) {
        throw new Error('AI 回應缺少 roundData');
    }

    const roundData = aiResult.roundData;
    roundData.R = (context.player.R || 0) + 1;
    roundData.story = aiResult.story || roundData.story;

    // 應用所有變動到 IndexedDB
    const result = await applyAllChanges(profileId, roundData);

    // 組裝回應（與原 API 格式相同）
    return {
        story: roundData.story,
        roundData: {
            ...roundData,
            ...result.profile,
            inventory: result.inventory,
            bulkScore: result.bulkScore,
            skills: await clientDB.skills.list(profileId),
            money: getSilverAmount(result.inventory),
            silver: getSilverAmount(result.inventory)
        },
        suggestion: aiResult.suggestion || roundData.suggestion || '繼續探索。',
        locationData: context.locationContext,
        inventory: result.inventory,
        hasNewBounties: false
    };
}

// ── 修煉 ────────────────────────────────────────────

/**
 * 閉關修煉（取代 POST /api/game/cultivation/start）
 */
export async function startCultivation({ skillName, days, model }) {
    const profileId = getActiveProfileId();
    const profile = await clientDB.profiles.get(profileId);
    const skill = await clientDB.skills.get(profileId, skillName);
    if (!skill) throw new Error(`找不到技能: ${skillName}`);

    // 計算修煉結果（純邏輯）
    const cultivationResult = calculateCultivationOutcome(days, profile, skill);

    // 呼叫 AI 生成修煉敘事
    const context = await buildLightContext(profileId);
    const aiStory = await aiProxy.generate('cultivation', model, {
        ...context,
        skillToPractice: skill,
        days,
        outcome: cultivationResult.outcome,
        storyHint: cultivationResult.storyHint
    });

    const story = typeof aiStory === 'string' ? aiStory : (aiStory?.story || cultivationResult.storyHint);

    // 組裝 roundData
    const lastSave = await clientDB.saves.getLatest(profileId);
    const roundData = {
        ...(lastSave || {}),
        R: (lastSave?.R || 0) + 1,
        EVT: `閉關修練：${skillName}`,
        story,
        playerState: 'alive',
        powerChange: cultivationResult.powerChange,
        moralityChange: 0,
        skillChanges: [{
            skillName,
            expChange: cultivationResult.expChange,
            isNewlyAcquired: false
        }],
        daysToAdvance: days,
        stamina: clamp(toFiniteNumber(profile.stamina) - days * 5, 0, 100),
        PC: '你收功起身，氣息略顯疲憊，但功體有進境。',
        suggestion: '先確認身上資源與體力，再決定是否繼續修練。'
    };

    const result = await applyAllChanges(profileId, roundData);

    return {
        success: true,
        story,
        roundData: {
            ...roundData,
            inventory: result.inventory,
            bulkScore: result.bulkScore,
            skills: await clientDB.skills.list(profileId),
            money: getSilverAmount(result.inventory),
            silver: getSilverAmount(result.inventory)
        },
        suggestion: roundData.suggestion,
        locationData: null,
        inventory: result.inventory,
        hasNewBounties: false
    };
}

// ── 戰鬥 ────────────────────────────────────────────

export async function initiateCombat({ targetNpcName, intention, model }) {
    const profileId = getActiveProfileId();
    const context = await buildContext(profileId);

    const aiResult = await aiProxy.generate('combat-setup', model, {
        ...context,
        targetNpcName,
        intention
    });

    // 儲存戰鬥狀態
    await clientDB.state.set(profileId, 'current_combat', aiResult);
    return { status: 'COMBAT_START', initialState: aiResult };
}

export async function combatAction({ strategy, skill, powerLevel, target, model }) {
    const profileId = getActiveProfileId();
    const combatState = await clientDB.state.get(profileId, 'current_combat');
    if (!combatState) throw new Error('目前不在戰鬥中');

    const profile = await clientDB.profiles.get(profileId);
    const playerSkills = await clientDB.skills.list(profileId);

    const aiResult = await aiProxy.generate('combat', model, {
        playerProfile: { ...profile, skills: playerSkills },
        combatState,
        playerAction: { strategy, skill, powerLevel, target }
    });

    // 規範化回傳
    const updatedState = aiResult.updatedState || combatState;
    const turnNumber = (combatState.turnNumber || 0) + 1;
    const status = aiResult.status || (aiResult.combatOver ? 'COMBAT_END' : 'COMBAT_ONGOING');
    const narrative = aiResult.narrative || '';

    // 更新戰鬥狀態
    const newCombatState = { ...combatState, ...updatedState, turnNumber };
    await clientDB.state.set(profileId, 'current_combat', newCombatState);

    if (status === 'COMBAT_END') {
        await clientDB.state.set(profileId, 'pending_combat_result', { ...aiResult, updatedState: newCombatState });
        await clientDB.state.delete(profileId, 'current_combat');
    }

    return { updatedState: { ...newCombatState, turn: turnNumber }, narrative, status };
}

export async function combatSurrender({ model }) {
    const profileId = getActiveProfileId();
    const combatState = await clientDB.state.get(profileId, 'current_combat');
    const profile = await clientDB.profiles.get(profileId);

    const aiResult = await aiProxy.generate('surrender', model, {
        playerProfile: profile,
        combatState
    });

    if (aiResult.accepted) {
        await clientDB.state.delete(profileId, 'current_combat');
        const lastSave = await clientDB.saves.getLatest(profileId);
        const roundData = {
            ...(lastSave || {}),
            R: (lastSave?.R || 0) + 1,
            EVT: '戰鬥認輸',
            story: aiResult.narrative,
            playerState: 'alive',
            ...(aiResult.outcome || {})
        };
        const result = await applyAllChanges(profileId, roundData);
        return {
            status: 'SURRENDER_ACCEPTED',
            narrative: aiResult.narrative,
            newRound: {
                story: roundData.story,
                roundData: { ...roundData, inventory: result.inventory, bulkScore: result.bulkScore },
                suggestion: '戰鬥已結束。',
                inventory: result.inventory
            }
        };
    }

    return {
        status: 'SURRENDER_REJECTED',
        narrative: aiResult.narrative || '對方殺氣騰騰，不接受你的認輸。'
    };
}

export async function finalizeCombat({ model }) {
    const profileId = getActiveProfileId();
    const pendingResult = await clientDB.state.get(profileId, 'pending_combat_result');
    if (!pendingResult) throw new Error('沒有待結算的戰鬥結果');

    const context = await buildContext(profileId);
    const aiResult = await aiProxy.generate('post-combat', model, {
        ...context,
        combatResult: pendingResult
    });

    const lastSave = await clientDB.saves.getLatest(profileId);
    const roundData = {
        ...(lastSave || {}),
        R: (lastSave?.R || 0) + 1,
        EVT: '戰鬥結束',
        story: aiResult.narrative || aiResult.story,
        playerState: aiResult.outcome?.playerState || 'alive',
        ...(aiResult.outcome || {})
    };

    const result = await applyAllChanges(profileId, roundData);
    await clientDB.state.delete(profileId, 'pending_combat_result');

    return {
        story: roundData.story,
        roundData: {
            ...roundData,
            inventory: result.inventory,
            bulkScore: result.bulkScore,
            skills: await clientDB.skills.list(profileId)
        },
        suggestion: aiResult.suggestion || '戰鬥已結束，先恢復一下。',
        locationData: context.locationContext,
        inventory: result.inventory
    };
}

// ── NPC 互動 ────────────────────────────────────────

export async function getNpcProfile(npcName) {
    const profileId = getActiveProfileId();
    const template = await clientDB.npcs.getTemplate(npcName);
    const state = await clientDB.npcs.getState(profileId, npcName);
    return {
        name: npcName,
        status_title: template?.status_title || state?.lastKnownStatus || '江湖人物',
        avatarUrl: template?.avatarUrl || null,
        ...(template || {}),
        friendlinessValue: state?.friendlinessValue ?? 0,
        romanceValue: state?.romanceValue ?? 0
    };
}

export async function npcChat({ npcName, chatHistory, playerMessage, model }) {
    const profileId = getActiveProfileId();
    const npcProfile = await getNpcProfile(npcName);
    const context = await buildLightContext(profileId);

    const aiResult = await aiProxy.generate('npc-chat', model, {
        ...context,
        npcProfile,
        chatHistory,
        playerMessage
    });

    // 處理好感度變動
    const parsed = typeof aiResult === 'string' ? JSON.parse(aiResult) : aiResult;
    if (parsed.friendlinessChange) {
        const state = await clientDB.npcs.getState(profileId, npcName);
        if (state) {
            await clientDB.npcs.setState(profileId, npcName, {
                ...state,
                friendlinessValue: clamp(toFiniteNumber(state.friendlinessValue) + toFiniteNumber(parsed.friendlinessChange), -100, 100)
            });
        }
    }

    // 處理物品變動
    if (parsed.itemChanges && Array.isArray(parsed.itemChanges)) {
        for (const change of parsed.itemChanges) {
            if (change.action === 'add') {
                await clientDB.inventory.add(profileId, {
                    itemName: change.itemName,
                    templateId: change.itemName,
                    quantity: change.quantity || 1,
                    itemType: '雜物',
                    bulk: '中'
                });
            }
        }
    }

    // 規範化回傳欄位，確保 UI 可讀取
    return {
        ...parsed,
        npcMessage: parsed.response || parsed.npcMessage || parsed.message || '',
        response: parsed.response || parsed.npcMessage || parsed.message || ''
    };
}

export async function endChat({ npcName, fullChatHistory, model }) {
    const profileId = getActiveProfileId();
    const context = await buildLightContext(profileId);

    const aiResult = await aiProxy.generate('npc-chat-summary', model, {
        ...context,
        npcName,
        fullChatHistory
    });

    const parsed = typeof aiResult === 'string' ? JSON.parse(aiResult) : aiResult;
    const lastSave = await clientDB.saves.getLatest(profileId);

    const roundData = {
        ...(lastSave || {}),
        R: (lastSave?.R || 0) + 1,
        EVT: parsed.evt || `與${npcName}的談話`,
        story: parsed.story || `你與${npcName}進行了一番交談。`,
        playerState: 'alive',
        powerChange: { internal: 0, external: 0, lightness: 0 },
        moralityChange: 0
    };

    const result = await applyAllChanges(profileId, roundData);
    return {
        story: roundData.story,
        roundData: {
            ...roundData,
            inventory: result.inventory,
            bulkScore: result.bulkScore,
            skills: await clientDB.skills.list(profileId)
        },
        suggestion: '繼續探索。',
        inventory: result.inventory
    };
}

export async function giveItemToNpc({ targetNpcName, itemName, amount, itemType, model }) {
    const profileId = getActiveProfileId();
    const npcProfile = await getNpcProfile(targetNpcName);
    const context = await buildLightContext(profileId);

    const aiResult = await aiProxy.generate('give-item', model, {
        ...context,
        npcProfile,
        itemInfo: { itemName, amount, itemType }
    });

    const parsed = typeof aiResult === 'string' ? JSON.parse(aiResult) : aiResult;

    // 移除玩家物品
    const items = await clientDB.inventory.list(profileId);
    const item = items.find(i => i.itemName === itemName);
    if (item) {
        if (toFiniteNumber(item.quantity) <= amount) {
            await clientDB.inventory.remove(profileId, item.instanceId);
        } else {
            await clientDB.inventory.update(profileId, item.instanceId, {
                quantity: toFiniteNumber(item.quantity) - amount
            });
        }
    }

    return parsed;
}

export async function startTrade(npcName) {
    const profileId = getActiveProfileId();
    const npcProfile = await getNpcProfile(npcName);
    const playerInventory = await clientDB.inventory.list(profileId);

    return {
        npcName,
        npcProfile,
        player: {
            items: playerInventory,
            money: getSilverAmount(playerInventory)
        },
        npc: {
            items: npcProfile.inventory || [],
            money: 100
        },
        npcInventory: npcProfile.inventory || [],
        playerInventory,
        playerMoney: getSilverAmount(playerInventory),
        npcMoney: 100
    };
}

export async function confirmTrade({ npcName, tradeDetails, model }) {
    const profileId = getActiveProfileId();
    const context = await buildLightContext(profileId);

    const aiResult = await aiProxy.generate('trade-summary', model, {
        ...context,
        npcName,
        tradeDetails
    });

    // 處理交易結果
    if (tradeDetails.playerOfferItems) {
        for (const item of tradeDetails.playerOfferItems) {
            const inv = await clientDB.inventory.list(profileId);
            const found = inv.find(i => i.instanceId === item.instanceId);
            if (found) await clientDB.inventory.remove(profileId, found.instanceId);
        }
    }

    if (tradeDetails.npcOfferItems) {
        for (const item of tradeDetails.npcOfferItems) {
            await clientDB.inventory.add(profileId, {
                itemName: item.itemName,
                templateId: item.itemName,
                quantity: item.quantity || 1,
                itemType: item.itemType || '雜物',
                bulk: item.bulk || '中'
            });
        }
    }

    const parsed = typeof aiResult === 'string' ? JSON.parse(aiResult) : aiResult;
    const lastSave = await clientDB.saves.getLatest(profileId);
    const roundData = {
        ...(lastSave || {}),
        R: (lastSave?.R || 0) + 1,
        EVT: parsed.evt || `與${npcName}的交易`,
        story: parsed.story || `你與${npcName}完成了一筆交易。`,
        playerState: 'alive'
    };

    const result = await applyAllChanges(profileId, roundData);
    return {
        story: roundData.story,
        roundData: { ...roundData, inventory: result.inventory, bulkScore: result.bulkScore },
        inventory: result.inventory
    };
}

// ── 其他操作 ────────────────────────────────────────

export async function forceSuicide({ model }) {
    const profileId = getActiveProfileId();
    const context = await buildLightContext(profileId);

    let story;
    try {
        const aiResult = await aiProxy.generate('death-cause', model, context);
        story = typeof aiResult === 'string' ? aiResult : aiResult?.story || '你在混亂與寂靜之間做出了終局的選擇，江湖傳奇在此刻落幕。';
    } catch {
        story = '你在混亂與寂靜之間做出了終局的選擇，江湖傳奇在此刻落幕。';
    }

    const lastSave = await clientDB.saves.getLatest(profileId);
    const roundData = {
        ...(lastSave || {}),
        R: (lastSave?.R || 0) + 1,
        EVT: '英雄末路',
        story,
        playerState: 'dead',
        powerChange: { internal: 0, external: 0, lightness: 0 },
        moralityChange: 0
    };

    await applyAllChanges(profileId, roundData);
    return {
        story,
        roundData,
        suggestion: '重新開始一段新的江湖人生。'
    };
}

export async function getEpilogue() {
    const profileId = getActiveProfileId();
    const context = await buildContext(profileId);
    const lastSave = await clientDB.saves.getLatest(profileId);
    const npcStates = await clientDB.npcs.listStates(profileId);

    const aiResult = await aiProxy.generate('epilogue', null, {
        ...context,
        playerData: {
            username: context.player.username,
            gender: context.player.gender,
            finalStats: context.player,
            finalRelationships: npcStates,
            deathInfo: { cause: lastSave?.EVT || '不明', round: lastSave?.R },
            inventory: context.player.inventory
        },
        lastRoundData: lastSave
    });
    return { epilogue: typeof aiResult === 'string' ? aiResult : aiResult?.epilogue || '傳奇落幕。' };
}

export async function getEncyclopedia() {
    const profileId = getActiveProfileId();
    const context = await buildLightContext(profileId);
    const npcStates = await clientDB.npcs.listStates(profileId);
    const npcDetails = [];
    for (const state of npcStates) {
        const tpl = await clientDB.npcs.getTemplate(state.npcName);
        npcDetails.push({ ...(tpl || {}), ...state });
    }

    return aiProxy.generate('encyclopedia', null, {
        ...context,
        npcDetails
    });
}

export async function getSkills() {
    const profileId = getActiveProfileId();
    return clientDB.skills.list(profileId);
}

export async function getInventory() {
    const profileId = getActiveProfileId();
    return clientDB.inventory.list(profileId);
}

export async function dropItem({ itemId }) {
    const profileId = getActiveProfileId();
    const item = await clientDB.inventory.get(profileId, itemId);
    if (!item) return { success: false, message: '找不到物品。' };

    if (toFiniteNumber(item.quantity) > 1) {
        await clientDB.inventory.update(profileId, itemId, {
            quantity: toFiniteNumber(item.quantity) - 1
        });
    } else {
        await clientDB.inventory.remove(profileId, itemId);
    }

    const inv = await clientDB.inventory.list(profileId);
    return {
        success: true,
        message: `已丟棄 ${item.itemName || '物品'}。`,
        inventory: inv,
        bulkScore: calculateBulkScore(inv)
    };
}

export async function equipItem(instanceId) {
    const profileId = getActiveProfileId();
    await clientDB.inventory.equip(profileId, instanceId);
    const inv = await clientDB.inventory.list(profileId);
    return { success: true, message: '已裝備', inventory: inv, bulkScore: calculateBulkScore(inv) };
}

export async function unequipItem(instanceId) {
    const profileId = getActiveProfileId();
    await clientDB.inventory.unequip(profileId, instanceId);
    const inv = await clientDB.inventory.list(profileId);
    return { success: true, message: '已卸下', inventory: inv, bulkScore: calculateBulkScore(inv) };
}

export async function forgetSkill({ skillName, model }) {
    const profileId = getActiveProfileId();
    if (skillName === '現代搏擊') throw new Error('無法遺忘基礎技能。');

    await clientDB.skills.remove(profileId, skillName);

    let story;
    try {
        const context = await buildLightContext(profileId);
        const aiResult = await aiProxy.generate('forget-skill', model, { ...context, skillName });
        story = typeof aiResult === 'string' ? aiResult : '你逆運內力，關於此武學的感悟已蕩然無存。';
    } catch {
        story = '你逆運內力，關於此武學的感悟已蕩然無存。';
    }

    return { success: true, story };
}

export async function getRelations() {
    const profileId = getActiveProfileId();
    const profile = await clientDB.profiles.get(profileId);
    const lastSave = await clientDB.saves.getLatest(profileId);
    const npcStates = await clientDB.npcs.listStates(profileId);

    const nodes = [{
        id: 'player', kind: 'player', name: profile.username, label: profile.username, statusTitle: '主角'
    }];

    const edges = [];
    const relationTypes = [
        { key: 'family', label: '親人', color: '#d97706' },
        { key: 'romance', label: '情感', color: '#db2777' },
        { key: 'faction', label: '門派', color: '#2563eb' },
        { key: 'friend', label: '朋友', color: '#16a34a' },
        { key: 'enemy', label: '敵對', color: '#dc2626' },
        { key: 'acquaintance', label: '熟識', color: '#0f766e' },
        { key: 'unfamiliar', label: '不熟', color: '#64748b' }
    ];

    for (const npcState of npcStates) {
        const tpl = await clientDB.npcs.getTemplate(npcState.npcName);
        const friendLevel = getFriendlinessLevel(npcState.friendlinessValue);
        let relType = 'acquaintance';
        if (['hostile', 'sworn_enemy'].includes(friendLevel)) relType = 'enemy';
        else if (['friendly', 'trusted', 'devoted'].includes(friendLevel)) relType = 'friend';
        else if (friendLevel === 'neutral') relType = 'unfamiliar';

        const inScene = lastSave?.NPC?.some(n => n.name === npcState.npcName) || false;

        nodes.push({
            id: `npc:${npcState.npcName}`,
            kind: 'npc',
            name: npcState.npcName,
            label: npcState.npcName,
            statusTitle: tpl?.status_title || '江湖人物',
            friendlinessValue: npcState.friendlinessValue || 0,
            romanceValue: npcState.romanceValue || 0,
            inCurrentScene: inScene,
            degree: 0
        });

        edges.push({
            source: 'player',
            target: `npc:${npcState.npcName}`,
            type: relType,
            label: relationTypes.find(t => t.key === relType)?.label || '熟識',
            directed: false,
            strength: Math.abs(npcState.friendlinessValue || 0)
        });
    }

    return {
        graph: {
            version: 2,
            cacheKey: `rel-${lastSave?.R || 0}-${nodes.length}`,
            centerNodeId: 'player',
            generatedAt: new Date().toISOString(),
            relationTypes,
            nodes,
            edges,
            meta: {
                latestRound: lastSave?.R || 0,
                nodeCount: nodes.length,
                edgeCount: edges.length,
                source: 'client-indexeddb'
            }
        },
        mermaidSyntax: null
    };
}

export async function getNovel() {
    const profileId = getActiveProfileId();
    const chapters = await clientDB.novel.getAll(profileId);
    return chapters.map(ch => ch.story || '').join('\n\n---\n\n');
}

export async function getMap() {
    const profileId = getActiveProfileId();
    const lastSave = await clientDB.saves.getLatest(profileId);
    const locStates = await clientDB.locations.listStates(profileId);

    const hierarchy = normalizeLocationHierarchy(lastSave?.LOC || []);
    const discoveredNames = new Set([...hierarchy, ...locStates.map(l => l.locationName)]);
    const allNames = Array.from(discoveredNames);
    const idMap = new Map(allNames.map((name, i) => [name, `loc${i}`]));

    const escapeNode = (v) => String(v || '').replace(/[\[\]"|]/g, '');

    const buildSyntax = (dir, edges) => {
        let s = `graph ${dir};\n`;
        for (const name of allNames) s += `    ${idMap.get(name)}["${escapeNode(name)}"];\n`;
        for (const name of allNames) {
            const style = hierarchy.includes(name)
                ? 'fill:#f5f1ea,stroke:#8c6f54,stroke-width:2px,color:#3a2d21'
                : 'fill:#eef2f6,stroke:#8a97a6,stroke-width:1px,color:#4c5560';
            s += `    style ${idMap.get(name)} ${style};\n`;
        }
        for (const e of edges) {
            const src = idMap.get(e.source);
            const tgt = idMap.get(e.target);
            if (src && tgt) s += `    ${src} -->|"${e.label}"| ${tgt};\n`;
        }
        return s;
    };

    const hEdges = [];
    for (let i = 0; i < hierarchy.length - 1; i++) {
        hEdges.push({ source: hierarchy[i], target: hierarchy[i + 1], label: '所屬' });
    }

    const nodes = allNames.map(n => ({ name: n, label: n, discovered: hierarchy.includes(n) }));
    const syntax = buildSyntax('TD', hEdges);

    return {
        mapVersion: 2,
        defaultView: 'hierarchy',
        mermaidSyntax: syntax,
        views: {
            hierarchy: { title: '階層圖', mermaidSyntax: syntax, nodes, edges: hEdges }
        },
        meta: { discoveredCount: hierarchy.length, renderedNodeCount: allNames.length }
    };
}

export async function getBounties() {
    const profileId = getActiveProfileId();
    const all = await clientDB.bounties.list(profileId);
    // 標記為已讀
    for (const b of all) {
        if (!b.isRead) {
            await clientDB.bounties.update(profileId, b.bountyId, { isRead: true });
        }
    }
    return all;
}

export async function startNewGame() {
    const profileId = getActiveProfileId();
    await clientDB.resetProfile(profileId);
    const profile = await clientDB.profiles.get(profileId);
    return createNewGame(profile.username, profile.gender);
}

export async function generateNpcAvatar(npcName) {
    const tpl = await clientDB.npcs.getTemplate(npcName);
    if (tpl?.avatarUrl) return { success: true, avatarUrl: tpl.avatarUrl };

    const result = await aiProxy.generateImage(
        `Japanese anime style portrait, cel shading, ${npcName}, wuxia character, martial arts setting`
    );
    const avatarUrl = result.imageBase64
        ? `data:image/png;base64,${result.imageBase64}`
        : result.imageUrl || null;
    if (avatarUrl) {
        if (tpl) await clientDB.npcs.setTemplate(npcName, { ...tpl, avatarUrl });
        return { success: true, avatarUrl };
    }
    return { success: false };
}

// ── 工具函式 ────────────────────────────────────────

function getSilverAmount(inventory) {
    if (!Array.isArray(inventory)) return 0;
    const silver = inventory.find(item => isCurrencyLikeItem(item));
    return silver ? toFiniteNumber(silver.quantity) : 0;
}
