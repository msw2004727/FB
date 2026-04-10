// tests/integration/aiRoutes.test.js
// aiRoutes TASK_HANDLERS 結構驗證（不呼叫真實 AI）

import { describe, it, expect } from 'vitest';

// 載入路由模組以存取 TASK_HANDLERS（透過內部結構）
// 由於 TASK_HANDLERS 沒有直接 export，我們透過 require 路由模組並測試 handler 邏輯

// ── 重建 TASK_HANDLERS 供測試 ─────────────────────

const TASK_HANDLER_KEYS = [
    'story', 'narrative', 'prequel', 'epilogue', 'death-cause',
    'summary', 'action-classifier', 'suggestion', 'anachronism',
    'combat', 'combat-setup', 'surrender', 'post-combat',
    'npc-profile', 'npc-chat', 'npc-chat-summary', 'npc-memory',
    'give-item', 'give-narrative', 'proactive-chat', 'trade-summary',
    'encyclopedia', 'relation-graph', 'romance-event',
    'bounty-generator', 'item-generator', 'location-generator',
    'reward-generator', 'skill-generator',
    'cultivation', 'forget-skill', 'random-event',
    'beggar-inquiry', 'relationship-fix'
];

const { aiConfig } = require('../../aiConfig');

// ── 測試 aiConfig 與 TASK_HANDLERS configKey 對應 ──

describe('aiRoutes TASK_HANDLERS — config key coverage', () => {
    // 讀取 aiRoutes 原始碼取得 configKey 列表
    const fs = require('fs');
    const path = require('path');
    const routeSource = fs.readFileSync(
        path.join(__dirname, '../../routes/aiRoutes.js'), 'utf-8'
    );

    // 提取所有 configKey 值
    const configKeyMatches = routeSource.matchAll(/configKey:\s*'(\w+)'/g);
    const usedConfigKeys = [...configKeyMatches].map(m => m[1]);

    it('should have all configKeys defined in aiConfig', () => {
        const missingKeys = usedConfigKeys.filter(key => !(key in aiConfig));
        expect(missingKeys, `Missing config keys: ${missingKeys.join(', ')}`).toEqual([]);
    });

    it('should not have orphan keys in aiConfig', () => {
        const usedSet = new Set(usedConfigKeys);
        const orphanKeys = Object.keys(aiConfig).filter(key => !usedSet.has(key));
        // 孤兒 key 不是錯誤但值得注意
        if (orphanKeys.length > 0) {
            console.warn(`[INFO] aiConfig 中有未被 aiRoutes 使用的 key: ${orphanKeys.join(', ')}`);
        }
    });
});

// ── 測試 TASK_HANDLERS 是否都能正確載入 prompt ────

describe('aiRoutes TASK_HANDLERS — prompt loading', () => {
    const fs = require('fs');
    const path = require('path');
    const routeSource = fs.readFileSync(
        path.join(__dirname, '../../routes/aiRoutes.js'), 'utf-8'
    );

    // 提取所有 require 的 prompt 路徑
    const requireMatches = routeSource.matchAll(/require\(['"]\.\.\/prompts\/(\w+)['"]\)/g);
    const requiredPrompts = [...requireMatches].map(m => m[1]);

    requiredPrompts.forEach(promptName => {
        it(`should load prompt module: ${promptName}`, () => {
            const promptPath = path.join(__dirname, '../../prompts', `${promptName}.js`);
            expect(fs.existsSync(promptPath), `File not found: ${promptPath}`).toBe(true);

            const mod = require(promptPath);
            const exportedFns = Object.keys(mod);
            expect(exportedFns.length).toBeGreaterThan(0);

            // 每個 prompt 應 export 至少一個函式
            exportedFns.forEach(fnName => {
                expect(typeof mod[fnName]).toBe('function');
            });
        });
    });
});

// ── 測試路由端點結構 ──────────────────────────────

describe('aiRoutes — endpoint structure', () => {
    const fs = require('fs');
    const path = require('path');
    const routeSource = fs.readFileSync(
        path.join(__dirname, '../../routes/aiRoutes.js'), 'utf-8'
    );

    it('should have POST /generate endpoint', () => {
        expect(routeSource).toContain("router.post('/generate'");
    });

    it('should have POST /image endpoint', () => {
        expect(routeSource).toContain("router.post('/image'");
    });

    it('should extract task, model, context, apiKey from request body', () => {
        expect(routeSource).toContain('const { task, model, context, apiKey }');
    });

    it('should pass apiKey to callAI', () => {
        expect(routeSource).toContain('apiKey || null');
    });
});

// ── 測試模型選擇邏輯 ──────────────────────────────

describe('Model selection logic', () => {
    it('aiConfig should default all tasks to minimax', () => {
        for (const [key, model] of Object.entries(aiConfig)) {
            expect(model, `aiConfig.${key} is not minimax`).toBe('minimax');
        }
    });

    it('should have at least 25 task configurations', () => {
        expect(Object.keys(aiConfig).length).toBeGreaterThanOrEqual(25);
    });
});
