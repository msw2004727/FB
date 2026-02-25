export const DEFAULT_AI_MODEL = 'openai';
export const AI_MODEL_STORAGE_KEY = 'fb_ai_model_core_selection';

const VALID_AI_MODELS = new Set([
    'openai',
    'gemini',
    'deepseek',
    'grok',
    'claude'
]);

function canUseBrowserStorage() {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

export function normalizeAiModelValue(value, fallback = DEFAULT_AI_MODEL) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'cluade') return 'claude';
    return VALID_AI_MODELS.has(normalized) ? normalized : fallback;
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
    const stored = getStoredAiModel();
    applyAiModelToSelector(selectorEl, stored);
    return selectorEl?.value || stored;
}

export function resetAiModelSelectionToDefault(selectorEl) {
    setStoredAiModel(DEFAULT_AI_MODEL);
    applyAiModelToSelector(selectorEl, DEFAULT_AI_MODEL);
    return DEFAULT_AI_MODEL;
}
