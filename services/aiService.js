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

// 4. 【新增】Grok
const grok = new OpenAI({
    apiKey: process.env.GROK_API_KEY,
    baseURL: "https://api.x.ai/v1",
});


// 統一的AI調度中心，增加 isJsonExpected 參數
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
                options.model = "gpt-4o";
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
            // 【新增】Grok 的處理邏輯
            case 'grok':
                options.model = "grok-3-mini"; // 使用 grok-3-mini 模型
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


// 任務一：生成小說旁白
async function getNarrative(modelName, roundData) {
    const prompt = getNarrativePrompt(roundData);
    try {
        return await callAI(modelName, prompt, false);
    } catch (error) {
        console.error("[AI 任務失敗] 小說家任務:", error);
        return "在那一刻，時間的長河似乎出現了斷層...";
    }
}

// 任務二：更新長期摘要
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

// 任務三：生成主要故事
async function getAIStory(modelName, longTermSummary, recentHistory, playerAction, userProfile, username, currentTimeOfDay, playerPower, playerMorality) {
    const prompt = getStoryPrompt(longTermSummary, recentHistory, playerAction, userProfile, username, currentTimeOfDay, playerPower, playerMorality);
    try {
        const text = await callAI(modelName, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 故事大師任務:", error);
        return null;
    }
}

// 任務四：生成前情提要
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

// 任務五：生成動作建議
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

// 任務六：生成江湖百科
async function getAIEncyclopedia(modelName, longTermSummary, username) {
    const prompt = getEncyclopediaPrompt(longTermSummary, username);
    try {
        const text = await callAI(modelName, prompt, true);
        const data = parseJsonResponse(text);
        return data.encyclopediaHtml;
    } catch (error) {
        console.error("[AI 任務失敗] 江湖史官任務:", error);
        return `<div class="chapter"><h2 class="chapter-title">錯誤</h2><p class="entry-content">史官在翻閱你的記憶時遇到了困難，暫時無法完成編撰。</p></div>`;
    }
}

// 任務七：生成隨機事件
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

// 【新增】任務八：生成戰鬥回合結果
async function getAICombatAction(modelName, playerProfile, combatState, playerAction) {
    const prompt = getCombatPrompt(playerProfile, combatState, playerAction);
    try {
        // 需要 JSON 回應
        const text = await callAI(modelName, prompt, true);
        return parseJsonResponse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 戰鬥裁判任務:", error);
        // 如果AI失敗，回傳一個表示錯誤的物件，讓後端能提示玩家重試
        return { 
            narrative: "[系統] 戰鬥發生混亂，裁判一時無法看清場上局勢，請你重新下達指令。",
            combatOver: false
        }; 
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
    // 【新增】匯出新的戰鬥函式
    getAICombatAction
};
