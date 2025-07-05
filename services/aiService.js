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

// --- 從 prompts 資料夾導入腳本 ---
const { getStoryPrompt } = require('../prompts/storyPrompt');
const { getNarrativePrompt } = require('../prompts/narrativePrompt');
const { getSummaryPrompt } = require('../prompts/summaryPrompt');
const { getPrequelPrompt } = require('../prompts/prequelPrompt');
const { getSuggestionPrompt } = require('../prompts/suggestionPrompt');
// 【新增】導入我們新建立的百科指令稿
const { getEncyclopediaPrompt } = require('../prompts/encyclopediaPrompt');


// 統一的AI調度中心
async function callAI(modelName, prompt) {
    console.log(`[AI 調度中心] 正在使用模型: ${modelName}`);
    try {
        let textResponse = "";
        switch (modelName) {
            case 'openai':
                const openaiResult = await openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: [{ role: "user", content: prompt }],
                    // 【新增】確保 OpenAI 回應是 JSON 格式
                    response_format: { type: "json_object" },
                });
                textResponse = openaiResult.choices[0].message.content;
                break;
            case 'deepseek':
                const deepseekResult = await deepseek.chat.completions.create({
                    model: "deepseek-chat",
                    messages: [{ role: "user", content: prompt }],
                    // 【新增】確保 DeepSeek 回應是 JSON 格式
                    response_format: { type: "json_object" },
                });
                textResponse = deepseekResult.choices[0].message.content;
                break;
            case 'gemini':
            default:
                // 【修改】告知 Gemini 我們期望得到 JSON 回應
                const generationConfig = { response_mime_type: "application/json" };
                const geminiResult = await geminiModel.generateContent(prompt, generationConfig);
                textResponse = (await geminiResult.response).text();
        }
        return textResponse;
    } catch (error) {
        console.error(`[AI 調度中心] 使用模型 ${modelName} 時出錯:`, error);
        throw new Error(`AI模型 ${modelName} 呼叫失敗，請檢查API金鑰與服務狀態。`);
    }
}

// 任務一：生成小說旁白
async function getNarrative(modelName, roundData) {
    const prompt = getNarrativePrompt(roundData);
    try {
        return await callAI(modelName, prompt);
    } catch (error) {
        console.error("[AI 任務失敗] 小說家任務:", error);
        return "在那一刻，時間的長河似乎出現了斷層...";
    }
}

// 任務二：更新長期摘要
async function getAISummary(modelName, oldSummary, newRoundData) {
    const prompt = getSummaryPrompt(oldSummary, newRoundData);
    try {
        const text = await callAI(modelName, prompt);
        // 因為已要求 AI 回傳 JSON，所以不再需要清理 ```json 標籤
        return JSON.parse(text).summary;
    } catch (error) {
        console.error("[AI 任務失敗] 檔案管理員任務:", error);
        return oldSummary;
    }
}

// 任務三：生成主要故事
async function getAIStory(modelName, longTermSummary, recentHistory, playerAction, userProfile, username, currentTimeOfDay, playerPower, playerMorality) {
    const prompt = getStoryPrompt(longTermSummary, recentHistory, playerAction, userProfile, username, currentTimeOfDay, playerPower, playerMorality);
    try {
        const text = await callAI(modelName, prompt);
        // 因為已要求 AI 回傳 JSON，所以不再需要清理 ```json 標籤
        return JSON.parse(text);
    } catch (error) {
        console.error("[AI 任務失敗] 故事大師任務:", error);
        return null;
    }
}

// 任務四：生成前情提要
async function getAIPrequel(modelName, recentHistory) {
    const prompt = getPrequelPrompt(recentHistory);
    try {
        const text = await callAI(modelName, prompt);
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
        const text = await callAI(modelName, prompt);
        return text.replace(/["“”]/g, '');
    } catch (error) {
        console.error("[AI 任務失敗] 機靈書僮任務:", error);
        return null;
    }
}

// 【新增】任務六：生成江湖百科
async function getAIEncyclopedia(modelName, longTermSummary, username) {
    const prompt = getEncyclopediaPrompt(longTermSummary, username);
    try {
        const text = await callAI(modelName, prompt);
        const data = JSON.parse(text);
        return data.encyclopediaHtml;
    } catch (error) {
        console.error("[AI 任務失敗] 江湖史官任務:", error);
        // 如果AI失敗，回傳一段錯誤提示HTML
        return `<div class="chapter"><h2 class="chapter-title">錯誤</h2><p class="entry-content">史官在翻閱你的記憶時遇到了困難，暫時無法完成編撰。</p></div>`;
    }
}


// 匯出所有服務函式
module.exports = {
    getNarrative,
    getAISummary,
    getAIStory,
    getAIPrequel,
    getAISuggestion,
    // 【新增】匯出新的百科函式
    getAIEncyclopedia
};
