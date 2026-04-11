// client/ai/aiProxy.js
// AI Proxy 客戶端 — 負責與 AI Proxy 伺服器通訊

const PROXY_URL_KEY = 'wenjiang_ai_proxy_url';
const API_KEY_PREFIX = 'fb_ai_apikey_';

// 自動偵測：如果在 localhost 開發，預設連本機 AI Proxy；否則連線上版
function detectDefaultProxyUrl() {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
        return 'http://localhost:3001';
    }
    return 'https://wenjiang-ai-proxy-322557520154.us-central1.run.app';
}

function getProxyUrl() {
    return localStorage.getItem(PROXY_URL_KEY) || detectDefaultProxyUrl();
}

/** 從 localStorage 取得用戶為指定模型儲存的 API Key */
function getUserApiKey(model) {
    try {
        return localStorage.getItem(API_KEY_PREFIX + (model || '').trim().toLowerCase()) || null;
    } catch {
        return null;
    }
}

export function setProxyUrl(url) {
    localStorage.setItem(PROXY_URL_KEY, url);
}

/**
 * 向 AI Proxy 發送生成請求
 * @param {string} task - AI 任務類型
 * @param {string} model - AI 模型名稱
 * @param {object} context - 遊戲上下文資料
 * @returns {Promise<object>} AI 回應
 */
export async function generate(task, model, context) {
    const resolvedModel = model || 'minimax';
    const apiKey = getUserApiKey(resolvedModel);
    const url = `${getProxyUrl()}/ai/generate`;
    const body = { task, model: resolvedModel, context };
    if (apiKey) body.apiKey = apiKey;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        let errorMessage;
        try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorJson.message || errorText;
        } catch {
            errorMessage = errorText;
        }
        throw new Error(`AI Proxy 錯誤 (${response.status}): ${errorMessage}`);
    }

    const data = await response.json();
    if (!data.success) {
        throw new Error(data.error || 'AI 生成失敗');
    }
    return data.data;
}

/**
 * 向 AI Proxy 發送圖像生成請求
 * @param {string} prompt - 圖片描述
 * @returns {Promise<{imageBase64: string, revisedPrompt: string}>}
 */
export async function generateImage(prompt) {
    const url = `${getProxyUrl()}/ai/image`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
    });

    if (!response.ok) {
        throw new Error(`圖片生成失敗 (${response.status})`);
    }

    const data = await response.json();
    if (!data.success) {
        throw new Error(data.error || '圖片生成失敗');
    }
    return data;
}

/**
 * 檢查 AI Proxy 是否可連線
 * @returns {Promise<boolean>}
 */
export async function checkConnection() {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const url = `${getProxyUrl()}/health`;
        const response = await fetch(url, { method: 'GET', signal: controller.signal });
        clearTimeout(timer);
        return response.ok;
    } catch {
        return false;
    }
}

const aiProxy = { generate, generateImage, checkConnection, setProxyUrl, getProxyUrl };
export default aiProxy;
