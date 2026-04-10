// services/aiService.js
// AI 調度中心 — 僅保留 callAI + getAIGeneratedImage

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { OpenAI } = require("openai");
const Anthropic = require("@anthropic-ai/sdk");

// MiniMax 延遲初始化
let _minimaxClient = null;
function getMinimax() {
    if (!_minimaxClient) {
        _minimaxClient = new OpenAI({
            apiKey: process.env.MINIMAX_API_KEY,
            baseURL: "https://api.minimaxi.chat/v1",
        });
    }
    return _minimaxClient;
}

// 動態建立 AI 客戶端
function createOpenAIClient(apiKey) { return new OpenAI({ apiKey }); }
function createDeepSeekClient(apiKey) { return new OpenAI({ apiKey, baseURL: "https://api.deepseek.com/v1" }); }
function createGrokClient(apiKey) { return new OpenAI({ apiKey, baseURL: "https://api.x.ai/v1", timeout: 30000 }); }
function createAnthropicClient(apiKey) { return new Anthropic({ apiKey }); }
function createGeminiModel(apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    return genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview" });
}

// 全域繁體中文語言規則
const LANG_SYSTEM_RULE = '【語言鐵律】你的所有回應文字（包括 JSON 欄位值）必須全程使用「繁體中文」。嚴格禁止簡體中文字元。允許少量 emoji 來增強氣氛與情緒。';

async function callAI(modelName, prompt, isJsonExpected = false, retryConfig = {}, userApiKey = null) {
    console.log(`[AI 調度中心] model=${modelName} json=${isJsonExpected} userKey=${userApiKey ? '有' : '無'}`);
    try {
        let textResponse = "";
        let options = {
            model: "default",
            messages: [
                { role: "system", content: LANG_SYSTEM_RULE },
                { role: "user", content: prompt }
            ],
        };

        switch (modelName) {
            case 'openai':
            case 'gpt5.4': {
                const key = userApiKey || process.env.OPENAI_API_KEY;
                if (!key) throw new Error('缺少 OpenAI API Key，請在前端設定頁面填寫。');
                const client = createOpenAIClient(key);
                options.model = "gpt-5.4";
                if (isJsonExpected) options.response_format = { type: "json_object" };
                const result = await client.chat.completions.create(options);
                textResponse = result.choices[0].message.content;
                break;
            }
            case 'deepseek': {
                const key = userApiKey || process.env.DEEPSEEK_API_KEY;
                if (!key) throw new Error('缺少 DeepSeek API Key，請在前端設定頁面填寫。');
                const client = createDeepSeekClient(key);
                options.model = "deepseek-chat";
                if (isJsonExpected) options.response_format = { type: "json_object" };
                const result = await client.chat.completions.create(options);
                textResponse = result.choices[0].message.content;
                break;
            }
            case 'grok': {
                const key = userApiKey || process.env.GROK_API_KEY;
                if (!key) throw new Error('缺少 Grok API Key，請在前端設定頁面填寫。');
                const client = createGrokClient(key);
                options.model = "grok-4.20";
                if (isJsonExpected) options.response_format = { type: "json_object" };
                const result = await client.chat.completions.create(options);
                textResponse = result.choices[0].message.content;
                break;
            }
            case 'gemini': {
                const key = userApiKey || process.env.GOOGLE_API_KEY;
                if (!key) throw new Error('缺少 Google Gemini API Key，請在前端設定頁面填寫。');
                const model = createGeminiModel(key);
                const generationConfig = {};
                if (isJsonExpected) generationConfig.response_mime_type = "application/json";
                const geminiResult = await model.generateContent(prompt, generationConfig);
                textResponse = (await geminiResult.response).text();
                break;
            }
            case 'gemma': {
                const key = userApiKey || process.env.GOOGLE_API_KEY;
                if (!key) throw new Error('缺少 Google API Key，請在前端設定頁面填寫。');
                const genAI = new GoogleGenerativeAI(key);
                const gemmaModel = genAI.getGenerativeModel({ model: "gemma-4-31b-it" });
                const gemmaConfig = {};
                if (isJsonExpected) gemmaConfig.response_mime_type = "application/json";
                const gemmaResult = await gemmaModel.generateContent(prompt, gemmaConfig);
                textResponse = (await gemmaResult.response).text();
                break;
            }
            case 'cluade':
            case 'claude': {
                const key = userApiKey || process.env.ANTHROPIC_API_KEY;
                if (!key) throw new Error('缺少 Anthropic Claude API Key，請在前端設定頁面填寫。');
                const client = createAnthropicClient(key);
                const claudeOptions = {
                    model: "claude-opus-4-6",
                    max_tokens: 4096,
                    messages: [{ role: "user", content: prompt }],
                };
                if (isJsonExpected) {
                    claudeOptions.system = LANG_SYSTEM_RULE + "\n\nYour response must be a single, valid JSON object and nothing else.";
                }
                const claudeResult = await client.messages.create(claudeOptions);
                textResponse = claudeResult.content[0].text;
                break;
            }
            case 'minimax':
            default:
                if (modelName !== 'minimax') {
                    console.log(`[AI 調度中心] 未知模型 '${modelName}'，使用 minimax`);
                }
                options.model = "MiniMax-M2.7";
                options.max_tokens = 2048;
                if (isJsonExpected) options.response_format = { type: "json_object" };
                const minimaxResult = await getMinimax().chat.completions.create(options);
                textResponse = minimaxResult.choices[0].message.content;
                textResponse = textResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        }
        return textResponse;
    } catch (error) {
        const detail = error?.message || String(error);
        console.error(`[AI 調度中心] ${modelName} 出錯:`, detail);
        throw new Error(`AI模型 ${modelName} 呼叫失敗: ${detail}`);
    }
}

async function getAIGeneratedImage(prompt) {
    try {
        const key = process.env.OPENAI_API_KEY;
        if (!key) return null;
        const client = createOpenAIClient(key);
        const response = await client.images.generate({
            model: "dall-e-3",
            prompt,
            n: 1,
            size: "1024x1024",
            quality: "hd",
            style: "vivid",
        });
        return response.data[0].url;
    } catch (error) {
        console.error('[AI 畫師] 圖片生成失敗:', error.message);
        return null;
    }
}

function parseJsonResponse(text) {
    let cleaned = text;
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '');
    cleaned = cleaned.replace(/^```json\s*|```\s*$/g, '');
    cleaned = cleaned.trim();
    return JSON.parse(cleaned);
}

module.exports = { callAI, getAIGeneratedImage, parseJsonResponse };
