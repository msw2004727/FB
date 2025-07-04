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
const { getSuggestionPrompt } = require('../prompts/suggestionPrompt'); // 【新增】導入動作建議指令

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
                });
                textResponse = openaiResult.choices[0].message.content;
                break;
            case 'deepseek':
                const deepseekResult = await deepseek.chat.completions.create({
                    model: "deepseek-chat",
                    messages: [{ role: "user", content: prompt }],
                });
                textResponse = deepseekResult.choices[0].message.content;
                break;
            case 'gemini':
            default:
                const geminiResult = await geminiModel.generateContent(prompt);
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
        const cleanJsonText = text.replace(/^```json\s*|```\s*$/g, '');
        return JSON.parse(cleanJsonText).summary;
    } catch (error) {
        console.error("[AI 任務失敗] 檔案管理員任務:", error);
        return oldSummary;
    }
}

// 任務三：生成主要故事
async function getAIStory(modelName, longTermSummary, recentHistory, playerAction, userProfile) {
    const prompt = getStoryPrompt(longTermSummary, recentHistory, playerAction, userProfile);
    try {
        const text = await callAI(modelName, prompt);
        const cleanJsonText = text.replace(/^```json\s*|```\s*$/g, '');
        return JSON.parse(cleanJsonText);
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
        return null;
    }
}

// 【新增】任務五：生成動作建議
async function getAISuggestion(modelName, roundData) {
    const prompt = getSuggestionPrompt(roundData);
    try {
        const text = await callAI(modelName, prompt);
        // 去除可能的引號
        return text.replace(/["“”]/g, '');
    } catch (error) {
        console.error("[AI 任務失敗] 機靈書僮任務:", error);
        return null;
    }
}


// 匯出所有服務函式
module.exports = {
    getNarrative,
    getAISummary,
    getAIStory,
    getAIPrequel,
    getAISuggestion // 【新增】匯出新函式
};
