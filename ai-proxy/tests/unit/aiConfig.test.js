// tests/unit/aiConfig.test.js
// aiConfig 完整性測試

import { describe, it, expect } from 'vitest';

const { aiConfig } = require('../../aiConfig');

// 所有 aiRoutes.js TASK_HANDLERS 引用的 configKey
const REQUIRED_CONFIG_KEYS = [
    'story', 'narrative', 'prequel', 'epilogue', 'deathCause',
    'summary', 'actionClassifier', 'suggestion',
    'combat', 'combatSetup', 'surrender', 'postCombat',
    'npcProfile', 'npcChat', 'npcChatSummary', 'npcMemory',
    'giveItem', 'giveNarrative', 'proactiveChat', 'romanceEvent',
    'encyclopedia', 'relationGraph', 'bounty',
    'itemTemplate', 'location', 'reward', 'skillTemplate'
];

const VALID_MODELS = ['minimax', 'openai', 'gpt5.4', 'deepseek', 'grok', 'gemini', 'claude'];

describe('aiConfig completeness', () => {
    it('should export a valid object', () => {
        expect(aiConfig).toBeDefined();
        expect(typeof aiConfig).toBe('object');
    });

    REQUIRED_CONFIG_KEYS.forEach(key => {
        it(`should have config key: ${key}`, () => {
            expect(aiConfig).toHaveProperty(key);
        });

        it(`${key} should map to a valid model name`, () => {
            expect(VALID_MODELS).toContain(aiConfig[key]);
        });
    });

    it('should not have empty/undefined values', () => {
        for (const [key, value] of Object.entries(aiConfig)) {
            expect(value, `aiConfig.${key} is empty`).toBeTruthy();
        }
    });
});
