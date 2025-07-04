// services/aiService.js

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { OpenAI } = require("openai");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const deepseek = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com/v1",
});

const { getStoryPrompt, getNarrativePrompt, getSummaryPrompt, getPrequelPrompt, getSuggestionPrompt } = require('../prompts/storyPrompt');

// --- 【新增】專門處理串流回應的函式 ---
async function streamAIResponse(modelName, prompt) {
    console.log(`[AI 調度中心] 正在使用模型 (串流模式): ${modelName}`);
    try {
        switch (modelName) {
            case 'openai':
                return await openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: [{ role: "user", content: prompt }],
                    stream: true,
                });
            case 'deepseek':
                return await deepseek.chat.completions.create({
                    model: "deepseek-v2",
                    messages: [{ role: "user", content: prompt }],
                    stream: true,
                });
            case 'gemini':
            default:
                return await geminiModel.generateContentStream(prompt);
        }
    } catch (error) {
        console.error(`[AI 調度中心] 使用模型 ${modelName} (串流) 時出錯:`, error);
        throw new Error(`AI模型 ${modelName} 串流呼叫失敗，請檢查API金鑰與服務狀態。`);
    }
}

// --- 保留的非串流呼叫函式 (給摘要、建議等任務使用) ---
async function callAI(modelName, prompt) {
    console.log(`[AI 調度中心] 正在使用模型 (非串流模式): ${modelName}`);
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
                    model: "deepseek-v2",
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

// --- 各項AI任務 ---

async function getNarrative(modelName, roundData) {
    const prompt = getNarrativePrompt(roundData);
    try {
        return await callAI(modelName, prompt);
    } catch (error) {
        console.error("[AI 任務失敗] 小說家任務:", error);
        return "在那一刻，時間的長河似乎出現了斷層...";
    }
}

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

// 【已修改】getAIStory 現在會回傳一個資料流
async function getAIStory(modelName, longTermSummary, recentHistory, playerAction, userProfile, username, currentTimeOfDay, playerPower) {
    const prompt = getStoryPrompt(longTermSummary, recentHistory, playerAction, userProfile, username, currentTimeOfDay, playerPower);
    try {
        return await streamAIResponse(modelName, prompt);
    } catch (error) {
        console.error("[AI 任務失敗] 故事大師任務 (串流):", error);
        return null; // 如果串流建立失敗，回傳null
    }
}

async function getAIPrequel(modelName, recentHistory) {
    const prompt = getPrequelPrompt(recentHistory);
    try {
        return await callAI(modelName, prompt);
    } catch (error) {
        console.error("[AI 任務失敗] 江湖說書人任務:", error);
        return "江湖說書人今日嗓子不適，未能道出前情提要...";
    }
}

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

module.exports = {
    getNarrative,
    getAISummary,
    getAIStory,
    getAIPrequel,
    getAISuggestion
};
