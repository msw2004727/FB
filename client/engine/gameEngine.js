// client/engine/gameEngine.js
// 遊戲引擎 — 精簡版（僅保留使用中的功能）

import clientDB from '../db/clientDB.js';
import aiProxy from '../ai/aiProxy.js';
import { buildContext, buildLightContext } from './contextBuilder.js';
import { applyAllChanges } from './stateManager.js';
import { clamp, toFiniteNumber } from '../utils/gameUtils.js';

// ── 當前活躍檔案 ────────────────────────────────────

let _activeProfileId = null;

export function setActiveProfile(profileId) { _activeProfileId = profileId; }
export function getActiveProfileId() { return _activeProfileId; }

// ── 遊戲初始化 ──────────────────────────────────────

export async function createNewGame(username, gender) {
    await clientDB.init();
    const profile = await clientDB.profiles.create({ username, gender });
    const profileId = profile.id;

    const initialRound = {
        R: 0,
        EVT: '初入江湖',
        story: `${username}踏上了充滿未知的江湖之路。眼前是一片陌生的景象，遠方傳來隱約的市集喧嘩聲。`,
        WRD: '晴',
        LOC: ['梁國', '東境', '臨川', '無名村'],
        PC: `${username}初來乍到，警惕而好奇。`,
        NPC: [],
        timeOfDay: '上午',
        morality: 0,
        yearName: '元祐', year: 1, month: 1, day: 1,
        playerState: 'alive',
        moralityChange: 0,
        suggestion: '先四處探索，了解周遭環境。'
    };

    await clientDB.saves.add(profileId, initialRound);
    setActiveProfile(profileId);
    return { profile, roundData: initialRound };
}

// ── 遊戲載入 ────────────────────────────────────────

export async function getLatestGame() {
    const profileId = getActiveProfileId();
    const profile = await clientDB.profiles.get(profileId);

    if (profile.isDeceased) {
        const lastSave = await clientDB.saves.getLatest(profileId);
        return { gameState: 'deceased', roundData: lastSave, locationData: null };
    }

    const lastSave = await clientDB.saves.getLatest(profileId);
    if (!lastSave) throw new Error('找不到存檔資料。');

    const roundData = {
        ...lastSave,
        morality: profile.morality,
        suggestion: lastSave.suggestion || '先觀察場面，再採取行動。'
    };

    let locationData = null;
    if (lastSave.LOC) {
        const locName = Array.isArray(lastSave.LOC) ? lastSave.LOC[lastSave.LOC.length - 1] : lastSave.LOC;
        locationData = await clientDB.locations.getTemplate(locName) || null;
    }

    return {
        gameState: 'alive',
        story: lastSave.story,
        roundData,
        suggestion: roundData.suggestion,
        locationData
    };
}

// ── 玩家行動 ────────────────────────────────────────

export async function interact({ action, model }) {
    const profileId = getActiveProfileId();
    const context = await buildContext(profileId);

    const aiResult = await aiProxy.generate('story', model, {
        ...context,
        playerAction: action,
        actorCandidates: [],
        blackShadowEvent: Math.random() < 0.1
    });

    if (!aiResult || !aiResult.roundData) {
        throw new Error('AI 回應缺少 roundData');
    }

    const roundData = aiResult.roundData;
    roundData.R = (context.player.R || 0) + 1;
    roundData.story = aiResult.story || roundData.story;

    const result = await applyAllChanges(profileId, roundData);

    return {
        story: roundData.story,
        roundData: {
            ...roundData,
            ...result.profile
        },
        suggestion: aiResult.suggestion || roundData.suggestion || '繼續探索。',
        locationData: context.locationContext
    };
}

// ── 自殺 ────────────────────────────────────────────

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
        moralityChange: 0
    };

    await applyAllChanges(profileId, roundData);
    return { story, roundData, suggestion: '重新開始一段新的江湖人生。' };
}

// ── 結局 ────────────────────────────────────────────

export async function getEpilogue() {
    const profileId = getActiveProfileId();
    const context = await buildContext(profileId);
    const lastSave = await clientDB.saves.getLatest(profileId);

    const aiResult = await aiProxy.generate('epilogue', null, {
        ...context,
        playerData: {
            username: context.player.username,
            gender: context.player.gender,
            finalStats: context.player,
            deathInfo: { cause: lastSave?.EVT || '不明', round: lastSave?.R }
        },
        lastRoundData: lastSave
    });
    return { epilogue: typeof aiResult === 'string' ? aiResult : aiResult?.epilogue || '傳奇落幕。' };
}

// ── 重新開始 ────────────────────────────────────────

export async function startNewGame() {
    const profileId = getActiveProfileId();
    await clientDB.resetProfile(profileId);
    const profile = await clientDB.profiles.get(profileId);
    return createNewGame(profile.username, profile.gender);
}
