// ai-proxy/routes/aiRoutes.js
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const rateLimit = require('../middleware/rateLimit');

// Apply rate limiting to all /ai routes
router.use(rateLimit(30, 60 * 1000));

// --- Load core AI services ---
const aiService = require('../services/aiService');
const { getAIGeneratedImage, parseJsonResponse } = aiService;
const { aiConfig } = require('../aiConfig');

const defaultAIProvider = Object.freeze({
    callAI: aiService.callAI,
    streamAI: aiService.streamAI,
});
let aiProvider = defaultAIProvider;

// =============================================================================
// TASK HANDLERS
// Each handler receives ctx (the context object from the client) and returns:
//   { prompt: string, json: boolean, configKey: string }
// where configKey is the key in aiConfig that holds the default model for this task.
// =============================================================================

const TASK_HANDLERS = {

    // -------------------------------------------------------------------------
    // Core Story & Narrative
    // -------------------------------------------------------------------------

    'story': (ctx) => {
        const { getStoryPrompt } = require('../prompts/storyPrompt');
        const player = ctx.player || ctx.userProfile || {};
        let prompt = getStoryPrompt(
            ctx.longTermSummary,
            ctx.recentHistory,
            ctx.playerAction,
            player,
            player.username || ctx.username,
            player.currentTimeOfDay || ctx.currentTimeOfDay,
            player.power || ctx.playerPower,
            player.morality ?? ctx.playerMorality,
            ctx.levelUpEvents,
            ctx.romanceEventToWeave,
            ctx.worldEventToWeave,
            ctx.locationContext,
            ctx.npcContext,
            ctx.bulkScore ?? ctx.playerBulkScore,
            ctx.actorCandidates,
            ctx.blackShadowEvent
        );
        // 注入里程碑進度與同回合嚴格判定條件。story、options、progress
        // 必須在這一次模型請求中一起完成。
        const achieved = ctx.achievedMilestones || [];
        const clues = ctx.cluesSummary || '';
        const { getScenario: getScn } = require('../scenarios/index.js');
        const scn = getScn(player.scenario);
        const mTitle = scn.milestoneDisplay.title;
        const nextMilestone = scn.MILESTONES.find(item => !achieved.includes(item.id));
        const nextInstruction = nextMilestone
            ? `下一個可判定里程碑：${nextMilestone.id}「${nextMilestone.name}」\n` +
              `嚴格觸發條件：${nextMilestone.trigger}\n` +
              '只有本回合 story 文字明確符合上述條件時，progressEval.triggered 才能為 true。'
            : '所有里程碑均已達成；progressEval.triggered 必須為 false。';
        const milestoneSection = `\n## 【主線進度與本回合判定 — ${mTitle}】\n` +
            `已達成 ${achieved.length}/${scn.MILESTONES.length} 個${mTitle}。\n` +
            `${nextInstruction}\n已知線索：${clues || '尚無'}\n` +
            '可以自然融入線索，但禁止為了觸發進度而憑空創造不合因果的事件。\n';
        const idx = prompt.lastIndexOf('現在，請根據');
        if (idx > 0) prompt = prompt.slice(0, idx) + milestoneSection + prompt.slice(idx);
        else prompt += milestoneSection;

        // v3.0: 注入深度記憶上下文（在生成指令之前，讓 LLM 更好地注意到）
        if (ctx.deepMemoryContext) {
            // 找到最後一行「現在，請根據...」並在其前面插入
            const finalInstructionIndex = prompt.lastIndexOf('現在，請根據');
            if (finalInstructionIndex > 0) {
                const deepMemSection = `\n\n## 【深度記憶 — AI 長期記憶系統提供的相關歷史資訊】\n以下是與當前行動相關的過往記憶。請自然地將這些記憶融入你的故事敘述中（例如角色提起過去的事、呼應之前的伏筆），但不要生硬地逐條列出。如果記憶與當前場景無關，可以忽略。\n${ctx.deepMemoryContext}\n\n`;
                prompt = prompt.slice(0, finalInstructionIndex) + deepMemSection + prompt.slice(finalInstructionIndex);
            } else {
                prompt += `\n\n## 【深度記憶】\n${ctx.deepMemoryContext}\n`;
            }
        }
        return { prompt, json: true, configKey: 'story' };
    },

    'progress-evaluator': (ctx) => {
        const { getProgressEvaluatorPrompt } = require('../prompts/progressEvaluatorPrompt');
        const scenario = ctx.player?.scenario || ctx.scenario || 'wuxia';
        const prompt = getProgressEvaluatorPrompt(
            ctx.story || '',
            ctx.achievedMilestones || [],
            ctx.cluesSummary || '',
            scenario
        );
        if (!prompt) return { prompt: '{"triggered":false,"reason":"all done","questJournal":"所有里程碑已達成。"}', json: true, configKey: 'story' };
        return { prompt, json: true, configKey: 'story' };
    },

    'narrative': (ctx) => {
        const { getNarrativePrompt } = require('../prompts/narrativePrompt');
        const prompt = getNarrativePrompt(ctx.roundData, ctx.player?.scenario);
        return { prompt, json: false, configKey: 'narrative' };
    },

    'prequel': (ctx) => {
        const { getPrequelPrompt } = require('../prompts/prequelPrompt');
        const prompt = getPrequelPrompt(ctx.recentHistory);
        return { prompt, json: false, configKey: 'prequel' };
    },

    'epilogue': (ctx) => {
        const { getEpiloguePrompt } = require('../prompts/epiloguePrompt');
        const prompt = getEpiloguePrompt(ctx.playerData);
        return { prompt, json: false, configKey: 'epilogue' };
    },

    'death-cause': (ctx) => {
        const { getDeathCausePrompt } = require('../prompts/deathCausePrompt');
        const prompt = getDeathCausePrompt(ctx.username, ctx.lastRoundData, ctx.player?.scenario);
        return { prompt, json: false, configKey: 'deathCause' };
    },

    // -------------------------------------------------------------------------
    // Game Logic & Data
    // -------------------------------------------------------------------------

    'summary': (ctx) => {
        const { getSummaryPrompt } = require('../prompts/summaryPrompt');
        const prompt = getSummaryPrompt(ctx.oldSummary, ctx.newRoundData);
        return { prompt, json: true, configKey: 'summary' };
    },

    'action-classifier': (ctx) => {
        const { getActionClassifierPrompt } = require('../prompts/actionClassifierPrompt');
        const prompt = getActionClassifierPrompt(ctx.playerAction, ctx.context);
        return { prompt, json: true, configKey: 'actionClassifier' };
    },

    'suggestion': (ctx) => {
        const { getSuggestionPrompt } = require('../prompts/suggestionPrompt');
        const prompt = getSuggestionPrompt(ctx.roundData);
        return { prompt, json: false, configKey: 'suggestion' };
    },

    'anachronism': (ctx) => {
        const { getAnachronismPrompt } = require('../prompts/anachronismPrompt');
        const prompt = getAnachronismPrompt(ctx.playerAction, ctx.anachronisticItem);
        return { prompt, json: false, configKey: 'narrative' };
    },

    // -------------------------------------------------------------------------
    // Combat
    // -------------------------------------------------------------------------

    'combat': (ctx) => {
        const { getCombatPrompt } = require('../prompts/combatPrompt');
        const prompt = getCombatPrompt(ctx.playerProfile, ctx.combatState, ctx.playerAction);
        return { prompt, json: true, configKey: 'combat' };
    },

    'combat-setup': (ctx) => {
        const { getCombatSetupPrompt } = require('../prompts/combatSetupPrompt');
        const prompt = getCombatSetupPrompt(ctx.playerAction, ctx.lastRoundData);
        return { prompt, json: true, configKey: 'combatSetup' };
    },

    'surrender': (ctx) => {
        const { getSurrenderPrompt } = require('../prompts/surrenderPrompt');
        const prompt = getSurrenderPrompt(ctx.playerProfile, ctx.combatState);
        return { prompt, json: true, configKey: 'surrender' };
    },

    'post-combat': (ctx) => {
        const { getAIPostCombatResultPrompt } = require('../prompts/postCombatPrompt');
        const prompt = getAIPostCombatResultPrompt(
            ctx.playerProfile,
            ctx.finalCombatState,
            ctx.combatLog,
            ctx.killerName
        );
        return { prompt, json: true, configKey: 'postCombat' };
    },

    // -------------------------------------------------------------------------
    // NPC & Interaction
    // -------------------------------------------------------------------------

    'npc-profile': (ctx) => {
        const { getNpcCreatorPrompt } = require('../prompts/npcCreatorPrompt');
        const prompt = getNpcCreatorPrompt(
            ctx.username,
            ctx.npcName,
            ctx.roundData,
            ctx.playerProfile,
            ctx.potentialRelationships
        );
        return { prompt, json: true, configKey: 'npcProfile' };
    },

    'npc-chat': (ctx) => {
        const { getChatMasterPrompt } = require('../prompts/chatMasterPrompt');
        const prompt = getChatMasterPrompt(
            ctx.npcProfile,
            ctx.chatHistory,
            ctx.playerMessage,
            ctx.longTermSummary,
            ctx.localLocationContext,
            ctx.mentionedNpcContext
        );
        return { prompt, json: true, configKey: 'npcChat' };
    },

    'npc-chat-summary': (ctx) => {
        const { getChatSummaryPrompt } = require('../prompts/chatSummaryPrompt');
        const prompt = getChatSummaryPrompt(
            ctx.username,
            ctx.npcName,
            ctx.fullChatHistory,
            ctx.longTermSummary
        );
        return { prompt, json: true, configKey: 'npcChatSummary' };
    },

    'npc-memory': (ctx) => {
        const { getNpcMemoryPrompt } = require('../prompts/npcMemoryPrompt');
        const prompt = getNpcMemoryPrompt(ctx.npcName, ctx.oldSummary, ctx.interactionData);
        return { prompt, json: true, configKey: 'npcMemory' };
    },

    'give-item': (ctx) => {
        const { getGiveItemPrompt } = require('../prompts/giveItemPrompt');
        const prompt = getGiveItemPrompt(ctx.playerProfile, ctx.npcProfile, ctx.itemInfo);
        return { prompt, json: true, configKey: 'giveItem' };
    },

    'give-narrative': (ctx) => {
        const { getAINarrativeForGive } = require('../prompts/narrativeForGivePrompt');
        const prompt = getAINarrativeForGive(
            ctx.lastRoundData,
            ctx.playerName,
            ctx.npcName,
            ctx.itemName,
            ctx.npcResponse
        );
        return { prompt, json: false, configKey: 'giveNarrative' };
    },

    'proactive-chat': (ctx) => {
        const { getProactiveChatPrompt } = require('../prompts/proactiveChatPrompt');
        const prompt = getProactiveChatPrompt(ctx.playerProfile, ctx.npcProfile, ctx.triggerEvent);
        return { prompt, json: true, configKey: 'proactiveChat' };
    },

    'location-generator': (ctx) => {
        const { getLocationGeneratorPrompt } = require('../prompts/locationGeneratorPrompt');
        const prompt = getLocationGeneratorPrompt(ctx.locationName, ctx.locationType, ctx.worldSummary, ctx.player?.scenario);
        return { prompt, json: true, configKey: 'location' };
    },
};

// =============================================================================
// OUTPUT CONTRACTS + SAFE NORMALIZATION
// =============================================================================

const STORY_MIN_CHARS = 450;
const STORY_MAX_CHARS = 500;
const STORY_HARD_MAX_CHARS = 1200;
const TIME_OF_DAY_FALLBACKS = ['上午', '午後', '黃昏', '深夜'];

// Kept as plain JSON Schema so it can be sent to providers without adding a
// validation dependency. normalizeStoryResult remains the authoritative guard.
const STORY_RESULT_SCHEMA = {
    type: 'object',
    required: ['story', 'roundData'],
    properties: {
        story: { type: 'string', minLength: STORY_MIN_CHARS, maxLength: STORY_MAX_CHARS },
        roundData: {
            type: 'object',
            required: [
                'playerState', 'timeOfDay', 'moralityChange', 'EVT', 'LOC', 'PC', 'NPC', 'WRD',
                'actionOptions', 'actionMorality', 'suggestion', 'progressEval',
            ],
            properties: {
                playerState: { enum: ['alive', 'dead'] },
                timeOfDay: { type: 'string' },
                moralityChange: { type: 'number' },
                EVT: { type: 'string' },
                LOC: { type: 'array', items: { type: 'string' } },
                PC: { type: 'string' },
                NPC: {
                    type: 'array',
                    maxItems: 20,
                    items: {
                        type: 'object',
                        required: ['name', 'status', 'friendliness', 'friendlinessChange'],
                        properties: {
                            name: { type: 'string' },
                            status: { type: 'string' },
                            friendliness: { type: 'string' },
                            friendlinessChange: { type: 'number' },
                            isNew: { type: 'boolean' },
                            isDeceased: { type: 'boolean' },
                        },
                    },
                },
                WRD: { type: 'string' },
                actionOptions: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
                actionMorality: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
                suggestion: { type: 'string' },
                progressEval: {
                    type: 'object',
                    required: ['triggered', 'reason', 'questJournal'],
                },
                daysToAdvance: { type: 'number', minimum: 0, maximum: 3650 },
            },
        },
    },
};

function clampNumber(value, min, max, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function cleanString(value, maxLength, fallback = '') {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return fallback;
    return text.slice(0, maxLength);
}

const NPC_FRIENDLINESS = new Set([
    'devoted', 'trusted', 'friendly', 'neutral', 'wary', 'hostile', 'sworn_enemy',
]);

function normalizeNpcList(value, warnings, knownNpcNames = new Set()) {
    if (!Array.isArray(value)) return [];
    const normalized = [];
    // Scan a bounded prefix, but let malformed entries fall out before the
    // 20-valid-NPC cap so junk cannot crowd legitimate characters out.
    for (const item of value.slice(0, 100)) {
        if (normalized.length >= 20) break;
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const name = cleanString(item.name, 60);
        if (!name) continue;
        const requestedFriendliness = cleanString(item.friendliness, 24, 'neutral').toLowerCase();
        normalized.push({
            name,
            status: cleanString(item.status, 160, '狀態未明'),
            friendliness: NPC_FRIENDLINESS.has(requestedFriendliness) ? requestedFriendliness : 'neutral',
            friendlinessChange: clampNumber(item.friendlinessChange, -100, 100, 0),
            // A model flag is not evidence of novelty: compare with names from
            // recent context so copied `isNew:true` cannot trigger summaries forever.
            isNew: !knownNpcNames.has(name),
            isDeceased: item.isDeceased === true,
        });
    }
    if (normalized.length !== value.length) warnings.push('npc_entries_filtered');
    return normalized;
}

function normalizeDaysToAdvance(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.trunc(Math.min(3650, Math.max(0, value)));
}

function deterministicStoryFallback(context) {
    const playerName = cleanString(context.player?.username || context.username, 20, '你');
    const action = cleanString(context.playerAction, 60, '觀察眼前局勢');
    return `${playerName}嘗試「${action}」，但局勢暫時沒有出現足以改變現況的結果。` +
        '周遭的人事物仍維持原狀，時間緩慢向前推進。你重新確認自己的處境，沒有失去物品，也沒有受到新的傷害。' +
        '這次行動雖未帶來明確突破，卻讓你有機會留意環境中的細節。下一步可以先觀察、詢問附近角色，或退到安全處重新思考。';
}

function deterministicOptions(context) {
    const scenario = context.player?.scenario || 'wuxia';
    const options = {
        wuxia: ['仔細觀察四周動靜', '上前詢問事情原委', '暫退安全處再作打算'],
        school: ['觀察教室裡的動靜', '詢問同學事情原委', '先回座位整理思緒'],
        mecha: ['掃描周圍異常訊號', '聯絡隊友確認狀況', '退回掩體重新部署'],
        modern: ['觀察周圍可疑細節', '詢問附近知情人士', '先到安全地點整理線索'],
        animal: ['嗅聞周圍陌生氣味', '靠近同伴交換訊息', '退回熟悉領域觀察'],
        hero: ['觀察現場異能痕跡', '詢問當事人的感受', '先確保眾人安全撤離'],
    };
    return {
        actionOptions: options[scenario] || options.wuxia,
        actionMorality: [0, 1, -1],
        suggestion: '先確認情勢，再選擇風險可控的行動。',
    };
}

function normalizeActionOptions(value, fallback) {
    if (!Array.isArray(value)) return fallback;
    const unique = [...new Set(value.map(item => cleanString(item, 30)).filter(Boolean))];
    return unique.length === 3 ? unique : fallback;
}

function normalizeActionMorality(value, fallback) {
    if (!Array.isArray(value) || value.length !== 3) return fallback;
    const numbers = value.map(item => clampNumber(item, -10, 10, 0));
    if (!numbers.some(item => item > 0) || !numbers.some(item => item < 0)) return fallback;
    return numbers;
}

function safeParseJson(rawText) {
    try {
        return parseJsonResponse(rawText);
    } catch (_) {
        return null;
    }
}

function normalizeStoryResult(rawResult, context, partialStory = '') {
    const warnings = [];
    let parsed = rawResult;
    if (typeof rawResult === 'string') parsed = safeParseJson(rawResult);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};

    const sourceRound = parsed.roundData && typeof parsed.roundData === 'object' && !Array.isArray(parsed.roundData)
        ? parsed.roundData
        : {};
    let story = cleanString(parsed.story || sourceRound.story || partialStory, STORY_HARD_MAX_CHARS);
    if (!story) {
        story = deterministicStoryFallback(context);
        warnings.push('story_missing_fallback_used');
    }
    if (story.length < STORY_MIN_CHARS || story.length > STORY_MAX_CHARS) {
        warnings.push(`story_length_${story.length}_outside_${STORY_MIN_CHARS}_${STORY_MAX_CHARS}`);
    }
    if (story.length >= STORY_HARD_MAX_CHARS) warnings.push('story_hard_truncated');

    const fallbackOptions = deterministicOptions(context);
    const actionOptions = normalizeActionOptions(
        sourceRound.actionOptions || parsed.actionOptions,
        fallbackOptions.actionOptions
    );
    const actionMorality = normalizeActionMorality(
        sourceRound.actionMorality || parsed.actionMorality,
        fallbackOptions.actionMorality
    );
    if (actionOptions === fallbackOptions.actionOptions) warnings.push('action_options_fallback_used');
    if (actionMorality === fallbackOptions.actionMorality) warnings.push('action_morality_fallback_used');

    const rawProgress = sourceRound.progressEval || parsed.progressEval;
    const progressEval = rawProgress && typeof rawProgress === 'object' && !Array.isArray(rawProgress)
        ? {
            triggered: rawProgress.triggered === true,
            reason: cleanString(rawProgress.reason, 80, '本回合未偵測到明確主線進展'),
            questJournal: cleanString(rawProgress.questJournal, 120, '持續調查主線線索。'),
        }
        : {
            triggered: false,
            reason: '本回合未偵測到明確主線進展',
            questJournal: '持續調查主線線索。',
        };
    if (!rawProgress || typeof rawProgress !== 'object') warnings.push('progress_fallback_used');

    let validTimes = TIME_OF_DAY_FALLBACKS;
    try {
        const { getScenario } = require('../scenarios/index.js');
        const configured = getScenario(context.player?.scenario).timeSequence;
        if (Array.isArray(configured) && configured.length > 0) validTimes = configured;
    } catch (_) { /* default time sequence is safe */ }
    const requestedTime = cleanString(sourceRound.timeOfDay, 20);
    const timeOfDay = validTimes.includes(requestedTime)
        ? requestedTime
        : (context.player?.currentTimeOfDay || context.player?.timeOfDay || validTimes[0]);

    const fallbackLocation = Array.isArray(context.player?.currentLocation)
        ? context.player.currentLocation
        : [];
    const location = Array.isArray(sourceRound.LOC)
        ? sourceRound.LOC.map(item => cleanString(item, 60)).filter(Boolean).slice(0, 6)
        : fallbackLocation;
    const suggestion = cleanString(
        sourceRound.suggestion || parsed.suggestion,
        80,
        fallbackOptions.suggestion
    );
    const knownNpcNames = new Set([
        ...(Array.isArray(context.actorCandidates) ? context.actorCandidates : []),
        ...Object.keys(context.npcContext || {}),
    ].map(name => cleanString(name, 60)).filter(Boolean));
    const normalizedNpcs = normalizeNpcList(sourceRound.NPC, warnings, knownNpcNames);

    const roundData = {
        ...sourceRound,
        R: Math.max(0, Math.trunc(clampNumber(
            sourceRound.R,
            0,
            Number.MAX_SAFE_INTEGER,
            (context.currentRound || context.player?.R || 0) + 1
        ))),
        playerState: sourceRound.playerState === 'dead' ? 'dead' : 'alive',
        timeOfDay,
        moralityChange: clampNumber(sourceRound.moralityChange, -100, 100, 0),
        EVT: cleanString(sourceRound.EVT, 40, '局勢未明'),
        LOC: location,
        PC: cleanString(sourceRound.PC, 120, '狀態未有明顯變化'),
        NPC: normalizedNpcs,
        hasNewNpc: normalizedNpcs.some(npc => npc.isNew),
        WRD: cleanString(sourceRound.WRD, 40, '天候未明'),
        actionOptions,
        actionMorality,
        suggestion,
        progressEval,
        questJournal: progressEval.questJournal,
        daysToAdvance: normalizeDaysToAdvance(sourceRound.daysToAdvance),
        story,
    };

    return {
        data: { ...parsed, story, roundData, suggestion },
        warnings,
    };
}

function normalizeSummaryResult(rawResult, context) {
    const parsed = typeof rawResult === 'string' ? safeParseJson(rawResult) : rawResult;
    const summary = cleanString(
        parsed && typeof parsed === 'object' ? parsed.summary : rawResult,
        2000,
        cleanString(context.oldSummary, 2000, '遊戲剛剛開始...')
    );
    return {
        summary,
        revision: Math.max(0, Math.trunc(clampNumber(context.revision, 0, Number.MAX_SAFE_INTEGER, 0))),
    };
}

function storyContractInstruction() {
    return `\n\n## 【單次結構化回應契約 — 最高優先級】\n` +
        '本回合只會呼叫你一次；你必須在同一個 roundData 中一併產生 actionOptions、actionMorality、suggestion 與 progressEval。\n' +
        'story 必須放在 JSON 第一個欄位，方便串流顯示。不可使用 Markdown code fence。\n' +
        `請嚴格符合以下 JSON Schema：\n${JSON.stringify(STORY_RESULT_SCHEMA)}\n`;
}

function injectStoryContract(prompt) {
    const dynamicMarker = '## 【本回合動態資訊】';
    const markerIndex = prompt.indexOf(dynamicMarker);
    if (markerIndex < 0) return `${storyContractInstruction()}\n${prompt}`;
    return `${prompt.slice(0, markerIndex)}${storyContractInstruction()}\n${prompt.slice(markerIndex)}`;
}

/** Decode the currently complete portion of a JSON string field. */
function extractPartialJsonString(rawText, fieldName) {
    const source = String(rawText || '');
    const keyPattern = new RegExp(`"${fieldName}"\\s*:\\s*"`);
    const match = keyPattern.exec(source);
    if (!match) return '';
    let index = match.index + match[0].length;
    let output = '';

    while (index < source.length) {
        const char = source[index++];
        if (char === '"') break;
        if (char !== '\\') {
            output += char;
            continue;
        }
        if (index >= source.length) break;
        const escaped = source[index++];
        const simpleEscapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (escaped === 'u') {
            const hex = source.slice(index, index + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
            output += String.fromCharCode(parseInt(hex, 16));
            index += 4;
        } else if (Object.prototype.hasOwnProperty.call(simpleEscapes, escaped)) {
            output += simpleEscapes[escaped];
        }
    }
    return output;
}

function sendSse(res, eventName, payload) {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function explicitlyAcceptsEventStream(acceptHeader) {
    if (typeof acceptHeader !== 'string') return false;
    return acceptHeader.split(',').some(entry => {
        const [mediaType, ...parameters] = entry.trim().toLowerCase().split(';');
        if (mediaType !== 'text/event-stream') return false;
        const quality = parameters
            .map(parameter => parameter.trim())
            .find(parameter => parameter.startsWith('q='));
        if (!quality) return true;
        const parsed = Number(quality.slice(2));
        return Number.isFinite(parsed) && parsed > 0;
    });
}

function maybeSaveMemPalace(context, data) {
    if (process.env.MEMPALACE_ENABLED !== 'true') return;
    setImmediate(() => {
        try {
            const mempalace = require('../services/mempalaceClient');
            const playerId = context.player?.id || context.profileId || 'unknown';
            mempalace.saveRoundMemory(playerId, data.roundData, data.story);
        } catch (error) {
            console.warn('[MemPalace] 非阻塞寫入失敗:', error.message);
        }
    });
}

function taskCallConfig(task, requestId, signal, onTelemetry) {
    const storyTimeout = Number(process.env.AI_STORY_TIMEOUT_MS) || 35_000;
    const otherTimeout = Number(process.env.AI_AUX_TIMEOUT_MS) || 20_000;
    return {
        task,
        requestId,
        signal,
        timeoutMs: task === 'story' ? storyTimeout : otherTimeout,
        maxRetries: Number(process.env.AI_MAX_RETRIES) || 0,
        maxCompletionTokens: task === 'story' ? 2048 : (task === 'summary' ? 1400 : 1200),
        onTelemetry,
    };
}

// =============================================================================
// POST /ai/generate
// =============================================================================
router.post('/generate', async (req, res, next) => {
    const disconnectController = new AbortController();
    let responseCompleted = false;
    const abortOnDisconnect = () => {
        if (!responseCompleted && !disconnectController.signal.aborted) {
            disconnectController.abort(new Error('client_disconnected'));
        }
    };
    req.once('aborted', abortOnDisconnect);
    res.once('close', abortOnDisconnect);

    try {
        const { task, model, context, apiKey } = req.body;

        if (!task) {
            return res.status(400).json({ success: false, error: 'Missing required field: task' });
        }
        if (!context || typeof context !== 'object') {
            return res.status(400).json({ success: false, error: 'Missing or invalid field: context' });
        }

        const handler = TASK_HANDLERS[task];
        if (!handler) {
            return res.status(400).json({
                success: false,
                error: `Unknown task: "${task}". Available tasks: ${Object.keys(TASK_HANDLERS).join(', ')}`,
            });
        }

        // Build prompt from context
        let { prompt, json: isJsonExpected, configKey } = handler(context);
        if (task === 'story') prompt = injectStoryContract(prompt);

        // Determine which model to use: explicit request > aiConfig default > minimax
        const modelToUse = model || aiConfig[configKey] || 'minimax';
        const requestId = req.get('X-Request-ID') || crypto.randomUUID();
        // Streaming is transport negotiation, not request data. Keeping it in
        // Accept preserves the strict generate-body allowlist used by the cost guard.
        // SSE is explicit opt-in. Fetch's default `Accept: */*` and omitted
        // Accept must remain JSON-compatible for cached pre-v0.27 clients.
        const wantsStream = task === 'story' && explicitlyAcceptsEventStream(req.get('accept'));
        let telemetry = null;
        const callConfig = taskCallConfig(
            task,
            requestId,
            disconnectController.signal,
            event => { telemetry = event; }
        );

        console.log(JSON.stringify({
            type: 'ai_request', request_id: requestId, task, model: modelToUse,
            stream: wantsStream, has_user_key: Boolean(apiKey),
        }));

        // Story is always one provider call. MiniMax streams; other providers use
        // a single bounded non-streaming call inside the same SSE envelope.
        if (task === 'story') {
            if (wantsStream) {
                let rawText = '';
                let visibleStory = '';
                let heartbeat = null;
                let sseStarted = false;
                const startSse = () => {
                    if (sseStarted) return;
                    sseStarted = true;
                    res.status(200);
                    res.set({
                        'Content-Type': 'text/event-stream; charset=utf-8',
                        'Cache-Control': 'no-cache, no-transform',
                        Connection: 'keep-alive',
                        'X-Accel-Buffering': 'no',
                        'X-Request-ID': requestId,
                    });
                    res.flushHeaders?.();
                    res.write(': connected\n\n');
                    sendSse(res, 'meta', { requestId, model: modelToUse, task });
                    heartbeat = setInterval(() => {
                        if (!res.writableEnded && !res.destroyed) res.write(': heartbeat\n\n');
                    }, 15_000);
                    heartbeat.unref?.();
                };

                try {
                    req.providerCallStarted = true;
                    const streamed = await aiProvider.streamAI(
                        modelToUse,
                        prompt,
                        true,
                        callConfig,
                        apiKey || null,
                        delta => {
                            rawText += delta;
                            const partial = extractPartialJsonString(rawText, 'story');
                            if (partial.length > visibleStory.length) {
                                const newText = partial.slice(visibleStory.length);
                                visibleStory = partial;
                                startSse();
                                sendSse(res, 'story_delta', { text: newText });
                            }
                        }
                    );
                    const normalized = normalizeStoryResult(streamed.text, context, visibleStory);
                    startSse();
                    if (normalized.data.story.length > visibleStory.length) {
                        sendSse(res, 'story_delta', {
                            text: normalized.data.story.slice(visibleStory.length),
                        });
                    }
                    maybeSaveMemPalace(context, normalized.data);
                    sendSse(res, 'result', {
                        success: true,
                        data: normalized.data,
                        model_used: modelToUse,
                        request_id: requestId,
                        telemetry,
                        validation_warnings: normalized.warnings,
                    });
                    responseCompleted = true;
                    if (heartbeat) clearInterval(heartbeat);
                    return res.end();
                } catch (error) {
                    if (heartbeat) clearInterval(heartbeat);
                    const publicError = aiService.publicProviderErrorPayload(error, requestId) || {
                        success: false,
                        code: 'AI_STREAM_ERROR',
                        error: 'AI 服務暫時無法完成請求，請稍後再試。',
                        request_id: requestId,
                        retryable: false,
                        status: 502,
                    };
                    if (!sseStarted && !res.headersSent) {
                        responseCompleted = true;
                        return res.status(publicError.status).json(publicError);
                    }
                    if (!res.destroyed && !res.writableEnded) {
                        sendSse(res, 'error', publicError);
                        responseCompleted = true;
                        return res.end();
                    }
                    responseCompleted = true;
                    return;
                }
            }

            req.providerCallStarted = true;
            const storyRaw = await aiProvider.callAI(modelToUse, prompt, true, callConfig, apiKey || null);
            const normalized = normalizeStoryResult(storyRaw, context);
            maybeSaveMemPalace(context, normalized.data);
            responseCompleted = true;
            return res.json({
                success: true,
                data: normalized.data,
                model_used: modelToUse,
                request_id: requestId,
                telemetry,
                validation_warnings: normalized.warnings,
            });
        }

        // Non-story path retains the old JSON API and output shapes.
        req.providerCallStarted = true;
        const rawText = await aiProvider.callAI(modelToUse, prompt, isJsonExpected, callConfig, apiKey || null);

        let data;
        if (task === 'summary') {
            data = normalizeSummaryResult(rawText, context);
        } else if (isJsonExpected) {
            try { data = parseJsonResponse(rawText); } catch (_) { data = rawText; }
        } else {
            data = rawText;
        }

        responseCompleted = true;
        return res.json({
            success: true,
            data,
            model_used: modelToUse,
            request_id: requestId,
            telemetry,
        });
    } catch (err) {
        responseCompleted = true;
        next(err);
    }
});

// =============================================================================
// POST /ai/image
// =============================================================================
router.post('/image', async (req, res, next) => {
    try {
        const { prompt } = req.body;

        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({ success: false, error: 'Missing or invalid field: prompt' });
        }

        console.log(`[AI Proxy] Image generation request: "${prompt.substring(0, 80)}..."`);

        req.providerCallStarted = true;
        const imageUrl = await getAIGeneratedImage(prompt);

        if (!imageUrl) {
            return res.status(502).json({
                success: false,
                error: 'Image generation failed. The AI provider returned no result.',
            });
        }

        return res.json({
            success: true,
            imageUrl,
        });
    } catch (err) {
        next(err);
    }
});

router._internals = {
    STORY_RESULT_SCHEMA,
    deterministicOptions,
    extractPartialJsonString,
    injectStoryContract,
    normalizeStoryResult,
    normalizeSummaryResult,
    explicitlyAcceptsEventStream,
    setAIProviderForTests(provider) {
        aiProvider = provider ? { ...defaultAIProvider, ...provider } : defaultAIProvider;
    },
};

module.exports = router;
