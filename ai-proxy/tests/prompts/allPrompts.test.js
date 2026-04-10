// tests/prompts/allPrompts.test.js
// 驗證所有 prompt 函式：不崩潰、回傳字串、包含必要指令

import { describe, it, expect } from 'vitest';

// ── 測試用假資料 ──────────────────────────────────

const mockPlayerProfile = {
    username: '測試俠客',
    gender: 'male',
    morality: 25,
    stamina: 80,
    yearName: '元祐',
    year: 1,
    month: 3,
    day: 15,
    currentTimeOfDay: '上午',
    power: { internal: 10, external: 8, lightness: 5 },
    relationships: {},
    inventory: { '銀兩': 100 },
    currentLocation: ['京城', '東市']
};

const mockNpcProfile = {
    name: '王大夫',
    npcName: '王大夫',
    personality: ['善良', '溫厚'],
    background: '無名村的郎中',
    goals: '救死扶傷',
    secrets: '曾是江湖中人',
    likes: '草藥',
    dislikes: '暴力',
    preferences: {},
    friendlinessValue: 30,
    romanceValue: 0,
    inventory: { '金瘡藥': 3 },
    equipment: [],
    interactionSummary: '曾救過玩家一命'
};

const mockRoundData = {
    R: 5,
    EVT: '在街上閒逛',
    PC: '精神飽滿',
    LOC: ['京城', '東市'],
    WRD: '晴朗',
    ATM: ['繁華', '人聲鼎沸'],
    PSY: '心情愉快',
    QST: '探索城市',
    CLS: '',
    IMP: '引起了路人注意',
    NPC: [{ name: '王大夫', friendlinessChange: 5 }],
    story: '你走在東市的街道上...',
    stamina: 85,
    morality: 20,
    playerState: 'alive',
    inventory: [{ itemName: '銀兩', quantity: 100 }]
};

const mockCombatState = {
    enemies: [{ name: '山賊頭目', hp: 50, maxHp: 100 }],
    allies: [],
    log: ['戰鬥開始', '山賊頭目揮刀砍來'],
    round: 2
};

const mockLongTermSummary = '測試俠客穿越到古代，被王大夫所救，目前在京城東市探索。';

// ── 載入所有 prompt 模組 ──────────────────────────

const promptModules = {
    storyPrompt: require('../../prompts/storyPrompt'),
    narrativePrompt: require('../../prompts/narrativePrompt'),
    summaryPrompt: require('../../prompts/summaryPrompt'),
    prequelPrompt: require('../../prompts/prequelPrompt'),
    suggestionPrompt: require('../../prompts/suggestionPrompt'),
    encyclopediaPrompt: require('../../prompts/encyclopediaPrompt'),
    combatPrompt: require('../../prompts/combatPrompt'),
    npcCreatorPrompt: require('../../prompts/npcCreatorPrompt'),
    chatMasterPrompt: require('../../prompts/chatMasterPrompt'),
    chatSummaryPrompt: require('../../prompts/chatSummaryPrompt'),
    giveItemPrompt: require('../../prompts/giveItemPrompt'),
    narrativeForGivePrompt: require('../../prompts/narrativeForGivePrompt'),
    relationGraphPrompt: require('../../prompts/relationGraphPrompt'),
    romanceEventPrompt: require('../../prompts/romanceEventPrompt'),
    epiloguePrompt: require('../../prompts/epiloguePrompt'),
    deathCausePrompt: require('../../prompts/deathCausePrompt'),
    actionClassifierPrompt: require('../../prompts/actionClassifierPrompt'),
    surrenderPrompt: require('../../prompts/surrenderPrompt'),
    proactiveChatPrompt: require('../../prompts/proactiveChatPrompt'),
    combatSetupPrompt: require('../../prompts/combatSetupPrompt'),
    anachronismPrompt: require('../../prompts/anachronismPrompt'),
    postCombatPrompt: require('../../prompts/postCombatPrompt'),
    npcMemoryPrompt: require('../../prompts/npcMemoryPrompt'),
    tradeSummaryPrompt: require('../../prompts/tradeSummaryPrompt'),
    cultivationPrompt: require('../../prompts/cultivationPrompt'),
    forgetSkillPrompt: require('../../prompts/forgetSkillPrompt'),
};

// ── 測試定義 ──────────────────────────────────────

const PROMPT_TEST_CASES = [
    {
        name: 'storyPrompt',
        fn: () => promptModules.storyPrompt.getStoryPrompt(
            mockLongTermSummary, [mockRoundData], '向北走',
            mockPlayerProfile, '測試俠客', '上午',
            { internal: 10, external: 8, lightness: 5 }, 25,
            [], null, null, null, {}, 5, ['王大夫'], false
        ),
        mustContain: ['測試俠客', 'JSON']
    },
    {
        name: 'narrativePrompt',
        fn: () => promptModules.narrativePrompt.getNarrativePrompt(mockRoundData),
        mustContain: []
    },
    {
        name: 'summaryPrompt',
        fn: () => promptModules.summaryPrompt.getSummaryPrompt('舊摘要', mockRoundData),
        mustContain: ['摘要', 'JSON']
    },
    {
        name: 'prequelPrompt',
        fn: () => promptModules.prequelPrompt.getPrequelPrompt([mockRoundData]),
        mustContain: []
    },
    {
        name: 'suggestionPrompt',
        fn: () => promptModules.suggestionPrompt.getSuggestionPrompt(mockRoundData),
        mustContain: []
    },
    {
        name: 'encyclopediaPrompt',
        fn: () => promptModules.encyclopediaPrompt.getEncyclopediaPrompt(mockLongTermSummary, '測試俠客', [mockNpcProfile]),
        mustContain: ['測試俠客', 'JSON', '百科']
    },
    {
        name: 'combatPrompt',
        fn: () => promptModules.combatPrompt.getCombatPrompt(mockPlayerProfile, mockCombatState, { strategy: 'attack' }),
        mustContain: ['JSON']
    },
    {
        name: 'npcCreatorPrompt',
        fn: () => promptModules.npcCreatorPrompt.getNpcCreatorPrompt('測試俠客', '李小花', mockRoundData, mockPlayerProfile),
        mustContain: ['李小花']
    },
    {
        name: 'chatMasterPrompt',
        fn: () => promptModules.chatMasterPrompt.getChatMasterPrompt(
            mockNpcProfile, [{ speaker: '玩家', message: '你好' }], '你好',
            mockLongTermSummary, null, null
        ),
        mustContain: ['王大夫', 'JSON']
    },
    {
        name: 'chatSummaryPrompt',
        fn: () => promptModules.chatSummaryPrompt.getChatSummaryPrompt(
            '測試俠客', '王大夫',
            [{ speaker: '玩家', message: '你好' }, { speaker: '王大夫', message: '你好啊' }],
            mockLongTermSummary
        ),
        mustContain: ['測試俠客', '王大夫']
    },
    {
        name: 'giveItemPrompt',
        fn: () => promptModules.giveItemPrompt.getGiveItemPrompt(
            mockPlayerProfile, mockNpcProfile, { type: 'item', itemName: '金瘡藥', amount: 1 }
        ),
        mustContain: ['金瘡藥', 'JSON']
    },
    {
        name: 'narrativeForGivePrompt',
        fn: () => promptModules.narrativeForGivePrompt.getAINarrativeForGive(
            mockRoundData, '測試俠客', '王大夫', '金瘡藥', '多謝！'
        ),
        mustContain: ['金瘡藥']
    },
    {
        name: 'relationGraphPrompt',
        fn: () => promptModules.relationGraphPrompt.getRelationGraphPrompt(
            mockLongTermSummary, '測試俠客', [mockNpcProfile]
        ),
        mustContain: ['測試俠客', 'Mermaid', 'JSON']
    },
    {
        name: 'romanceEventPrompt',
        fn: () => promptModules.romanceEventPrompt.getRomanceEventPrompt(
            mockPlayerProfile, mockNpcProfile, 'FIRST_MEET'
        ),
        mustContain: []
    },
    {
        name: 'epiloguePrompt',
        fn: () => promptModules.epiloguePrompt.getEpiloguePrompt({
            username: '測試俠客', gender: 'male',
            longTermSummary: mockLongTermSummary,
            finalStats: mockPlayerProfile,
            finalRelationships: [{ name: '王大夫', friendlinessValue: 30, romanceValue: 0 }],
            finalInventory: [{ itemName: '銀兩', quantity: 100 }],
            deathInfo: { cause: '壽終正寢', round: 100 }
        }),
        mustContain: ['測試俠客']
    },
    {
        name: 'deathCausePrompt',
        fn: () => promptModules.deathCausePrompt.getDeathCausePrompt('測試俠客', mockRoundData),
        mustContain: ['測試俠客']
    },
    {
        name: 'actionClassifierPrompt',
        fn: () => promptModules.actionClassifierPrompt.getActionClassifierPrompt('向北走', {
            location: ['京城', '東市'],
            npcs: [{ name: '王大夫' }],
            skills: [{ skillName: '太極拳', level: 1 }],
            inventory: [{ itemName: '銀兩', quantity: 100 }]
        }),
        mustContain: ['JSON']
    },
    {
        name: 'surrenderPrompt',
        fn: () => promptModules.surrenderPrompt.getSurrenderPrompt(mockPlayerProfile, mockCombatState),
        mustContain: ['認輸', 'JSON']
    },
    {
        name: 'proactiveChatPrompt',
        fn: () => promptModules.proactiveChatPrompt.getProactiveChatPrompt(
            mockPlayerProfile, mockNpcProfile, { type: 'TRUST_BREAKTHROUGH' }
        ),
        mustContain: ['JSON']
    },
    {
        name: 'combatSetupPrompt',
        fn: () => promptModules.combatSetupPrompt.getCombatSetupPrompt('攻擊山賊', mockRoundData),
        mustContain: ['JSON']
    },
    {
        name: 'anachronismPrompt',
        fn: () => promptModules.anachronismPrompt.getAnachronismPrompt('掏出手機', '手機'),
        mustContain: ['手機']
    },
    {
        name: 'postCombatPrompt',
        fn: () => promptModules.postCombatPrompt.getAIPostCombatResultPrompt(
            mockPlayerProfile,
            {
                player: { username: '測試俠客', hp: 50, maxHp: 100 },
                enemies: [{ name: '山賊頭目', hp: 0, maxHp: 100 }],
                allies: [],
                intention: '自衛'
            },
            ['戰鬥結束'], null
        ),
        mustContain: ['JSON']
    },
    {
        name: 'npcMemoryPrompt',
        fn: () => promptModules.npcMemoryPrompt.getNpcMemoryPrompt('王大夫', '舊記憶', { event: '聊天' }),
        mustContain: ['王大夫', 'JSON']
    },
    {
        name: 'tradeSummaryPrompt',
        fn: () => promptModules.tradeSummaryPrompt.getTradeSummaryPrompt(
            '測試俠客', '王大夫', { playerOfferItems: [], npcOfferItems: [] }, mockLongTermSummary
        ),
        mustContain: ['測試俠客', '王大夫']
    },
    {
        name: 'cultivationPrompt',
        fn: () => promptModules.cultivationPrompt.getCultivationPrompt(
            { ...mockPlayerProfile }, { skillName: '太極拳', level: 1 }, 7, 'success', '修為有成'
        ),
        mustContain: ['太極拳']
    },
    {
        name: 'forgetSkillPrompt',
        fn: () => promptModules.forgetSkillPrompt.getForgetSkillPrompt(mockPlayerProfile, '太極拳'),
        mustContain: ['太極拳']
    },
];

// ── 自動為每個 prompt 生成測試 ────────────────────

describe('Prompt functions — smoke tests', () => {
    PROMPT_TEST_CASES.forEach(({ name, fn, mustContain }) => {
        describe(name, () => {
            let result;

            it('should not throw', () => {
                expect(() => { result = fn(); }).not.toThrow();
            });

            it('should return a non-empty string', () => {
                result = fn();
                expect(typeof result).toBe('string');
                expect(result.length).toBeGreaterThan(50);
            });

            mustContain.forEach(keyword => {
                it(`should contain keyword: "${keyword}"`, () => {
                    result = fn();
                    expect(result).toContain(keyword);
                });
            });
        });
    });
});

// ── 邊界情況：空值/缺失參數 ──────────────────────

describe('Prompt functions — edge cases with missing data', () => {
    it('storyPrompt should handle all defaults', () => {
        const result = promptModules.storyPrompt.getStoryPrompt('', []);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(50);
    });

    it('chatMasterPrompt should handle null NPC fields', () => {
        const minimalNpc = { name: 'NPC', inventory: {}, equipment: [] };
        expect(() => {
            promptModules.chatMasterPrompt.getChatMasterPrompt(
                minimalNpc, [], '你好', '', null, null
            );
        }).not.toThrow();
    });

    it('giveItemPrompt should handle money type', () => {
        const result = promptModules.giveItemPrompt.getGiveItemPrompt(
            mockPlayerProfile, mockNpcProfile,
            { type: 'money', itemName: '銀兩', amount: 100 }
        );
        expect(result).toContain('100兩銀子');
    });

    it('encyclopediaPrompt should handle empty NPC list', () => {
        const result = promptModules.encyclopediaPrompt.getEncyclopediaPrompt(
            mockLongTermSummary, '俠客', []
        );
        expect(typeof result).toBe('string');
    });

    it('relationGraphPrompt should handle empty NPC list', () => {
        const result = promptModules.relationGraphPrompt.getRelationGraphPrompt(
            mockLongTermSummary, '俠客', []
        );
        expect(typeof result).toBe('string');
    });
});
