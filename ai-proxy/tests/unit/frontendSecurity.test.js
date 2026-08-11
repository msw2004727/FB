import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    MAX_IMPORT_FILE_BYTES,
    sanitizeFilenameSegment,
    validateImportedSaveData,
} from '../../../client/utils/exportImport.js';
import {
    getStoredApiKey,
    migrateLegacyApiKeys,
    needsUserApiKey,
    setStoredApiKey,
} from '../../../scripts/aiModelPreference.js';
import { advanceDate } from '../../../client/utils/gameUtils.js';
import { shouldRefreshSummary } from '../../../client/engine/gameEngine.js';

function createStorage() {
    return {
        _store: Object.create(null),
        getItem(key) { return this._store[key] ?? null; },
        setItem(key, value) { this._store[key] = String(value); },
        removeItem(key) { delete this._store[key]; },
        clear() { this._store = Object.create(null); },
    };
}

function validSave(overrides = {}) {
    return {
        exportVersion: 2,
        profile: { id: 'profile-1', username: '玩家', scenario: 'wuxia', gender: 'male' },
        gameSaves: [{ R: 0, story: '安全故事' }],
        locationStates: [],
        locationTemplates: [],
        novelChapters: [],
        gameState: { summary: '摘要', summary_revision: 1 },
        ...overrides,
    };
}

beforeEach(() => {
    const local = createStorage();
    const session = createStorage();
    globalThis.window = { localStorage: local, sessionStorage: session };
    globalThis.localStorage = local;
    globalThis.sessionStorage = session;
    for (const model of ['openai', 'gemini', 'gemma', 'deepseek', 'grok', 'claude', 'minimax']) {
        setStoredApiKey(model, '');
    }
});

describe('日期推進防護', () => {
    it('uses bounded native calendar arithmetic for hostile values', () => {
        expect(advanceDate({ yearName: '元祐', year: 1, month: 1, day: 1 }, 1e300))
            .toEqual({ yearName: '元祐', year: 10, month: 12, day: 30 });
        expect(advanceDate({ yearName: '元祐', year: 2026, month: 8, day: 11 }, '3650'))
            .toEqual({ yearName: '元祐', year: 2026, month: 8, day: 11 });
    });
});

describe('摘要成本觸發', () => {
    it('does not trust a repeated NPC isNew flag', () => {
        expect(shouldRefreshSummary({ R: 6, NPC: [{ name: '舊角', isNew: true }], hasNewNpc: false })).toBe(false);
        expect(shouldRefreshSummary({ R: 6, NPC: [{ name: '新角', isNew: false }], hasNewNpc: true })).toBe(true);
        expect(shouldRefreshSummary({ R: 6, playerState: 'dead', hasNewNpc: false })).toBe(false);
        expect(shouldRefreshSummary({ R: 5, playerState: 'dead', hasNewNpc: true })).toBe(false);
        expect(shouldRefreshSummary({
            R: 6,
            playerState: 'dead',
            hasNewNpc: true,
            worldEvent: { type: '終局' },
            progressEval: { triggered: true },
        })).toBe(false);
    });
});

describe('BYOK 工作階段儲存', () => {
    it('只寫入 sessionStorage/記憶體，不把 API Key 留在 localStorage', () => {
        setStoredApiKey('openai', '  sk-session-only  ');

        expect(getStoredApiKey('openai')).toBe('sk-session-only');
        expect(sessionStorage.getItem('fb_ai_apikey_openai')).toBe('sk-session-only');
        expect(localStorage.getItem('fb_ai_apikey_openai')).toBeNull();
    });

    it('遷移並清除舊 localStorage Key（含曾用過的 claude 拼字）', () => {
        localStorage.setItem('fb_ai_apikey_cluade', ' sk-ant-legacy ');
        localStorage.setItem('wenjiang_vip_until', String(Date.now() + 60_000));
        migrateLegacyApiKeys();

        expect(localStorage.getItem('fb_ai_apikey_cluade')).toBeNull();
        expect(localStorage.getItem('wenjiang_vip_until')).toBeNull();
        expect(sessionStorage.getItem('fb_ai_apikey_claude')).toBe('sk-ant-legacy');
        expect(getStoredApiKey('claude')).toBe('sk-ant-legacy');
    });

    it('沒有可由前端旗標繞過的 VIP，非 MiniMax 一律需要 BYOK', () => {
        localStorage.setItem('wenjiang_vip_until', String(Date.now() + 60_000));
        expect(needsUserApiKey('minimax')).toBe(false);
        expect(needsUserApiKey('openai')).toBe(true);
        expect(needsUserApiKey('claude')).toBe(true);
        expect(getStoredApiKey('openai')).toBeNull();
    });
});

describe('匯入存檔驗證', () => {
    it('下載檔名會移除路徑/控制字元與 Windows 保留名稱', () => {
        const sanitized = sanitizeFilenameSegment('  a/b\\c:*?"<>|.  ');
        expect(sanitized).not.toMatch(/[<>:"/\\|?*\u0000-\u001F]/);
        expect(sanitized.endsWith('.')).toBe(false);
        expect(sanitizeFilenameSegment('CON')).toBe('_CON');
    });

    it('接受目前匯出格式', () => {
        const data = validSave();
        expect(validateImportedSaveData(data)).toBe(data);
    });

    it('拒絕原型污染欄位與未授權 gameState key', () => {
        const polluted = JSON.parse('{"exportVersion":2,"profile":{"id":"p","username":"u"},"gameSaves":[],"__proto__":{"polluted":true}}');
        expect(() => validateImportedSaveData(polluted)).toThrow(/不安全欄位/);
        expect(() => validateImportedSaveData(validSave({ gameState: { admin: true } }))).toThrow(/不支援欄位/);
    });

    it('拒絕超大檔案、重複回合與非物件集合項目', () => {
        expect(() => validateImportedSaveData(validSave(), { rawSize: MAX_IMPORT_FILE_BYTES + 1 })).toThrow(/20 MB/);
        expect(() => validateImportedSaveData(validSave({ gameSaves: [{ R: 1 }, { R: 1 }] }))).toThrow(/重複回合/);
        expect(() => validateImportedSaveData(validSave({ locationStates: ['bad'] }))).toThrow(/格式不正確/);
    });
});

describe('前端 XSS 與 CSP 回歸', () => {
    it('第一個串流片段只隱藏思考遮罩，不提前解除請求鎖', async () => {
        const originalDocument = globalThis.document;
        const removedClasses = [];
        globalThis.document = {
            querySelector: () => null,
            getElementById: () => null,
        };
        window.innerWidth = 1280;
        window.addEventListener = () => {};

        try {
            const [{ hideThinkingOverlayForStream }, { dom }, { gameState }] = await Promise.all([
                import('../../../scripts/gameLoop.js'),
                import('../../../scripts/dom.js'),
                import('../../../scripts/gameState.js'),
            ]);
            dom.aiThinkingLoader = {
                classList: {
                    remove(className) { removedClasses.push(className); },
                },
            };
            gameState.isRequesting = true;

            hideThinkingOverlayForStream();

            expect(removedClasses).toEqual(['visible']);
            expect(gameState.isRequesting).toBe(true);
        } finally {
            if (originalDocument === undefined) delete globalThis.document;
            else globalThis.document = originalDocument;
        }
    });

    it('AI、玩家與匯入資料的渲染路徑不再使用 innerHTML', () => {
        const uiUpdater = readFileSync(new URL('../../../scripts/uiUpdater.js', import.meta.url), 'utf8');
        const gameLoop = readFileSync(new URL('../../../scripts/gameLoop.js', import.meta.url), 'utf8');
        const gmManager = readFileSync(new URL('../../../scripts/gmManager.js', import.meta.url), 'utf8');
        const gameEngine = readFileSync(new URL('../../../client/engine/gameEngine.js', import.meta.url), 'utf8');
        const main = readFileSync(new URL('../../../scripts/main.js', import.meta.url), 'utf8');

        expect(uiUpdater).not.toContain('allowHtml');
        expect(uiUpdater).not.toMatch(/storyText[^\n]*innerHTML|statusBarEl\.innerHTML|countdownEl\.innerHTML/);
        expect(gameLoop).not.toContain('.innerHTML');
        expect(gmManager).not.toContain('.innerHTML');
        expect(main).not.toContain('.innerHTML');
        expect(gameLoop).toContain("window.addEventListener('wenjiang:story-delta', handleStoryDelta)");
        expect(gameLoop).toContain("window.removeEventListener('wenjiang:story-delta', handleStoryDelta)");
        expect(gameLoop).toMatch(/streamingStoryElement\?\.remove\(\);[\s\S]*processNewRoundData\(data\)/);
        expect(gameLoop).toContain('streamingStoryElement.textContent = streamedStoryText');
        expect(gameLoop).toContain("if (streamedStoryText.length === 0) hideThinkingOverlayForStream()");
        expect(gameLoop).toContain("dom.aiThinkingLoader?.classList.remove('visible')");
        expect(gameLoop).toContain("window.matchMedia?.('(prefers-reduced-motion: reduce)')");
        expect(gameLoop).toContain("streamingStoryElement.scrollIntoView({");
        expect(gameLoop).toContain('handlePlayerAction(actionText, optionMorality)');
        const hideOverlayHelper = gameLoop.match(/function hideThinkingOverlayForStream\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
        expect(hideOverlayHelper).not.toContain('setLoading(false)');
        expect(hideOverlayHelper).not.toContain('gameState.isRequesting = false');
        expect(main).toContain("keys.filter(key => key.startsWith('wenjiang-'))");
        expect(main).toContain('scope.pathname === appScope.pathname');
        expect(main).toContain("sanitizeFilenameSegment(localStorage.getItem('username'), 'archive')");
        expect(main).not.toContain("localStorage.setItem('jwt_token', 'local-pwa-token')");
        expect(main).toContain("localStorage.getItem('jwt_token') === 'local-pwa-token'");
        expect(main).toContain("localStorage.removeItem('jwt_token')");
        expect(main).toContain('const deathData = await api.forceSuicide');
        expect(main).not.toContain('api.getEpilogue().catch');
        const suicideHelper = gameEngine.match(/export async function forceSuicide[\s\S]*?\n\}/)?.[0] || '';
        expect(suicideHelper).toContain('withOperationLock(`wenjiang-interact:${profileId}`');
        expect(suicideHelper).toContain('if (profile?.isDeceased)');
        expect(gameEngine).toContain("currentProfile?.isDeceased");
        expect(gameEngine).toContain("withOperationLock(`wenjiang-epilogue:${profileId}`");
        expect(gameEngine).toContain("clientDB.state.get(profileId, 'epilogue')");
        expect(gameEngine).toContain("clientDB.state.set(profileId, 'epilogue'");
        expect(gameLoop).toContain('api.getEpilogue({ model })');

        const fatalHelper = main.match(/export function showFatalStartupError\(error\) \{([\s\S]*?)\n\}/)?.[1] || '';
        expect(fatalHelper).toContain('screen.replaceChildren(panel)');
        expect(fatalHelper).toContain("message.textContent =");
        expect(fatalHelper).not.toContain('innerHTML');
        expect(main).toContain('await clientDB.init()');
        expect(main).toContain('async function initialize()');
        expect(main).toContain('await gameLoop.loadInitialGame()');
        expect(main).toContain('await initialize()');
        expect(main).toContain('showFatalStartupError(error)');
    });

    it('CSP 禁止 inline script，同時允許既有字型 CDN', () => {
        const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
        const preferences = readFileSync(new URL('../../../scripts/aiModelPreference.js', import.meta.url), 'utf8');
        const manifest = JSON.parse(readFileSync(new URL('../../../manifest.json', import.meta.url), 'utf8'));
        const scriptTags = [...html.matchAll(/<script\b([^>]*)>/gi)];
        const inlineScripts = scriptTags.filter((match) => !/\bsrc\s*=/.test(match[1]));

        expect(inlineScripts).toHaveLength(0);
        expect(html).toContain("script-src 'self'");
        expect(html).toContain("connect-src 'self' https://wenjiang-ai-proxy-322557520154.us-central1.run.app");
        expect(html).not.toContain("connect-src 'self' https: ");
        expect(html).toContain('http://localhost:3001');
        expect(html).toContain('https://cdnjs.cloudflare.com');
        expect(html).toContain('https://fonts.googleapis.com');
        expect(html).toContain('https://fonts.gstatic.com');
        expect(html).not.toContain('不會上傳至任何伺服器');
        expect(html).not.toContain('apikey-vip-btn');
        expect(html).not.toContain('cancel-vip-btn');
        expect(preferences).not.toContain('VIP_HASH');
        expect(preferences).not.toContain('verifyVipPassword');
        expect(html).not.toContain('icons/icon02.png');
        expect(manifest.icons.map(icon => [icon.src, icon.sizes])).toEqual([
            ['icons/icon-192.png', '192x192'],
            ['icons/icon-512.png', '512x512'],
        ]);
        expect(html).toContain('V0.27');
    });
});
