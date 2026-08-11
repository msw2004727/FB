import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const router = require('../../routes/aiRoutes');
const {
    STORY_RESULT_SCHEMA,
    extractPartialJsonString,
    injectStoryContract,
    normalizeStoryResult,
    normalizeSummaryResult,
} = router._internals;

const context = {
    currentRound: 7,
    playerAction: '調查門外的腳印',
    player: {
        username: '測試者',
        scenario: 'wuxia',
        currentLocation: ['無名村', '客棧'],
        currentTimeOfDay: '上午',
        R: 7,
    },
};

describe('single-call story pipeline', () => {
    it('declares options and progress in the same schema', () => {
        expect(Object.keys(STORY_RESULT_SCHEMA.properties)).toEqual(['story', 'roundData']);
        const required = STORY_RESULT_SCHEMA.properties.roundData.required;
        expect(required).toContain('actionOptions');
        expect(required).toContain('actionMorality');
        expect(required).toContain('progressEval');
        expect(STORY_RESULT_SCHEMA.properties.roundData.properties.NPC.items.type).toBe('object');
        expect(STORY_RESULT_SCHEMA.properties.roundData.properties.daysToAdvance.maximum).toBe(3650);
    });

    it('bounds model-controlled date advancement to a finite integer', () => {
        const base = { story: '有效故事'.repeat(100), roundData: {} };
        expect(normalizeStoryResult({ ...base, roundData: { daysToAdvance: 1e300 } }, context).data.roundData.daysToAdvance).toBe(3650);
        expect(normalizeStoryResult({ ...base, roundData: { daysToAdvance: -7 } }, context).data.roundData.daysToAdvance).toBe(0);
        expect(normalizeStoryResult({ ...base, roundData: { daysToAdvance: '365' } }, context).data.roundData.daysToAdvance).toBe(0);
        expect(normalizeStoryResult({ ...base, roundData: { daysToAdvance: Number.NaN } }, context).data.roundData.daysToAdvance).toBe(0);
    });

    it('normalizes missing auxiliary fields with deterministic fallbacks', () => {
        const raw = JSON.stringify({
            story: '這是一段有效但偏短的測試故事。',
            roundData: { playerState: 'alive', EVT: '調查足跡' },
        });
        const result = normalizeStoryResult(raw, context);
        expect(result.data.roundData.actionOptions).toHaveLength(3);
        expect(result.data.roundData.actionMorality).toHaveLength(3);
        expect(result.data.roundData.progressEval.triggered).toBe(false);
        expect(result.data.roundData.R).toBe(8);
        expect(result.warnings).toContain('action_options_fallback_used');
        expect(result.warnings.some(item => item.startsWith('story_length_'))).toBe(true);
    });

    it('bounds unsafe fields while preserving the legacy output shape', () => {
        const result = normalizeStoryResult({
            story: '故事'.repeat(800),
            roundData: {
                playerState: 'unexpected',
                moralityChange: 9999,
                NPC: [
                    null,
                    'bad',
                    { name: ' 角色甲 ', status: ' 安全 ', friendliness: 'INVALID', friendlinessChange: 999 },
                    ...Array.from({ length: 30 }, (_, index) => ({ name: `角色${index}` })),
                ],
                actionOptions: ['觀察現場', '詢問路人', '立刻撤退'],
                actionMorality: [0, 0, 0],
            },
        }, context);
        expect(result.data.story.length).toBeLessThanOrEqual(1200);
        expect(result.data.roundData.story).toBe(result.data.story);
        expect(result.data.roundData.playerState).toBe('alive');
        expect(result.data.roundData.moralityChange).toBe(100);
        expect(result.data.roundData.NPC).toHaveLength(20);
        expect(result.data.roundData.NPC[0]).toEqual({
            name: '角色甲',
            status: '安全',
            friendliness: 'neutral',
            friendlinessChange: 100,
            isNew: true,
            isDeceased: false,
        });
        expect(result.data.roundData.NPC.every(npc => npc && typeof npc === 'object')).toBe(true);
        expect(result.warnings).toContain('npc_entries_filtered');
        expect(result.data.roundData.actionMorality).toEqual([0, 1, -1]);
    });

    it('derives NPC novelty from known names instead of trusting a copied flag', () => {
        const result = normalizeStoryResult({
            story: '有效故事'.repeat(100),
            roundData: {
                NPC: [
                    { name: '既有角色', status: '仍在場', friendliness: 'friendly', isNew: true },
                    { name: '全新角色', status: '初次現身', friendliness: 'neutral', isNew: false },
                ],
            },
        }, { ...context, actorCandidates: ['既有角色'] });
        expect(result.data.roundData.NPC.map(npc => [npc.name, npc.isNew])).toEqual([
            ['既有角色', false],
            ['全新角色', true],
        ]);
        expect(result.data.roundData.hasNewNpc).toBe(true);
    });

    it('extracts only complete story string content from partial JSON', () => {
        const raw = '{"story":"第一行\\n第二行\\u3002","roundData":';
        expect(extractPartialJsonString(raw, 'story')).toBe('第一行\n第二行。');
        expect(extractPartialJsonString('{"story":"不完整\\u30', 'story')).toBe('不完整');
    });

    it('keeps summary revision in the normalized response', () => {
        expect(normalizeSummaryResult('{"summary":"新摘要"}', {
            oldSummary: '舊摘要', revision: 4,
        })).toEqual({ summary: '新摘要', revision: 4 });
    });

    it('contains no parallel auxiliary provider calls in the story route', () => {
        const source = fs.readFileSync(path.join(__dirname, '../../routes/aiRoutes.js'), 'utf8');
        expect(source).not.toContain('Promise.all(promises)');
        expect(source).not.toContain("require('../prompts/optionsPrompt')");
        expect(source).toContain('storyContractInstruction()');
        expect(source).toContain('streamAI(');
    });

    it('places fixed rules and the output contract before all turn-dynamic context', () => {
        const { getStoryPrompt } = require('../../prompts/storyPrompt');
        const prompt = injectStoryContract(getStoryPrompt(
            '會變動的摘要',
            [{ R: 7, story: '上一回合故事', EVT: '舊事件' }],
            '本回合玩家行動',
            context.player,
            context.player.username,
            '上午',
            null,
            0,
            [],
            null,
            null,
            null,
            {},
            0,
            [],
            false
        ));
        const fixedMarker = prompt.indexOf('## 【單次結構化回應契約');
        const outputRules = prompt.indexOf('## 你必須嚴格遵守以下的規則');
        const dynamicMarker = prompt.indexOf('## 【本回合動態資訊】');
        expect(fixedMarker).toBeGreaterThan(-1);
        expect(outputRules).toBeGreaterThan(-1);
        expect(outputRules).toBeLessThan(dynamicMarker);
        expect(fixedMarker).toBeLessThan(dynamicMarker);
        expect(prompt).toContain('story 必須放在 JSON 第一個欄位');
        expect(prompt.indexOf('story 必須放在 JSON 第一個欄位')).toBeLessThan(dynamicMarker);
        expect(prompt.indexOf('會變動的摘要')).toBeGreaterThan(dynamicMarker);
        expect(prompt.indexOf('本回合玩家行動')).toBeGreaterThan(dynamicMarker);
    });

    it('ignores malformed NPC entries in legacy recent history', () => {
        const { getStoryPrompt } = require('../../prompts/storyPrompt');
        expect(() => getStoryPrompt(
            '摘要',
            [{ R: 1, story: '舊故事', NPC: [null, 'bad', { name: ' 合法角色 ', friendliness: 'friendly' }] }],
            '繼續前進',
            context.player,
            context.player.username,
            '上午'
        )).not.toThrow();
    });
});

describe('MemPalace default-off contract', () => {
    it('does not contact MemPalace unless explicitly enabled', async () => {
        expect(process.env.MEMPALACE_ENABLED).not.toBe('true');
        const mempalace = require('../../services/mempalaceClient');
        expect(mempalace.isEnabled()).toBe(false);
        await expect(mempalace.buildDeepMemoryContext('player', 'action')).resolves.toBe('');
        await expect(mempalace.isAvailable()).resolves.toBe(false);
        expect(mempalace.saveRoundMemory('player', {}, 'story')).toBe(false);
    });

    it('contains no hard-coded production MemPalace endpoint', () => {
        const source = fs.readFileSync(path.join(__dirname, '../../services/mempalaceClient.js'), 'utf8');
        expect(source).not.toContain('mempalace-server-322557520154');
        expect(source).toContain("process.env.MEMPALACE_URL || ''");
        expect(source).toContain('MEMPALACE_REQUESTED && MEMPALACE_URL_VALID');
    });
});
