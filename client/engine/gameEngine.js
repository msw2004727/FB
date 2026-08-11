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
const _localOperationQueues = new Map();
const _summaryQueues = new Map();
const KNOWN_MODELS = new Set(['minimax', 'openai', 'deepseek', 'grok', 'gemini', 'gemma', 'claude']);

function normalizeModelSelection(model) {
    const normalized = String(model || 'minimax').trim().toLowerCase();
    return KNOWN_MODELS.has(normalized) ? normalized : 'minimax';
}

export function setActiveProfile(profileId) { _activeProfileId = profileId; }
export function getActiveProfileId() { return _activeProfileId; }

async function withOperationLock(lockName, operation) {
    if (globalThis.navigator?.locks?.request) {
        return navigator.locks.request(lockName, { mode: 'exclusive' }, operation);
    }

    // Same-tab fallback for older browsers. IndexedDB commitRound remains the
    // final conflict guard across tabs that do not support Web Locks.
    const previous = _localOperationQueues.get(lockName) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    _localOperationQueues.set(lockName, current);
    try {
        return await current;
    } finally {
        if (_localOperationQueues.get(lockName) === current) _localOperationQueues.delete(lockName);
    }
}

function parseSummaryRecord(value) {
    if (typeof value === 'string') return { text: value, revision: 0, lastRound: 0 };
    if (value && typeof value === 'object') {
        return {
            text: String(value.text || value.summary || '遊戲剛剛開始...'),
            revision: Number.isInteger(value.revision) ? value.revision : 0,
            lastRound: Number.isInteger(value.lastRound) ? value.lastRound : 0,
        };
    }
    return { text: '遊戲剛剛開始...', revision: 0, lastRound: 0 };
}

export function shouldRefreshSummary(roundData) {
    if (roundData?.playerState === 'dead') return false;
    const round = Number(roundData?.R) || 0;
    return round > 0 && (
        round % 5 === 0
        || roundData?.summaryTrigger === true
        || roundData?.progressEval?.triggered === true
        || roundData?.worldEvent != null
        || roundData?.hasNewNpc === true
    );
}

async function refreshSummary(profileId, targetRound, model) {
    return withOperationLock(`wenjiang-summary:${profileId}`, async () => {
        const storedSummary = parseSummaryRecord(await clientDB.state.get(profileId, 'summary'));
        if (storedSummary.lastRound >= targetRound) return;

        const allSaves = await clientDB.saves.getAll(profileId);
        const unsummarizedRounds = allSaves.filter(save => {
            const round = Number(save.R) || 0;
            return round > storedSummary.lastRound && round <= targetRound;
        });
        if (unsummarizedRounds.length === 0) return;

        const expectedRevision = storedSummary.revision;
        const requestedRevision = expectedRevision + 1;
        const summaryResult = await aiProxy.generate('summary', model || null, {
            oldSummary: storedSummary.text,
            newRoundData: {
                fromRound: Number(unsummarizedRounds[0].R) || 0,
                toRound: Number(unsummarizedRounds[unsummarizedRounds.length - 1].R) || targetRound,
                rounds: unsummarizedRounds,
            },
            revision: requestedRevision,
        }, { stream: false, timeoutMs: 25_000 });

        const summaryText = typeof summaryResult === 'string'
            ? summaryResult
            : summaryResult?.summary;
        if (!summaryText) return;

        // Revision check prevents an older request (or another tab) from
        // overwriting a newer summary.
        const latestSummary = parseSummaryRecord(await clientDB.state.get(profileId, 'summary'));
        if (latestSummary.revision !== expectedRevision || latestSummary.lastRound > storedSummary.lastRound) {
            console.warn('[Summary] 偵測到較新的摘要，放棄舊回應');
            return;
        }
        await clientDB.state.set(profileId, 'summary', {
            text: String(summaryText).slice(0, 2000),
            revision: requestedRevision,
            lastRound: targetRound,
            updatedAt: new Date().toISOString(),
        });
    });
}

function scheduleSummaryRefresh(profileId, roundData, model) {
    if (!shouldRefreshSummary(roundData)) return;
    const previous = _summaryQueues.get(profileId) || Promise.resolve();
    const queued = previous
        .catch(() => {})
        .then(() => refreshSummary(profileId, Number(roundData.R) || 0, model))
        .catch(error => console.warn('[Summary] 摘要更新失敗（非阻塞）:', error.message));
    _summaryQueues.set(profileId, queued);
    queued.finally(() => {
        if (_summaryQueues.get(profileId) === queued) _summaryQueues.delete(profileId);
    });
}

// ── 遊戲初始化 ──────────────────────────────────────

export async function createNewGame(username, gender, scenario = 'wuxia') {
    await clientDB.init();
    const scenarioConfig = getScenario(scenario);
    const profileData = { username, gender, scenario, ...scenarioConfig.defaultProfile };
    const profile = await clientDB.profiles.create(profileData);
    const profileId = profile.id;

    const initialRound = scenarioConfig.getInitialRound(username, profileData?.gender || gender || 'male');

    await clientDB.saves.add(profileId, initialRound);
    setActiveProfile(profileId);
    return { profile, roundData: initialRound };
}

// ── 遊戲載入 ────────────────────────────────────────

export async function getLatestGame() {
    const profileId = getActiveProfileId();
    let { profile, lastSave } = await clientDB.getProfileAndLatestSave(profileId);
    if (!profile) throw new Error(`找不到玩家檔案: ${profileId}`);

    // The snapshot is transaction-consistent. The save-level check is also a
    // defense against older/imported profiles whose isDeceased flag is stale.
    if (profile.isDeceased || lastSave?.playerState === 'dead') {
        return { gameState: 'deceased', roundData: lastSave, locationData: null };
    }

    if (!lastSave) {
        // 沒有存檔 — 自動建立 R0
        console.warn('[GameEngine] 找不到存檔，自動建立初始回合');
        await startNewGame();
        ({ profile, lastSave } = await clientDB.getProfileAndLatestSave(profileId));
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

export async function interact({ action, model, optionMorality = 0, onStoryDelta = null }) {
    const profileId = getActiveProfileId();
    if (!profileId) throw new Error('沒有活躍檔案');

    // The lock covers context read, paid AI request, and atomic commit. A second
    // tab therefore waits and rebuilds fresh context instead of paying for the
    // same round twice.
    return withOperationLock(`wenjiang-interact:${profileId}`, async () => {
        const currentProfile = await clientDB.profiles.get(profileId);
        if (currentProfile?.isDeceased) {
            const error = new Error('這段旅程已經結束，請先重新開始。');
            error.code = 'GAME_ALREADY_ENDED';
            throw error;
        }
        const context = await buildContext(profileId);

        const milestonesData = await clientDB.state.get(profileId, 'milestones');
        const achievedMilestones = Array.isArray(milestonesData) ? [...milestonesData] : [];
        const cluesSummary = await clientDB.state.get(profileId, 'clues_summary') || '';

        const aiResult = await aiProxy.generate('story', model, {
            ...context,
            playerAction: action,
            blackShadowEvent: Math.random() < 0.1,
            achievedMilestones,
            cluesSummary,
        }, {
            stream: true,
            onStoryDelta,
            timeoutMs: 45_000,
        });

        if (!aiResult || !aiResult.roundData) throw new Error('AI 回應缺少 roundData');

        const roundData = aiResult.roundData;
        roundData.R = (context.player.R || 0) + 1;
        roundData.story = aiResult.story || roundData.story;
        roundData.moralityChange = (Number(roundData.moralityChange) || 0) + (Number(optionMorality) || 0);
        const knownNpcNames = new Set(Array.isArray(context.actorCandidates) ? context.actorCandidates : []);
        if (Array.isArray(roundData.NPC)) {
            for (const npc of roundData.NPC) {
                if (!npc || typeof npc !== 'object') continue;
                const name = typeof npc.name === 'string' ? npc.name.trim() : '';
                npc.isNew = Boolean(name) && !knownNpcNames.has(name);
            }
            roundData.hasNewNpc = roundData.NPC.some(npc => npc?.isNew === true);
        } else {
            roundData.NPC = [];
            roundData.hasNewNpc = false;
        }
        if (roundData.playerState === 'dead') {
            roundData.epilogueModel = normalizeModelSelection(model);
        }

        const stateUpdates = {};
        if (roundData.progressEval?.triggered) {
            const nextMilestoneId = getNextMilestoneId(achievedMilestones, context.player?.scenario);
            if (nextMilestoneId) {
                achievedMilestones.push(nextMilestoneId);
                stateUpdates.milestones = achievedMilestones;
            }
            if (roundData.questJournal) {
                const nextClues = cluesSummary
                    ? `${cluesSummary}\n${roundData.questJournal}`
                    : roundData.questJournal;
                stateUpdates.clues_summary = nextClues.slice(-4000);
            }
        }

        const result = await applyAllChanges(profileId, roundData, stateUpdates);
        scheduleSummaryRefresh(profileId, roundData, model);

        return {
            story: roundData.story,
            roundData: {
                ...roundData,
                ...result.profile,
                milestonesCount: achievedMilestones.length,
            },
            suggestion: aiResult.suggestion || roundData.suggestion || '繼續探索。',
            locationData: context.locationContext,
        };
    });
}

// ── 自殺 ────────────────────────────────────────────

export async function forceSuicide({ model }) {
    const profileId = getActiveProfileId();
    if (!profileId) throw new Error('沒有活躍檔案');

    // Share the paid-turn lock with interact/restart. A second tab waits and
    // sees the committed death state instead of paying for a duplicate call.
    return withOperationLock(`wenjiang-interact:${profileId}`, async () => {
        const context = await buildLightContext(profileId);
        const profile = await clientDB.profiles.get(profileId);
        const scenarioConfig = getScenario(profile?.scenario);
        if (profile?.isDeceased) {
            const existing = await clientDB.saves.getLatest(profileId);
            return {
                story: existing?.story || scenarioConfig.deathFallbackStory,
                roundData: existing,
                suggestion: scenarioConfig.restartSuggestion,
            };
        }

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
            moralityChange: 0,
            epilogueModel: normalizeModelSelection(model),
        };

        await applyAllChanges(profileId, roundData);
        return { story, roundData, suggestion: scenarioConfig.restartSuggestion };
    });
}

// ── 結局 ────────────────────────────────────────────

export async function getEpilogue(model = null) {
    const profileId = getActiveProfileId();
    if (!profileId) throw new Error('沒有活躍檔案');

    return withOperationLock(`wenjiang-interact:${profileId}`, () =>
        withOperationLock(`wenjiang-epilogue:${profileId}`, async () => {
            const [profile, lastSave] = await Promise.all([
                clientDB.profiles.get(profileId),
                clientDB.saves.getLatest(profileId),
            ]);
            if (!profile?.isDeceased || lastSave?.playerState !== 'dead') {
                throw new Error('只有旅程結束後才能生成結局。');
            }

            const cached = await clientDB.state.get(profileId, 'epilogue');
            if (cached?.deathRound === lastSave.R && typeof cached.text === 'string' && cached.text) {
                return { epilogue: cached.text, cached: true, model: cached.model || 'minimax' };
            }

            const modelToUse = normalizeModelSelection(model || lastSave.epilogueModel);
            const context = await buildContext(profileId);
            const aiResult = await aiProxy.generate('epilogue', modelToUse, {
                ...context,
                playerData: {
                    username: context.player.username,
                    gender: context.player.gender,
                    finalStats: context.player,
                    deathInfo: { cause: lastSave.EVT || '不明', round: lastSave.R }
                },
                lastRoundData: lastSave
            }, { stream: false, timeoutMs: 25_000 });
            const text = typeof aiResult === 'string' ? aiResult : aiResult?.epilogue || '傳奇落幕。';

            // The interact lock prevents restart in modern browsers; this final
            // check also avoids stale writes if a legacy browser resets mid-call.
            const [latestProfile, latestSave] = await Promise.all([
                clientDB.profiles.get(profileId),
                clientDB.saves.getLatest(profileId),
            ]);
            if (!latestProfile?.isDeceased || latestSave?.R !== lastSave.R || latestSave?.playerState !== 'dead') {
                throw new Error('旅程狀態已變更，放棄舊結局回應。');
            }
            await clientDB.state.set(profileId, 'epilogue', {
                text: String(text).slice(0, 6000),
                deathRound: lastSave.R,
                model: modelToUse,
                createdAt: new Date().toISOString(),
            });
            return { epilogue: String(text).slice(0, 6000), cached: false, model: modelToUse };
        })
    );
}

// ── 重新開始 ────────────────────────────────────────

export async function startNewGame(scenario) {
    const profileId = getActiveProfileId();
    if (!profileId) throw new Error('沒有活躍檔案');

    // A reset must not race with a paid turn or a late summary write. The same
    // lock order (interaction, then summary) is used consistently here.
    return withOperationLock(`wenjiang-interact:${profileId}`, () =>
        withOperationLock(`wenjiang-epilogue:${profileId}`, () =>
            withOperationLock(`wenjiang-summary:${profileId}`, async () => {
            const profile = await clientDB.profiles.get(profileId);
            const effectiveScenario = scenario || profile.scenario || 'wuxia';
            const scenarioConfig = getScenario(effectiveScenario);

            const initialRound = scenarioConfig.getInitialRound(profile.username, profile.gender || 'male');
            const resetProfile = await clientDB.resetProfile(profileId, {
                profileUpdates: {
                    scenario: effectiveScenario,
                    ...scenarioConfig.defaultProfile,
                },
                initialRound,
            });

            return { profile: resetProfile, roundData: initialRound };
            })
        )
    );
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
