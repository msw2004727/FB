// client/engine/gameEngine.js
// 遊戲引擎 — 精簡版（僅保留使用中的功能）

import clientDB from '../db/clientDB.js';
import aiProxy from '../ai/aiProxy.js';
import { buildContext, buildLightContext } from './contextBuilder.js';
import { applyAllChanges } from './stateManager.js';
import { clamp, toFiniteNumber } from '../utils/gameUtils.js';
import { getScenario } from '../scenarios/scenarios.js';

function getNextMilestoneId(achieved, scenario = 'wuxia') {
    const scenarioConfig = getScenario(scenario);
    for (const id of scenarioConfig.milestoneIds) {
        if (!achieved.includes(id)) return id;
    }
    return null;
}

// ── 當前活躍檔案 ────────────────────────────────────

let _activeProfileId = null;

export function setActiveProfile(profileId) { _activeProfileId = profileId; }
export function getActiveProfileId() { return _activeProfileId; }

// ── 遊戲初始化 ──────────────────────────────────────

export async function createNewGame(username, gender, scenario = 'wuxia') {
    await clientDB.init();
    const scenarioConfig = getScenario(scenario);
    const profileData = { username, gender, scenario, ...scenarioConfig.defaultProfile };
    const profile = await clientDB.profiles.create(profileData);
    const profileId = profile.id;

    const initialRound = scenarioConfig.getInitialRound(username);

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

    let lastSave = await clientDB.saves.getLatest(profileId);
    if (!lastSave) {
        // 沒有存檔 — 自動建立 R0
        console.warn('[GameEngine] 找不到存檔，自動建立初始回合');
        await startNewGame();
        lastSave = await clientDB.saves.getLatest(profileId);
        if (!lastSave) throw new Error('找不到存檔資料。');
    }

    const milestonesData = await clientDB.state.get(profileId, 'milestones');

    const roundData = {
        ...lastSave,
        morality: profile.morality,
        suggestion: lastSave.suggestion || '先觀察場面，再採取行動。',
        milestonesCount: (milestonesData || []).length
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

export async function interact({ action, model, optionMorality = 0 }) {
    const profileId = getActiveProfileId();
    const context = await buildContext(profileId);

    // 讀取已達成的里程碑
    const milestonesData = await clientDB.state.get(profileId, 'milestones');
    const achievedMilestones = milestonesData || [];
    const cluesSummary = await clientDB.state.get(profileId, 'clues_summary') || '';

    const aiResult = await aiProxy.generate('story', model, {
        ...context,
        playerAction: action,
        blackShadowEvent: Math.random() < 0.1,
        achievedMilestones,
        cluesSummary
    });

    if (!aiResult || !aiResult.roundData) {
        throw new Error('AI 回應缺少 roundData');
    }

    const roundData = aiResult.roundData;
    roundData.R = (context.player.R || 0) + 1;
    roundData.story = aiResult.story || roundData.story;

    // 將選項的預設善惡值加到 AI 判定的 moralityChange 上
    roundData.moralityChange = (roundData.moralityChange || 0) + optionMorality;

    // 處理里程碑評估結果
    if (roundData.progressEval && roundData.progressEval.triggered) {
        const nextMilestoneId = getNextMilestoneId(achievedMilestones, context.player?.scenario);
        if (nextMilestoneId) {
            achievedMilestones.push(nextMilestoneId);
            await clientDB.state.set(profileId, 'milestones', achievedMilestones);
        }
    }
    // 更新線索摘要
    if (roundData.questJournal) {
        await clientDB.state.set(profileId, 'clues_summary',
            cluesSummary ? cluesSummary + '\n' + roundData.questJournal : roundData.questJournal
        );
    }

    const result = await applyAllChanges(profileId, roundData);

    // Phase 0b: 接回摘要寫入管線（fire-and-forget，不阻塞玩家）
    (async () => {
        try {
            const oldSummary = await clientDB.state.get(profileId, 'summary');
            const oldText = typeof oldSummary === 'string' ? oldSummary : (oldSummary?.text || '遊戲剛剛開始...');
            const summaryResult = await aiProxy.generate('summary', null, {
                oldSummary: oldText,
                newRoundData: roundData
            });
            if (summaryResult && typeof summaryResult === 'object' && summaryResult.summary) {
                await clientDB.state.set(profileId, 'summary', summaryResult.summary);
            } else if (typeof summaryResult === 'string') {
                await clientDB.state.set(profileId, 'summary', summaryResult);
            }
        } catch (e) {
            console.warn('[Summary] 摘要更新失敗（非阻塞）:', e.message);
        }
    })();

    return {
        story: roundData.story,
        roundData: {
            ...roundData,
            ...result.profile,
            milestonesCount: achievedMilestones.length
        },
        suggestion: aiResult.suggestion || roundData.suggestion || '繼續探索。',
        locationData: context.locationContext
    };
}

// ── 自殺 ────────────────────────────────────────────

export async function forceSuicide({ model }) {
    const profileId = getActiveProfileId();
    const context = await buildLightContext(profileId);

    const profile = await clientDB.profiles.get(profileId);
    const scenarioConfig = getScenario(profile?.scenario);

    let story;
    try {
        const aiResult = await aiProxy.generate('death-cause', model, context);
        story = typeof aiResult === 'string' ? aiResult : aiResult?.story || scenarioConfig.deathFallbackStory;
    } catch {
        story = scenarioConfig.deathFallbackStory;
    }

    const lastSave = await clientDB.saves.getLatest(profileId);
    const roundData = {
        ...(lastSave || {}),
        R: (lastSave?.R || 0) + 1,
        EVT: '終局',
        story,
        playerState: 'dead',
        moralityChange: 0
    };

    await applyAllChanges(profileId, roundData);
    return { story, roundData, suggestion: scenarioConfig.restartSuggestion };
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

export async function startNewGame(scenario) {
    const profileId = getActiveProfileId();
    const profile = await clientDB.profiles.get(profileId);
    const effectiveScenario = scenario || profile.scenario || 'wuxia';
    const scenarioConfig = getScenario(effectiveScenario);

    // 重置所有遊戲資料
    await clientDB.resetProfile(profileId);

    // 更新 scenario 到 profile
    await clientDB.profiles.update(profileId, { scenario: effectiveScenario, ...scenarioConfig.defaultProfile });

    // 寫入劇本對應的 R0 存檔
    const initialRound = scenarioConfig.getInitialRound(profile.username);
    await clientDB.saves.add(profileId, initialRound);

    const verify = await clientDB.saves.getLatest(profileId);
    if (!verify) {
        await clientDB.saves.add(profileId, initialRound);
    }

    return { profile: await clientDB.profiles.get(profileId), roundData: initialRound };
}

// ── 改名 ────────────────────────────────────────────

export async function renamePlayer(newName) {
    const profileId = getActiveProfileId();
    if (!profileId) throw new Error('沒有活躍檔案');
    const trimmed = (newName || '').trim();
    if (!trimmed || trimmed.length > 8) throw new Error('名字須為 1-8 個字');
    await clientDB.profiles.update(profileId, { username: trimmed });
    localStorage.setItem('username', trimmed);
    return trimmed;
}
