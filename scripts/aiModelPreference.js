export const DEFAULT_AI_MODEL = 'minimax';
export const AI_MODEL_STORAGE_KEY = 'fb_ai_model_core_selection';
const API_KEY_PREFIX = 'fb_ai_apikey_';

const VALID_AI_MODELS = new Set([
    'openai',
    'gemini',
    'gemma',
    'deepseek',
    'grok',
    'claude',
    'minimax'
]);

// 擁有伺服器端金鑰的模型（用戶無需手動輸入）
const SERVER_KEY_MODELS = new Set(['minimax']);

// 各模型的顯示名稱與 Key 提示
export const AI_MODEL_INFO = {
    openai:   { name: 'GPT-5.4',             hint: '格式通常為 sk-...' },
    gemini:   { name: 'Gemini 3.1 Pro',         hint: '前往 Google AI Studio 取得' },
    gemma:    { name: 'Gemma 4 31B',          hint: '使用 Google AI Studio API Key' },
    deepseek: { name: 'DeepSeek-V4',          hint: '前往 DeepSeek 平台取得' },
    grok:     { name: 'Grok-4.20',            hint: '前往 xAI 平台取得' },
    claude:   { name: 'Claude Opus 4.6',      hint: '格式通常為 sk-ant-...' },
    minimax:  { name: 'MiniMax-M2.7',         hint: '' },
};

function canUseBrowserStorage() {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

export function normalizeAiModelValue(value, fallback = DEFAULT_AI_MODEL) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'cluade') return 'claude';
    return VALID_AI_MODELS.has(normalized) ? normalized : fallback;
}

/** VIP 驗證碼（簡易哈希，非明文存放） */
const VIP_HASH = '0017045f00007bbc00006fe1000061fc';
function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(16).padStart(8, '0') + (str.length * 7919).toString(16).padStart(8, '0') +
           Array.from(str).reduce((a, c) => ((a << 3) ^ c.charCodeAt(0)) >>> 0, 0).toString(16).padStart(8, '0') +
           (str.split('').reverse().join('').length * 6271).toString(16).padStart(8, '0');
}

/** 驗證 VIP 密碼 */
export function verifyVipPassword(password) {
    return simpleHash(String(password).trim()) === VIP_HASH;
}

/** 啟用 VIP（僅本次 session，關閉網頁即失效） */
let _vipSession = false;
export function activateVip() {
    _vipSession = true;
}

/** 取消 VIP */
export function deactivateVip() {
    _vipSession = false;
}

/** 是否為 VIP */
export function isVip() {
    return _vipSession;
}

/** 此模型是否需要用戶手動提供 API Key */
export function needsUserApiKey(model) {
    if (isVip()) return false;
    return !SERVER_KEY_MODELS.has(normalizeAiModelValue(model));
}

/** 取得用戶為某模型儲存的 API Key */
export function getStoredApiKey(model) {
    if (!canUseBrowserStorage()) return null;
    if (isVip()) return null; // VIP 不帶 key → server 用自己的
    try {
        return localStorage.getItem(API_KEY_PREFIX + normalizeAiModelValue(model)) || null;
    } catch {
        return null;
    }
}

/** 儲存用戶的 API Key */
export function setStoredApiKey(model, apiKey) {
    if (!canUseBrowserStorage()) return;
    try {
        const key = API_KEY_PREFIX + normalizeAiModelValue(model);
        if (apiKey) {
            localStorage.setItem(key, apiKey.trim());
        } else {
            localStorage.removeItem(key);
        }
    } catch {
        // Ignore storage errors.
    }
}

export function getStoredAiModel() {
    if (!canUseBrowserStorage()) return DEFAULT_AI_MODEL;
    try {
        return normalizeAiModelValue(localStorage.getItem(AI_MODEL_STORAGE_KEY), DEFAULT_AI_MODEL);
    } catch {
        return DEFAULT_AI_MODEL;
    }
}

export function setStoredAiModel(model) {
    if (!canUseBrowserStorage()) return;
    try {
        localStorage.setItem(AI_MODEL_STORAGE_KEY, normalizeAiModelValue(model));
    } catch {
        // Ignore storage errors.
    }
}

export function applyAiModelToSelector(selectorEl, model) {
    if (!selectorEl) return;
    const targetValue = normalizeAiModelValue(model);
    const optionExists = Array.from(selectorEl.options || []).some(option => option.value === targetValue);
    selectorEl.value = optionExists ? targetValue : DEFAULT_AI_MODEL;
}

export function restoreAiModelSelection(selectorEl) {
    // 每次開網頁預設回 minimax（VIP 也需重新驗證）
    applyAiModelToSelector(selectorEl, DEFAULT_AI_MODEL);
    setStoredAiModel(DEFAULT_AI_MODEL);
    return DEFAULT_AI_MODEL;
}

export function resetAiModelSelectionToDefault(selectorEl) {
    setStoredAiModel(DEFAULT_AI_MODEL);
    applyAiModelToSelector(selectorEl, DEFAULT_AI_MODEL);
    return DEFAULT_AI_MODEL;
}
