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
        const prompt = getStoryPrompt(
            ctx.longTermSummary,
            ctx.recentHistory,
            ctx.playerAction,
            ctx.userProfile,
            ctx.username,
            ctx.currentTimeOfDay,
            ctx.playerPower,
            ctx.playerMorality,
            ctx.levelUpEvents,
            ctx.romanceEventToWeave,
            ctx.worldEventToWeave,
            ctx.locationContext,
            ctx.npcContext,
            ctx.playerBulkScore,
            ctx.actorCandidates,
            ctx.blackShadowEvent
        );
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

        // Build prompt from context
        const { prompt, json: isJsonExpected, configKey } = handler(context);

        // Determine which model to use: explicit request > aiConfig default > minimax
        const modelToUse = model || aiConfig[configKey] || 'minimax';

        console.log(`[AI Proxy] task="${task}" model="${modelToUse}" json=${isJsonExpected} hasUserKey=${!!apiKey}`);

        // Call the AI (pass user-provided API key if present)
        const rawText = await callAI(modelToUse, prompt, isJsonExpected, {}, apiKey || null);

        // Try to parse JSON if expected; otherwise return raw text
        let data;
        if (isJsonExpected) {
            try {
                data = parseJsonResponse(rawText);
            } catch (_parseErr) {
                // Return raw text if JSON parsing fails -- let the client handle it
                data = rawText;
            }
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
