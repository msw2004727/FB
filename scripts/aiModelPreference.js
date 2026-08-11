export const DEFAULT_AI_MODEL = 'minimax';
export const AI_MODEL_STORAGE_KEY = 'fb_ai_model_core_selection';
const API_KEY_PREFIX = 'fb_ai_apikey_';
const apiKeyMemory = new Map();

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

function getSessionStorage() {
    if (typeof window === 'undefined') return null;
    try {
        if (typeof sessionStorage !== 'undefined') return sessionStorage;
        return window.sessionStorage || null;
    } catch {
        return null;
    }
}

function removeLegacyApiKey(storageKey) {
    if (!canUseBrowserStorage()) return;
    try {
        localStorage.removeItem(storageKey);
    } catch {
        // Ignore storage errors; the in-memory/session copy remains usable.
    }
}

export function normalizeAiModelValue(value, fallback = DEFAULT_AI_MODEL) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'cluade') return 'claude';
    return VALID_AI_MODELS.has(normalized) ? normalized : fallback;
}

/** 此模型是否需要用戶手動提供 API Key */
export function needsUserApiKey(model) {
    return !SERVER_KEY_MODELS.has(normalizeAiModelValue(model));
}

/**
 * 將舊版 localStorage 中的 BYOK 搬到本分頁的 sessionStorage/記憶體後刪除。
 * 可重複呼叫，方便從舊版快取升級而不留下長期憑證。
 */
export function migrateLegacyApiKeys() {
    if (!canUseBrowserStorage()) return;
    const session = getSessionStorage();
    const legacyModelNames = [...VALID_AI_MODELS, 'cluade'];

    for (const legacyModel of legacyModelNames) {
        const legacyStorageKey = API_KEY_PREFIX + legacyModel;
        let legacyValue = null;
        try {
            legacyValue = localStorage.getItem(legacyStorageKey);
        } catch {
            // localStorage may be disabled.
        }

        if (legacyValue) {
            const normalizedStorageKey = API_KEY_PREFIX + normalizeAiModelValue(legacyModel);
            const normalizedValue = String(legacyValue).trim();
            let existingSessionValue = null;
            try {
                existingSessionValue = session?.getItem(normalizedStorageKey) || null;
            } catch {
                // sessionStorage may be disabled; memory storage still works.
            }
            if (normalizedValue && !apiKeyMemory.has(normalizedStorageKey) && !existingSessionValue) {
                apiKeyMemory.set(normalizedStorageKey, normalizedValue);
                try {
                    session?.setItem(normalizedStorageKey, normalizedValue);
                } catch {
                    // sessionStorage may be disabled; memory storage still works.
                }
            }
        }
        removeLegacyApiKey(legacyStorageKey);
    }

    // 舊版 VIP 僅是可偽造的前端旗標，不具伺服器授權效力。
    try {
        localStorage.removeItem('wenjiang_vip_until');
    } catch {
        // Ignore storage errors.
    }
}

/** 取得用戶為某模型暫存的 API Key（只存於本分頁工作階段） */
export function getStoredApiKey(model) {
    const storageKey = API_KEY_PREFIX + normalizeAiModelValue(model);
    const memoryValue = apiKeyMemory.get(storageKey);
    if (memoryValue) return memoryValue;

    try {
        const sessionValue = getSessionStorage()?.getItem(storageKey);
        if (!sessionValue) return null;
        apiKeyMemory.set(storageKey, sessionValue);
        return sessionValue;
    } catch {
        return null;
    }
}

/** 暫存用戶的 API Key；關閉分頁後 sessionStorage 自動清除。 */
export function setStoredApiKey(model, apiKey) {
    const storageKey = API_KEY_PREFIX + normalizeAiModelValue(model);
    const normalizedValue = String(apiKey || '').trim();
    const session = getSessionStorage();

    if (normalizedValue) {
        apiKeyMemory.set(storageKey, normalizedValue);
    } else {
        apiKeyMemory.delete(storageKey);
    }

    try {
        if (normalizedValue) {
            session?.setItem(storageKey, normalizedValue);
        } else {
            session?.removeItem(storageKey);
        }
    } catch {
        // sessionStorage may be disabled; memory storage still works.
    }

    // 無論寫入或刪除，都移除舊版長期保存的副本。
    removeLegacyApiKey(storageKey);
    if (normalizeAiModelValue(model) === 'claude') removeLegacyApiKey(API_KEY_PREFIX + 'cluade');
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
    // 每次開網頁預設回 minimax，避免在沒有 BYOK 時誤選付費模型。
    applyAiModelToSelector(selectorEl, DEFAULT_AI_MODEL);
    setStoredAiModel(DEFAULT_AI_MODEL);
    return DEFAULT_AI_MODEL;
}

export function resetAiModelSelectionToDefault(selectorEl) {
    setStoredAiModel(DEFAULT_AI_MODEL);
    applyAiModelToSelector(selectorEl, DEFAULT_AI_MODEL);
    return DEFAULT_AI_MODEL;
}
