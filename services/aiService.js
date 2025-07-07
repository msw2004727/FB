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
            default:
                const generationConfig = {};
                if (isJsonExpected) {
                    generationConfig.response_mime_type = "application/json";
                }
                const geminiResult = await geminiModel.generateContent(prompt, generationConfig);
                textResponse = (await geminiResult.response).text();
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


async function getNarrative(modelName, roundData) {
    const prompt = getNarrativePrompt(roundData);
    try {
        return await callAI(modelName, prompt, false);
    } catch (error) {
        console.error("[AI 任務失敗] 小說家任務:", error);
        return "在那一刻，時間的長河似乎出現了斷層...";
    }
}

async function getAISummary(modelName, oldSummary, newRoundData) {
    const prompt = getSummaryPrompt(oldSummary, newRoundData);
    try {
        const text = await callAI(modelName, prompt, true);
        return parseJsonResponse(text).summary;
    } catch (error) {
        console.error("[AI 任務失敗] 檔案管理員任務:", error);
        return oldSummary;
    }
}

async function getAIStory(modelName, longTermSummary, recentHistory, playerAction, userProfile, username, currentTimeOfDay, playerPower, playerMorality, levelUpEvents) {
    const prompt = getStoryPrompt(longTermSummary, recentHistory, playerAction, userProfile, username, currentTimeOfDay, playerPower, playerMorality, levelUpEvents);
    try {
        const text = await callAI(modelName, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 故事大師任務:", error);
        return null;
    }
}

async function getAIPrequel(modelName, recentHistory) {
    const prompt = getPrequelPrompt(recentHistory);
    try {
        const text = await callAI(modelName, prompt, false);
        return text;
    } catch (error) {
        console.error("[AI 任務失敗] 江湖說書人任務:", error);
        return "江湖說書人今日嗓子不適，未能道出前情提要...";
    }
}

async function getAISuggestion(modelName, roundData) {
    const prompt = getSuggestionPrompt(roundData);
    try {
        const text = await callAI(modelName, prompt, false);
        return text.replace(/["“”]/g, '');
    } catch (error) {
        console.error("[AI 任務失敗] 機靈書僮任務:", error);
        return null;
    }
}

async function getAIEncyclopedia(modelName, longTermSummary, username, npcDetails) {
    const prompt = getEncyclopediaPrompt(longTermSummary, username, npcDetails);
    try {
        const text = await callAI(modelName, prompt, true);
        const data = parseJsonResponse(text);
        return data.encyclopediaHtml;
    } catch (error) {
        console.error("[AI 任務失敗] 江湖史官任務:", error);
        return `<div class="chapter"><h2 class="chapter-title">錯誤</h2><p class="entry-content">史官在翻閱你的記憶時遇到了困難，暫時無法完成編撰。</p></div>`;
    }
}

async function getAIRandomEvent(modelName, eventType, playerProfile) {
    const prompt = getRandomEventPrompt(eventType, playerProfile);
    try {
        const text = await callAI(modelName, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 司命星君任務:", error);
        return null;
    }
}

async function getAINpcProfile(modelName, username, npcName, roundData) {
    const prompt = getNpcCreatorPrompt(username, npcName, roundData);
    try {
        const text = await callAI(modelName, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 人物設定師任務:", error);
        return null;
    }
}

async function getAIChatResponse(modelName, npcProfile, chatHistory, playerMessage, longTermSummary) {
    const prompt = getChatMasterPrompt(npcProfile, chatHistory, playerMessage, longTermSummary);
    try {
        const reply = await callAI(modelName, prompt, false);
        return reply.replace(/["“”]/g, '');
    } catch (error) {
        console.error("[AI 任務失敗] 聊天大師任務:", error);
        return "（他似乎心事重重，沒有回答你。）";
    }
}

async function getAIChatSummary(modelName, username, npcName, fullChatHistory) {
    const prompt = getChatSummaryPrompt(username, npcName, fullChatHistory);
    try {
        const summary = await callAI(modelName, prompt, false);
        return summary.replace(/["“”]/g, '');
    } catch (error) {
        console.error("[AI 任務失敗] 摘要師任務:", error);
        return `我與${npcName}進行了一番交談。`;
    }
}

async function getAICombatAction(modelName, playerProfile, combatState, playerAction) {
    const prompt = getCombatPrompt(playerProfile, combatState, playerAction);
    try {
        const text = await callAI(modelName, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 戰鬥裁判任務:", error);
        return {
            narrative: "[系統] 戰鬥發生混亂，裁判一時無法看清場上局勢，請你重新下達指令。",
            combatOver: false
        };
    }
}

async function getAIGiveItemResponse(modelName, playerProfile, npcProfile, itemInfo) {
    const prompt = getGiveItemPrompt(playerProfile, npcProfile, itemInfo);
    try {
        const text = await callAI(modelName, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 江湖交際大師任務:", error);
        return {
            npc_response: "（他看著你送出的東西，一時語塞，不知該如何是好。）",
            friendlinessChange: 0
        };
    }
}

async function getAINarrativeForGive(modelName, lastRoundData, playerName, npcName, itemName, npcResponse) {
    const prompt = getGiveNarrativePrompt(lastRoundData, playerName, npcName, itemName, npcResponse);
    try {
        return await callAI(modelName, prompt, false);
    } catch (error) {
        console.error("[AI 任務失敗] 贈予事件小說家任務:", error);
        return `你將${itemName}給了${npcName}。`;
    }
}

async function getRelationGraph(modelName, longTermSummary, username, npcDetails) {
    const prompt = getRelationGraphPrompt(longTermSummary, username, npcDetails);
    try {
        const text = await callAI(modelName, prompt, true);
        return parseJsonResponse(text).mermaidSyntax;
    } catch (error) {
        console.error("[AI 任務失敗] 關係圖百曉生任務:", error);
        return "graph TD;\nA[錯誤]; A-->B[無法生成關係圖];";
    }
}

async function getAIRomanceEvent(modelName, playerProfile, npcProfile, eventType) {
    const prompt = getRomanceEventPrompt(playerProfile, npcProfile, eventType);
    try {
        return await callAI(modelName, prompt, false);
    } catch (error) {
        console.error("[AI 任務失敗] 言情小說家任務:", error);
        return `\n你與${npcProfile.name}的緣分，似乎在悄然間發生了些許變化，但具體是何種變化，卻又難以言說。`;
    }
}

async function getAIEpilogue(modelName, playerData) {
    const prompt = getEpiloguePrompt(playerData);
    try {
        const story = await callAI(modelName, prompt, false);
        return story;
    } catch (error) {
        console.error(`[AI 任務失敗] 史官司馬遷任務 for ${playerData.username}:`, error);
        return `江湖路遠，${playerData.username}的身影就此消逝在歷史的長河中。關於${playerData.deathInfo.cause}的傳聞眾說紛紜，但終究無人能窺其全貌。${playerData.finalStats.gender === 'female' ? '她' : '他'}的親友與仇敵，也隨著時間的流逝，各自走向了不同的命運。斯人已逝，徒留傳說，供後人茶餘飯後，偶爾談說。`;
    }
}

async function getAIDeathCause(modelName, username, lastRoundData) {
    const prompt = getDeathCausePrompt(username, lastRoundData);
    try {
        const cause = await callAI(modelName, prompt, false);
        return cause.replace(/["“”]/g, '');
    } catch (error) {
        console.error(`[AI 任務失敗] 司命星君任務 for ${username}:`, error);
        return "似乎是積勞成疾，舊傷復發，在睡夢中安然離世。";
    }
}

async function getAIActionClassification(modelName, playerAction, context) {
    const prompt = getActionClassifierPrompt(playerAction, context);
    try {
        const text = await callAI(modelName, prompt, true);
        return JSON.parse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 總導演AI任務:", error);
        return { actionType: 'GENERAL_STORY', details: {} };
    }
}


// 匯出所有服務函式
module.exports = {
    getNarrative,
    getAISummary,
    getAIStory,
    getAIPrequel,
    getAISuggestion,
    getAIEncyclopedia,
    getAIRandomEvent,
    getAINpcProfile,
    getAICombatAction,
    getAIChatResponse,
    getAIChatSummary,
    getAIGiveItemResponse,
    getAINarrativeForGive,
    getRelationGraph,
    getAIRomanceEvent,
    getAIEpilogue,
    getAIDeathCause,
    getAIActionClassification,
};
