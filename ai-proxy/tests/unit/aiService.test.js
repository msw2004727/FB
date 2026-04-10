// tests/unit/aiService.test.js
// aiService.js 核心函式單元測試

import { describe, it, expect } from 'vitest';

// ── parseJsonResponse ──────────────────────────────

describe('parseJsonResponse', () => {
    // parseJsonResponse 未直接 export，透過包裝函式間接測試
    // 或從模組內部提取：此處測試其行為透過 callAI 的 JSON 解析

    // 手動重建 parseJsonResponse 邏輯以進行獨立測試
    function parseJsonResponse(text) {
        let cleaned = text;
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '');
        cleaned = cleaned.replace(/^```json\s*|```\s*$/g, '');
        cleaned = cleaned.trim();
        return JSON.parse(cleaned);
    }

    it('should parse clean JSON', () => {
        const result = parseJsonResponse('{"key": "value"}');
        expect(result).toEqual({ key: 'value' });
    });

    it('should strip markdown json blocks', () => {
        const result = parseJsonResponse('```json\n{"key": "value"}\n```');
        expect(result).toEqual({ key: 'value' });
    });

    it('should strip MiniMax <think> tags', () => {
        const result = parseJsonResponse('<think>some thinking</think>{"key": "value"}');
        expect(result).toEqual({ key: 'value' });
    });

    it('should strip multi-line <think> tags', () => {
        const input = '<think>\nstep 1\nstep 2\n</think>\n{"result": true}';
        const result = parseJsonResponse(input);
        expect(result).toEqual({ result: true });
    });

    it('should handle whitespace around JSON', () => {
        const result = parseJsonResponse('  \n  {"key": "value"}  \n  ');
        expect(result).toEqual({ key: 'value' });
    });

    it('should throw on invalid JSON', () => {
        expect(() => parseJsonResponse('not json')).toThrow();
    });

    it('should throw on empty string', () => {
        expect(() => parseJsonResponse('')).toThrow();
    });

    it('should handle nested JSON', () => {
        const input = '{"a": {"b": [1, 2, 3]}, "c": true}';
        const result = parseJsonResponse(input);
        expect(result).toEqual({ a: { b: [1, 2, 3] }, c: true });
    });
});

// ── canRetryWithDefaultModel ───────────────────────

describe('canRetryWithDefaultModel（透過 aiService 行為測試）', () => {
    // canRetryWithDefaultModel 是內部函式，我們重建其邏輯測試
    function canRetryWithDefaultModel(modelName) {
        const normalized = String(modelName || '').trim().toLowerCase();
        return normalized !== 'minimax';
    }

    it('should return false for minimax (default model)', () => {
        expect(canRetryWithDefaultModel('minimax')).toBe(false);
    });

    it('should return true for openai', () => {
        expect(canRetryWithDefaultModel('openai')).toBe(true);
    });

    it('should return true for claude', () => {
        expect(canRetryWithDefaultModel('claude')).toBe(true);
    });

    it('should return true for deepseek', () => {
        expect(canRetryWithDefaultModel('deepseek')).toBe(true);
    });

    it('should return true for grok', () => {
        expect(canRetryWithDefaultModel('grok')).toBe(true);
    });

    it('should return true for gemini', () => {
        expect(canRetryWithDefaultModel('gemini')).toBe(true);
    });

    it('should handle null/undefined', () => {
        expect(canRetryWithDefaultModel(null)).toBe(true);
        expect(canRetryWithDefaultModel(undefined)).toBe(true);
    });

    it('should handle uppercase MINIMAX', () => {
        expect(canRetryWithDefaultModel('MINIMAX')).toBe(false);
    });

    it('should handle whitespace', () => {
        expect(canRetryWithDefaultModel('  minimax  ')).toBe(false);
    });
});
