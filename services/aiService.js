// services/aiService.js

// --- AI SDK 初始化 ---
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { OpenAI } = require("openai");

// 1. Google Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});

// 2. OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 3. DeepSeek
const deepseek = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com/v1",
});

// 4. Grok
const grok = new OpenAI({
    apiKey: process.env.GROK_API_KEY,
    baseURL: "https://api.x.ai/v1",
    timeout: 30 * 1000,
});

const { aiConfig } = require('../api/aiConfig.js');

// --- 從 prompts 資料夾導入腳本 ---
const { getStoryPrompt } = require('../prompts/storyPrompt.js');
const { getNarrativePrompt } = require('../prompts/narrativePrompt.js');
const { getSummaryPrompt } = require('../prompts/summaryPrompt.js');
const { getPrequelPrompt } = require('../prompts/prequelPrompt.js');
const { getSuggestionPrompt } = require('../prompts/suggestionPrompt.js');
const { getEncyclopediaPrompt } = require('../prompts/encyclopediaPrompt.js');
const { getRandomEventPrompt } = require('../prompts/randomEventPrompt.js');
const { getCombatPrompt } = require('../prompts/combatPrompt.js');
const { getNpcCreatorPrompt } = require('../prompts/npcCreatorPrompt.js');
const { getChatMasterPrompt } = require('../prompts/chatMasterPrompt.js');
const { getChatSummaryPrompt } = require('../prompts/chatSummaryPrompt.js');
const { getGiveItemPrompt } = require('../prompts/giveItemPrompt.js');
const { getAINarrativeForGive: getGiveNarrativePrompt } = require('../prompts/narrativeForGivePrompt.js');
const { getRelationGraphPrompt } = require('../prompts/relationGraphPrompt.js');
const { getRomanceEventPrompt } = require('../prompts/romanceEventPrompt.js');
const { getEpiloguePrompt } = require('../prompts/epiloguePrompt.js');
const { getDeathCausePrompt } = require('../prompts/deathCausePrompt.js');
const { getActionClassifierPrompt } = require('../prompts/actionClassifierPrompt.js');
const { getSurrenderPrompt } = require('../prompts/surrenderPrompt.js');
const { getProactiveChatPrompt } = require('../prompts/proactiveChatPrompt.js');
const { getCombatSetupPrompt } = require('../prompts/combatSetupPrompt.js');
const { getAnachronismPrompt } = require('../prompts/anachronismPrompt.js');
const { getAIPostCombatResultPrompt } = require('../prompts/postCombatPrompt.js');
const { getNpcMemoryPrompt } = require('../prompts/npcMemoryPrompt.js'); // 新增


// 統一的AI調度中心
async function callAI(modelName, prompt, isJsonExpected = false) {
    console.log(`[AI 調度中心] 正在使用模型: ${modelName}, 是否期望JSON: ${isJsonExpected}`);
    try {
        let textResponse = "";
        let options = {
            model: "default",
            messages: [{ role: "user", content: prompt }],
        };

        switch (modelName) {
            case 'openai':
                options.model = "gpt-4.1-mini";
                if (isJsonExpected) {
                    options.response_format = { type: "json_object" };
                }
                const openaiResult = await openai.chat.completions.create(options);
                textResponse = openaiResult.choices[0].message.content;
                break;
            case 'deepseek':
                options.model = "deepseek-chat";
                if (isJsonExpected) {
                    options.response_format = { type: "json_object" };
                }
                const deepseekResult = await deepseek.chat.completions.create(options);
                textResponse = deepseekResult.choices[0].message.content;
                break;
            case 'grok':
                options.model = "grok-3-fast";
                if (isJsonExpected) {
                    options.response_format = { type: "json_object" };
                }
                const grokResult = await grok.chat.completions.create(options);
                textResponse = grokResult.choices[0].message.content;
                break;
            case 'gemini':
                const generationConfig = {};
                if (isJsonExpected) {
                    generationConfig.response_mime_type = "application/json";
                }
                const geminiResult = await geminiModel.generateContent(prompt, generationConfig);
                textResponse = (await geminiResult.response).text();
                break;
            default:
                console.log(`[AI 調度中心] 未知模型名稱 '${modelName}'，已自動切換至 'openai'。`);
                options.model = "gpt-4.1-mini";
                if (isJsonExpected) {
                    options.response_format = { type: "json_object" };
                }
                const defaultResult = await openai.chat.completions.create(options);
                textResponse = defaultResult.choices[0].message.content;
        }
        return textResponse;
    } catch (error) {
        console.error(`[AI 調度中心] 使用模型 ${modelName} 時出錯:`, error);
        throw new Error(`AI模型 ${modelName} 呼叫失敗，請檢查API金鑰與服務狀態。`);
    }
}

// 清理並解析JSON的輔助函式
function parseJsonResponse(text) {
    const cleanJsonText = text.replace(/^```json\s*|```\s*$/g, '');
    return JSON.parse(cleanJsonText);
}

// 新增的函式，專門處理時代錯置的回應
async function getAIAnachronismResponse(playerModelChoice, playerAction, anachronisticItem) {
    const prompt = getAnachronismPrompt(playerAction, anachronisticItem);
    try {
        const modelToUse = playerModelChoice || aiConfig.narrative || 'openai';
        const response = await callAI(modelToUse, prompt, false);
        return response.replace(/["“”]/g, '');
    } catch (error) {
        console.error("[AI 任務失敗] 時空守序者任務:", error);
        return "你腦中閃過一個不屬於這個時代的念頭，但很快便將其甩開，專注於眼前的江湖事。";
    }
}


async function getNarrative(roundData) {
    const prompt = getNarrativePrompt(roundData);
    try {
        return await callAI(aiConfig.narrative, prompt, false);
    } catch (error) {
        console.error("[AI 任務失敗] 小說家任務:", error);
        return "在那一刻，時間的長河似乎出現了斷層...";
    }
}

async function getAISummary(oldSummary, newRoundData) {
    const prompt = getSummaryPrompt(oldSummary, newRoundData);
    try {
        const text = await callAI(aiConfig.summary, prompt, true);
        return parseJsonResponse(text).summary;
    } catch (error) {
        console.error("[AI 任務失敗] 檔案管理員任務:", error);
        return oldSummary;
    }
}

async function getAIStory(playerModelChoice, longTermSummary, recentHistory, playerAction, userProfile, username, currentTimeOfDay, playerPower, playerMorality, levelUpEvents, romanceEventToWeave, worldEventToWeave, locationContext, npcContext, playerBulkScore, actorCandidates) {
    const prompt = getStoryPrompt(longTermSummary, recentHistory, playerAction, userProfile, username, currentTimeOfDay, playerPower, playerMorality, levelUpEvents, romanceEventToWeave, worldEventToWeave, locationContext, npcContext, playerBulkScore, actorCandidates);
    try {
        const modelToUse = playerModelChoice || aiConfig.story;
        const text = await callAI(modelToUse, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 故事大師任務:", error);
        return null;
    }
}

async function getAIPrequel(playerModelChoice, recentHistory) {
    const prompt = getPrequelPrompt(recentHistory);
    try {
        const modelToUse = playerModelChoice || aiConfig.prequel;
        const text = await callAI(modelToUse, prompt, false);
        return text;
    } catch (error) {
        console.error("[AI 任務失敗] 江湖說書人任務:", error);
        return "江湖說書人今日嗓子不適，未能道出前情提要...";
    }
}

async function getAISuggestion(roundData) {
    const prompt = getSuggestionPrompt(roundData);
    try {
        const text = await callAI(aiConfig.suggestion, prompt, false);
        return text.replace(/["“”]/g, '');
    } catch (error) {
        console.error("[AI 任務失敗] 機靈書僮任務:", error);
        return null;
    }
}

async function getAIEncyclopedia(longTermSummary, username, npcDetails) {
    const prompt = getEncyclopediaPrompt(longTermSummary, username, npcDetails);
    try {
        const text = await callAI(aiConfig.encyclopedia, prompt, true);
        return parseJsonResponse(text).encyclopediaHtml;
    } catch (error) {
        console.error("[AI 任務失敗] 江湖史官任務:", error);
        return `<div class="chapter"><h2 class="chapter-title">錯誤</h2><p class="entry-content">史官在翻閱你的記憶時遇到了困難，暫時無法完成編撰。</p></div>`;
    }
}

async function getAIRandomEvent(eventType, playerProfile) {
    const prompt = getRandomEventPrompt(eventType, playerProfile);
    try {
        const text = await callAI(aiConfig.randomEvent, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 司命星君任務:", error);
        return null;
    }
}

async function getAINpcProfile(username, npcName, roundData, playerProfile) {
    const prompt = getNpcCreatorPrompt(username, npcName, roundData, playerProfile);
    try {
        const text = await callAI(aiConfig.npcProfile, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 人物設定師任務:", error);
        return null;
    }
}

async function getAIChatResponse(playerModelChoice, npcProfile, chatHistory, playerMessage, longTermSummary, localLocationContext, mentionedNpcContext) {
    const prompt = getChatMasterPrompt(npcProfile, chatHistory, playerMessage, longTermSummary, localLocationContext, mentionedNpcContext);
    try {
        const modelToUse = playerModelChoice || aiConfig.npcChat;
        const reply = await callAI(modelToUse, prompt, false);
        return reply.replace(/["“”]/g, '');
    } catch (error) {
        console.error("[AI 任務失敗] 聊天大師任務:", error);
        return "（他似乎心事重重，沒有回答你。）";
    }
}

async function getAIChatSummary(playerModelChoice, username, npcName, fullChatHistory, longTermSummary) {
    const prompt = getChatSummaryPrompt(username, npcName, fullChatHistory, longTermSummary);
    try {
        const modelToUse = playerModelChoice || aiConfig.npcChatSummary;
        const text = await callAI(modelToUse, prompt, true); // 要求回傳JSON
        return parseJsonResponse(text); // 解析JSON
    } catch (error) {
        console.error("[AI 任務失敗] 摘要師任務:", error);
        return {
            story: `你與${npcName}進行了一番交談，但其中的細節已隨風而逝，只留下模糊的印象。`,
            evt: `與${npcName}的一席話`
        };
    }
}

// 新增：更新NPC個人記憶的函式
async function getAIPerNpcSummary(playerModelChoice, npcName, oldSummary, fullChatHistory) {
    const prompt = getNpcMemoryPrompt(npcName, oldSummary, fullChatHistory);
    try {
        const modelToUse = playerModelChoice || aiConfig.npcMemory || 'openai';
        const text = await callAI(modelToUse, prompt, true);
        return parseJsonResponse(text).newSummary;
    } catch (error) {
        console.error(`[AI 任務失敗] 為 ${npcName} 更新個人記憶時出錯:`, error);
        return oldSummary; // 出錯時返回舊摘要，避免資料遺失
    }
}

async function getAICombatAction(playerModelChoice, playerProfile, combatState, playerAction) {
    const prompt = getCombatPrompt(playerProfile, combatState, playerAction);
    try {
        const modelToUse = playerModelChoice || aiConfig.combat;
        const text = await callAI(modelToUse, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 戰鬥裁判任務:", error);
        return {
            narrative: "[系統] 戰鬥發生混亂，裁判一時無法看清場上局勢，請你重新下達指令。",
            combatOver: false
        };
    }
}

async function getAICombatSetup(playerAction, lastRoundData) {
    const prompt = getCombatSetupPrompt(playerAction, lastRoundData);
    try {
        const modelToUse = aiConfig.combatSetup || 'openai';
        const text = await callAI(modelToUse, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 戰鬥導演任務:", error);
        return {
            combatants: [{ name: "未知敵人", status: "怒不可遏！" }],
            allies: [],
            bystanders: [],
            combatIntro: "一場混亂的戰鬥爆發了，但場上局勢無人能看清！"
        };
    }
}


async function getAIGiveItemResponse(playerModelChoice, playerProfile, npcProfile, itemInfo) {
    const prompt = getGiveItemPrompt(playerProfile, npcProfile, itemInfo);
    try {
        const modelToUse = playerModelChoice || aiConfig.giveItem;
        const text = await callAI(modelToUse, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 江湖交際大師任務:", error);
        return {
            npc_response: "（他看著你送出的東西，一時語塞，不知該如何是好。）",
            friendlinessChange: 0,
            itemChanges: []
        };
    }
}

async function getAINarrativeForGive(lastRoundData, playerName, npcName, itemName, npcResponse) {
    const prompt = getGiveNarrativePrompt(lastRoundData, playerName, npcName, itemName, npcResponse);
    try {
        return await callAI(aiConfig.giveNarrative, prompt, false);
    } catch (error) {
        console.error("[AI 任務失敗] 贈予事件小說家任務:", error);
        return `你將${itemName}給了${npcName}。`;
    }
}

async function getRelationGraph(longTermSummary, username, npcDetails) {
    const prompt = getRelationGraphPrompt(longTermSummary, username, npcDetails);
    try {
        const text = await callAI(aiConfig.relationGraph, prompt, true);
        return parseJsonResponse(text).mermaidSyntax;
    } catch (error) {
        console.error("[AI 任務失敗] 關係圖百曉生任務:", error);
        return "graph TD;\nA[錯誤]; A-->B[無法生成關係圖];";
    }
}

async function getAIRomanceEvent(playerProfile, npcProfile, eventType) {
    const prompt = getRomanceEventPrompt(playerProfile, npcProfile, eventType);
    try {
        const text = await callAI(aiConfig.romanceEvent, prompt, true);
        const jsonObj = parseJsonResponse(text);
        return JSON.stringify(jsonObj);
    } catch (error) {
        console.error("[AI 任務失敗] 言情小說家任務:", error);
        return "{}";
    }
}

async function getAIEpilogue(playerData) {
    const prompt = getEpiloguePrompt(playerData);
    try {
        const modelToUse = aiConfig.epilogue || 'openai';
        const story = await callAI(modelToUse, prompt, false);
        return story;
    } catch (error) {
        console.error(`[AI 任務失敗] 史官司馬遷任務 for ${playerData.username}:`, error);
        return `江湖路遠，${playerData.username}的身影就此消逝在歷史的長河中。關於${playerData.deathInfo.cause}的傳聞眾說紛紜，但終究無人能窺其全貌。${playerData.finalStats.gender === 'female' ? '她' : '他'}的親友與仇敵，也隨著時間的流逝，各自走向了不同的命運。斯人已逝，徒留傳說，供後人茶餘飯後，偶爾談說。`;
    }
}

async function getAIDeathCause(playerModelChoice, username, lastRoundData) {
    const prompt = getDeathCausePrompt(username, lastRoundData);
    try {
        const modelToUse = playerModelChoice || aiConfig.deathCause;
        const cause = await callAI(modelToUse, prompt, false);
        return cause.replace(/["“”]/g, '');
    } catch (error) {
        console.error(`[AI 任務失敗] 司命星君任務 for ${username}:`, error);
        return "似乎是積勞成疾，舊傷復發，在睡夢中安然離世。";
    }
}

async function getAIActionClassification(playerModelChoice, playerAction, context) {
    const prompt = getActionClassifierPrompt(playerAction, context);
    try {
        const modelToUse = playerModelChoice || aiConfig.actionClassifier;
        const text = await callAI(modelToUse, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 總導演AI任務:", error);
        return { actionType: 'GENERAL_STORY', details: {} };
    }
}

async function getAISurrenderResult(playerModelChoice, playerProfile, combatState) {
    const prompt = getSurrenderPrompt(playerProfile, combatState);
    try {
        const modelToUse = playerModelChoice || aiConfig.surrender;
        const text = await callAI(modelToUse, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 談判專家任務:", error);
        return {
            accepted: false,
            narrative: "你試圖認輸，但對方殺氣騰騰，似乎沒有任何商量的餘地，系統暫時無法判斷其意圖，請你繼續戰鬥。",
            outcome: null
        };
    }
}

async function getAIProactiveChat(playerProfile, npcProfile, triggerEvent) {
    const prompt = getProactiveChatPrompt(playerProfile, npcProfile, triggerEvent);
    try {
        const text = await callAI(aiConfig.proactiveChat, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 首席編劇任務:", error);
        return {
            openingLine: "（他/她看了你一眼，欲言又止，最終還是什麼也沒說。）",
            itemChanges: []
        };
    }
}

async function getAIPostCombatResult(playerModelChoice, playerProfile, finalCombatState, combatLog, killerName) {
    const prompt = getAIPostCombatResultPrompt(playerProfile, finalCombatState, combatLog, killerName);
    try {
        const modelToUse = playerModelChoice || aiConfig.postCombat || 'openai';
        const text = await callAI(modelToUse, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 戰場清掃者任務:", error);
        const playerWon = finalCombatState.enemies.every(e => e.hp <= 0);
        return {
            narrative: playerWon ? "你擊敗了對手，但四周一片狼藉，空氣中瀰漫著血腥味，讓你一時無法回神。" : "你眼前一黑，重重地倒在地上，失去了知覺。",
            outcome: {
                summary: playerWon ? "你贏得了戰鬥。" : "你被擊敗了。",
                playerChanges: {
                    PC: playerWon ? "你雖然獲勝，但也消耗了大量體力，感到有些疲憊。" : "你身受重傷，氣息奄奄。",
                },
                itemChanges: [],
                npcUpdates: []
            }
        };
    }
}


module.exports = {
    callAI,
    aiConfig,
    getNarrative,
    getAISummary,
    getAIStory,
    getAIPrequel,
    getAISuggestion,
    getAIEncyclopedia,
    getAIRandomEvent,
    getAINpcProfile,
    getAICombatAction,
    getAICombatSetup,
    getAIChatResponse,
    getAIChatSummary,
    getAIGiveItemResponse,
    getAINarrativeForGive,
    getRelationGraph,
    getAIRomanceEvent,
    getAIEpilogue,
    getAIDeathCause,
    getAIActionClassification,
    getAISurrenderResult,
    getAIProactiveChat,
    getAIAnachronismResponse,
    getAIPostCombatResult,
    getAIPerNpcSummary, // 匯出新函式
};
