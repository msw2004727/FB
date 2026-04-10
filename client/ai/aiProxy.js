// client/ai/aiProxy.js
// AI Proxy 客戶端 — 負責與 AI Proxy 伺服器通訊

const PROXY_URL_KEY = 'wenjiang_ai_proxy_url';
const DEFAULT_PROXY_URL = 'https://ai-wenjiang-proxy.vercel.app';

function getProxyUrl() {
    return localStorage.getItem(PROXY_URL_KEY) || DEFAULT_PROXY_URL;
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
    const url = `${getProxyUrl()}/ai/generate`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, model: model || 'openai', context })
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
        const url = `${getProxyUrl()}/health`;
        const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
        return response.ok;
    } catch {
        return false;
    }
}

const aiProxy = { generate, generateImage, checkConnection, setProxyUrl, getProxyUrl };
export default aiProxy;
