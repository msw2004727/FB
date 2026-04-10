// ai-proxy/routes/aiRoutes.js
const express = require('express');
const router = express.Router();
const rateLimit = require('../middleware/rateLimit');

// Apply rate limiting to all /ai routes
router.use(rateLimit(30, 60 * 1000));

// --- Load core AI services ---
const { callAI, getAIGeneratedImage } = require('../services/aiService');
const { aiConfig } = require('../aiConfig');

// --- JSON parse helper (mirrors the one in aiService.js) ---
function parseJsonResponse(text) {
    const clean = text.replace(/^```json\s*|```\s*$/g, '');
    return JSON.parse(clean);
}

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
        const prompt = getProgressEvaluatorPrompt(
            ctx.story || '',
            ctx.achievedMilestones || [],
            ctx.cluesSummary || ''
        );
        if (!prompt) return { prompt: '{"triggered":false,"reason":"all done","questJournal":"你已找到回家的路。"}', json: true, configKey: 'story' };
        return { prompt, json: true, configKey: 'story' };
    },

    'narrative': (ctx) => {
        const { getNarrativePrompt } = require('../prompts/narrativePrompt');
        const prompt = getNarrativePrompt(ctx.roundData);
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
        const prompt = getDeathCausePrompt(ctx.username, ctx.lastRoundData);
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

    'trade-summary': (ctx) => {
        const { getTradeSummaryPrompt } = require('../prompts/tradeSummaryPrompt');
        const prompt = getTradeSummaryPrompt(
            ctx.username,
            ctx.npcName,
            ctx.tradeDetails,
            ctx.longTermSummary
        );
        return { prompt, json: true, configKey: 'npcChatSummary' };
    },

    // -------------------------------------------------------------------------
    // World & Generators
    // -------------------------------------------------------------------------

    'encyclopedia': (ctx) => {
        const { getEncyclopediaPrompt } = require('../prompts/encyclopediaPrompt');
        const prompt = getEncyclopediaPrompt(ctx.longTermSummary, ctx.username, ctx.npcDetails);
        return { prompt, json: true, configKey: 'encyclopedia' };
    },

    'relation-graph': (ctx) => {
        const { getRelationGraphPrompt } = require('../prompts/relationGraphPrompt');
        const prompt = getRelationGraphPrompt(ctx.longTermSummary, ctx.username, ctx.npcDetails);
        return { prompt, json: true, configKey: 'relationGraph' };
    },

    'romance-event': (ctx) => {
        const { getRomanceEventPrompt } = require('../prompts/romanceEventPrompt');
        const prompt = getRomanceEventPrompt(ctx.playerProfile, ctx.npcProfile, ctx.eventType);
        return { prompt, json: true, configKey: 'romanceEvent' };
    },

    'bounty-generator': (ctx) => {
        const { getBountyGeneratorPrompt } = require('../prompts/bountyGeneratorPrompt');
        const prompt = getBountyGeneratorPrompt(ctx.playerContext);
        return { prompt, json: true, configKey: 'bounty' };
    },

    'item-generator': (ctx) => {
        const { getItemGeneratorPrompt } = require('../prompts/itemGeneratorPrompt');
        const prompt = getItemGeneratorPrompt(ctx.itemName, ctx.context);
        return { prompt, json: true, configKey: 'itemTemplate' };
    },

    'location-generator': (ctx) => {
        const { getLocationGeneratorPrompt } = require('../prompts/locationGeneratorPrompt');
        const prompt = getLocationGeneratorPrompt(ctx.locationName, ctx.locationType, ctx.worldSummary);
        return { prompt, json: true, configKey: 'location' };
    },

    'reward-generator': (ctx) => {
        const { getRewardGeneratorPrompt } = require('../prompts/rewardGeneratorPrompt');
        const prompt = getRewardGeneratorPrompt(ctx.bounty, ctx.playerProfile);
        return { prompt, json: true, configKey: 'reward' };
    },

    'skill-generator': (ctx) => {
        const { getSkillGeneratorPrompt } = require('../prompts/skillGeneratorPrompt');
        const prompt = getSkillGeneratorPrompt(ctx.skillName);
        return { prompt, json: true, configKey: 'skillTemplate' };
    },

    // -------------------------------------------------------------------------
    // Cultivation & Skill
    // -------------------------------------------------------------------------

    'cultivation': (ctx) => {
        const { getCultivationPrompt } = require('../prompts/cultivationPrompt');
        const profileForPrompt = { ...ctx.playerProfile, username: ctx.username };
        const prompt = getCultivationPrompt(
            profileForPrompt,
            ctx.skillToPractice,
            ctx.days,
            ctx.outcome,
            ctx.storyHint
        );
        return { prompt, json: false, configKey: 'narrative' };
    },

    'forget-skill': (ctx) => {
        const { getForgetSkillPrompt } = require('../prompts/forgetSkillPrompt');
        const prompt = getForgetSkillPrompt(ctx.playerProfile, ctx.skillName);
        return { prompt, json: false, configKey: 'narrative' };
    },

    // -------------------------------------------------------------------------
    // Misc
    // -------------------------------------------------------------------------

    'random-event': (ctx) => {
        const { getRandomEventPrompt } = require('../prompts/randomEventPrompt');
        const prompt = getRandomEventPrompt(ctx.eventType, ctx.playerProfile);
        return { prompt, json: true, configKey: 'story' };
    },

    'beggar-inquiry': (ctx) => {
        const { getBeggarInquiryPrompt } = require('../prompts/beggarInquiryPrompt');
        const prompt = getBeggarInquiryPrompt(ctx.playerProfile, ctx.targetNpcProfile, ctx.userQuery);
        return { prompt, json: true, configKey: 'npcChat' };
    },

    'relationship-fix': (ctx) => {
        const { getRelationshipFixPrompt } = require('../prompts/relationshipFixPrompt');
        const prompt = getRelationshipFixPrompt(ctx.playerProfile, ctx.orphanNpcProfile);
        return { prompt, json: true, configKey: 'npcProfile' };
    },
};

// =============================================================================
// POST /ai/generate
// =============================================================================
router.post('/generate', async (req, res, next) => {
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

        // Phase 2: 在生成故事前，從 MemPalace 搜尋相關記憶注入 context
        if (task === 'story') {
            try {
                const mempalace = require('../services/mempalaceClient');
                const playerId = context.player?.id || context.profileId || 'unknown';
                const playerAction = context.playerAction || '';
                const npcNames = context.actorCandidates || Object.keys(context.npcContext || {});
                const currentRound = context.currentRound ?? context.round ?? 0;
                const deepMemory = await mempalace.buildDeepMemoryContext(playerId, playerAction, npcNames, currentRound);
                if (deepMemory) {
                    context.deepMemoryContext = deepMemory;
                    console.log(`[MemPalace v3] Injected ${deepMemory.length} chars (R${currentRound})`);
                }
            } catch (memErr) {
                console.warn('[MemPalace v3] Search failed (non-blocking):', memErr.message);
            }
        }

        // Build prompt from context
        let { prompt, json: isJsonExpected, configKey } = handler(context);

        // Determine which model to use: explicit request > aiConfig default > minimax
        const modelToUse = model || aiConfig[configKey] || 'minimax';

        console.log(`[AI Proxy] task="${task}" model="${modelToUse}" json=${isJsonExpected} hasUserKey=${!!apiKey}`);

        // === story 任務：主故事 + 選項並行 ===
        if (task === 'story') {
            const { getOptionsPrompt } = require('../prompts/optionsPrompt');
            const t0 = Date.now();

            // 並行發出兩個 AI 呼叫
            const [storyRaw, optionsRaw] = await Promise.all([
                callAI(modelToUse, prompt, true, {}, apiKey || null),
                // 選項 prompt 極短，用同一個模型但獨立呼叫
                callAI('minimax', getOptionsPrompt(
                    context.playerAction || '',
                    context.recentHistory?.[context.recentHistory.length - 1]?.EVT || '',
                    context.player?.PC || ''
                ), true, {}),
            ]);

            console.log(`[AI Proxy] Parallel calls done in ${Date.now() - t0}ms`);

            let data;
            try { data = parseJsonResponse(storyRaw); } catch (_) { data = storyRaw; }

            // 合併選項結果
            if (data && typeof data === 'object') {
                try {
                    const opts = parseJsonResponse(optionsRaw);
                    if (!data.roundData) data.roundData = {};
                    if (opts.actionOptions) data.roundData.actionOptions = opts.actionOptions;
                    if (opts.actionMorality) data.roundData.actionMorality = opts.actionMorality;
                    if (opts.suggestion) data.roundData.suggestion = opts.suggestion;
                } catch (_) {
                    console.warn('[AI Proxy] Options parse failed, using fallback');
                }

                // MemPalace: fire-and-forget
                try {
                    const mempalace = require('../services/mempalaceClient');
                    const playerId = context.player?.id || context.profileId || 'unknown';
                    const story = data.story || (data.roundData && data.roundData.story) || '';
                    mempalace.saveRoundMemory(playerId, data.roundData || data, story);
                } catch (_) {}

                // 進度評估: fire-and-forget
                const storyForEval = data.story || (data.roundData && data.roundData.story) || '';
                (async () => {
                    try {
                        const { getProgressEvaluatorPrompt } = require('../prompts/progressEvaluatorPrompt');
                        const evalPrompt = getProgressEvaluatorPrompt(storyForEval, context.achievedMilestones || [], context.cluesSummary || '');
                        if (!evalPrompt) return;
                        const evalRaw = await callAI('minimax', evalPrompt, true, {});
                        const evalResult = parseJsonResponse(evalRaw);
                        if (evalResult.triggered) console.log(`[Progress] Milestone triggered! ${evalResult.reason}`);
                    } catch (_) {}
                })();
            }

            return res.json({ success: true, data, model_used: modelToUse });
        }

        // === 非 story 任務：原始流程 ===
        const rawText = await callAI(modelToUse, prompt, isJsonExpected, {}, apiKey || null);

        let data;
        if (isJsonExpected) {
            try { data = parseJsonResponse(rawText); } catch (_) { data = rawText; }
        } else {
            data = rawText;
        }

        return res.json({
            success: true,
            data,
            model_used: modelToUse,
        });
    } catch (err) {
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

module.exports = router;
