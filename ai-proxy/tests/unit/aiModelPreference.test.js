// tests/unit/aiModelPreference.test.js
// AI 模型偏好設定純邏輯測試

import { describe, it, expect, beforeAll } from 'vitest';

let mod;

beforeAll(async () => {
    // aiModelPreference 是 ES Module + 依賴 window/localStorage
    // 在 Node 環境中測試其純函式邏輯

    // 模擬 window + localStorage
    globalThis.window = {};
    globalThis.localStorage = {
        _store: {},
        getItem(key) { return this._store[key] ?? null; },
        setItem(key, val) { this._store[key] = String(val); },
        removeItem(key) { delete this._store[key]; },
        clear() { this._store = {}; }
    };

    mod = await import('../../../scripts/aiModelPreference.js');
});

describe('normalizeAiModelValue', () => {
    it('should return valid model names as-is', () => {
        expect(mod.normalizeAiModelValue('openai')).toBe('openai');
        expect(mod.normalizeAiModelValue('minimax')).toBe('minimax');
        expect(mod.normalizeAiModelValue('claude')).toBe('claude');
        expect(mod.normalizeAiModelValue('gemini')).toBe('gemini');
        expect(mod.normalizeAiModelValue('deepseek')).toBe('deepseek');
        expect(mod.normalizeAiModelValue('grok')).toBe('grok');
    });

    it('should fix "cluade" typo', () => {
        expect(mod.normalizeAiModelValue('cluade')).toBe('claude');
    });

    it('should handle uppercase', () => {
        expect(mod.normalizeAiModelValue('OPENAI')).toBe('openai');
        expect(mod.normalizeAiModelValue('MiniMax')).toBe('minimax');
    });

    it('should return fallback for invalid models', () => {
        expect(mod.normalizeAiModelValue('invalid')).toBe('minimax');
        expect(mod.normalizeAiModelValue('')).toBe('minimax');
    });

    it('should handle null/undefined', () => {
        expect(mod.normalizeAiModelValue(null)).toBe('minimax');
        expect(mod.normalizeAiModelValue(undefined)).toBe('minimax');
    });

    it('should respect custom fallback', () => {
        expect(mod.normalizeAiModelValue('invalid', 'openai')).toBe('openai');
    });

    it('should trim whitespace', () => {
        expect(mod.normalizeAiModelValue('  openai  ')).toBe('openai');
    });
});

describe('needsUserApiKey', () => {
    it('should return false for minimax (server key)', () => {
        expect(mod.needsUserApiKey('minimax')).toBe(false);
    });

    it('should return true for all other models', () => {
        expect(mod.needsUserApiKey('openai')).toBe(true);
        expect(mod.needsUserApiKey('claude')).toBe(true);
        expect(mod.needsUserApiKey('gemini')).toBe(true);
        expect(mod.needsUserApiKey('deepseek')).toBe(true);
        expect(mod.needsUserApiKey('grok')).toBe(true);
    });
});

describe('API Key storage', () => {
    it('should store and retrieve API keys', () => {
        mod.setStoredApiKey('openai', 'sk-test-key-123');
        expect(mod.getStoredApiKey('openai')).toBe('sk-test-key-123');
    });

    it('should return null for missing keys', () => {
        expect(mod.getStoredApiKey('nonexistent')).toBe(null);
    });

    it('should remove key when set to empty', () => {
        mod.setStoredApiKey('claude', 'sk-ant-test');
        expect(mod.getStoredApiKey('claude')).toBe('sk-ant-test');
        mod.setStoredApiKey('claude', '');
        expect(mod.getStoredApiKey('claude')).toBe(null);
    });

    it('should trim API key whitespace', () => {
        mod.setStoredApiKey('grok', '  sk-key-with-spaces  ');
        expect(mod.getStoredApiKey('grok')).toBe('sk-key-with-spaces');
    });
});

describe('Model storage', () => {
    it('should store and retrieve model selection', () => {
        mod.setStoredAiModel('claude');
        expect(mod.getStoredAiModel()).toBe('claude');
    });

    it('should normalize stored value', () => {
        mod.setStoredAiModel('OPENAI');
        expect(mod.getStoredAiModel()).toBe('openai');
    });
});

describe('Constants', () => {
    it('DEFAULT_AI_MODEL should be minimax', () => {
        expect(mod.DEFAULT_AI_MODEL).toBe('minimax');
    });

    it('AI_MODEL_INFO should have entries for all models', () => {
        const models = ['openai', 'gemini', 'deepseek', 'grok', 'claude', 'minimax'];
        models.forEach(m => {
            expect(mod.AI_MODEL_INFO).toHaveProperty(m);
            expect(mod.AI_MODEL_INFO[m]).toHaveProperty('name');
            expect(mod.AI_MODEL_INFO[m]).toHaveProperty('hint');
        });
    });
});
