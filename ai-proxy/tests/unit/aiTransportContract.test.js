import { afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const { createCostProtection } = require('../../middleware/costProtection');
const { _internals: aiServiceInternals } = require('../../services/aiService');

function validateGenerateBody(body) {
    const protection = createCostProtection({
        env: {
            SERVER_KEY_MODELS: 'minimax',
            ALLOWED_AI_MODELS: 'minimax,openai',
        },
    });
    return new Promise(resolve => {
        const req = {
            method: 'POST',
            path: '/generate',
            body,
            id: 'test-request',
            is: value => value === 'application/json',
        };
        const result = { status: null, body: null, next: false, req };
        const res = {
            status(code) { result.status = code; return this; },
            json(payload) { result.body = payload; resolve(result); return this; },
        };
        protection.validate(req, res, () => {
            result.next = true;
            resolve(result);
        });
    });
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('AI transport hardening contract', () => {
    const serviceSource = fs.readFileSync(path.join(__dirname, '../../services/aiService.js'), 'utf8');
    const clientSource = fs.readFileSync(path.join(__dirname, '../../../client/ai/aiProxy.js'), 'utf8');
    const engineSource = fs.readFileSync(path.join(__dirname, '../../../client/engine/gameEngine.js'), 'utf8');

    it('uses official MiniMax endpoint and bounded request controls', () => {
        expect(serviceSource).toContain("'https://api.minimax.io/v1'");
        expect(serviceSource).toContain('max_completion_tokens');
        expect(serviceSource).toContain('maxRetries: DEFAULT_MAX_RETRIES');
        expect(serviceSource).toContain('createDeadlineSignal');
    });

    it('keeps M3 and disabled thinking opt-in', () => {
        expect(serviceSource).toContain("process.env.MINIMAX_MODEL || 'MiniMax-M2.7'");
        expect(serviceSource).toContain("process.env.MINIMAX_DISABLE_THINKING === 'true'");
    });

    it('never sends unsupported response_format to MiniMax reasoning models', () => {
        const body = aiServiceInternals.minimaxOptions('只回傳 JSON', true, {});
        expect(body.model).toMatch(/^MiniMax-M(?:2|3)/);
        expect(body).not.toHaveProperty('response_format');
        expect(body.messages).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: '只回傳 JSON' }),
        ]));
    });

    it('reads BYOK through the shared session/memory credential store', () => {
        expect(clientSource).toContain("import { getStoredApiKey } from '../../scripts/aiModelPreference.js'");
        expect(clientSource).toContain('return getStoredApiKey(model)');
        expect(clientSource).not.toContain('sessionStorage.getItem(API_KEY_PREFIX');
        expect(clientSource).not.toContain('localStorage.getItem(API_KEY_PREFIX');
    });

    it('still sends memory-only BYOK when browser storage is blocked without persisting or logging it', async () => {
        vi.resetModules();
        const localCalls = [];
        const blockedLocal = {
            getItem(key) {
                localCalls.push(['getItem', key]);
                throw new DOMException('blocked', 'SecurityError');
            },
            setItem(key, value) {
                localCalls.push(['setItem', key, value]);
                throw new DOMException('blocked', 'SecurityError');
            },
            removeItem(key) {
                localCalls.push(['removeItem', key]);
                throw new DOMException('blocked', 'SecurityError');
            },
        };
        const blockedSession = {
            getItem() { throw new DOMException('blocked', 'SecurityError'); },
            setItem() { throw new DOMException('blocked', 'SecurityError'); },
            removeItem() { throw new DOMException('blocked', 'SecurityError'); },
        };
        const requestUrls = [];
        const requestBodies = [];
        const secret = 'memory-only-contract-test-key';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        vi.stubGlobal('localStorage', blockedLocal);
        vi.stubGlobal('sessionStorage', blockedSession);
        vi.stubGlobal('window', {
            location: { hostname: 'localhost' },
            sessionStorage: blockedSession,
            dispatchEvent() {},
        });
        vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
            requestUrls.push(String(url));
            if (!init.method || init.method === 'GET') return new Response('', { status: 404 });
            requestBodies.push(JSON.parse(init.body));
            return new Response(JSON.stringify({
                success: true,
                data: { epilogue: '完成' },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }));

        const preferences = await import('../../../scripts/aiModelPreference.js');
        const proxy = await import('../../../client/ai/aiProxy.js');
        preferences.setStoredApiKey('openai', secret);

        expect(preferences.getStoredApiKey('openai')).toBe(secret);
        await proxy.generate('epilogue', 'openai', {}, { stream: false });

        expect(requestBodies).toEqual([
            expect.objectContaining({ model: 'openai', apiKey: secret }),
        ]);
        expect(requestUrls).toEqual([
            'http://localhost:3001/session/challenge',
            'http://localhost:3001/ai/generate',
        ]);
        expect(JSON.stringify(localCalls)).not.toContain(secret);
        expect(JSON.stringify(logSpy.mock.calls)).not.toContain(secret);
    });

    it('supports SSE and one session-refresh retry', () => {
        expect(clientSource).toContain("contentType.includes('text/event-stream')");
        expect(clientSource).toContain("'wenjiang:story-delta'");
        expect(clientSource).toContain('allowSessionRetry && SESSION_ERROR_CODES.has(errorCode)');
        expect(clientSource).toContain('ensureSession(proxyBase, signal, true)');
    });

    it('negotiates streaming by Accept without adding forbidden body fields', () => {
        expect(clientSource).toContain("Accept: shouldStream ? 'text/event-stream' : 'application/json'");
        expect(clientSource).not.toContain('body.stream = true');
    });

    it('omits model when server task routing should choose the default', () => {
        expect(clientSource).toContain('const body = { task, context }');
        expect(clientSource).toContain('if (resolvedModel) body.model = resolvedModel');
        expect(clientSource).not.toContain('{ task, model: resolvedModel, context }');
    });

    it('passes the production cost guard for streamed story shape with no explicit model', async () => {
        const result = await validateGenerateBody({ task: 'story', context: { playerAction: '觀察' } });
        expect(result.next).toBe(true);
        expect(result.status).toBeNull();
        expect(result.req.aiModel).toBe('minimax');
    });

    it('documents why stream must never be serialized into the strict body', async () => {
        const result = await validateGenerateBody({ task: 'story', context: {}, stream: true });
        expect(result.status).toBe(400);
        expect(result.body.code).toBe('UNKNOWN_FIELD');
    });

    it('refreshes summaries every five rounds and retains the selected BYOK model', () => {
        expect(engineSource).toContain('round % 5 === 0');
        expect(engineSource).toContain("aiProxy.generate('summary', model || null");
        expect(engineSource).toContain('scheduleSummaryRefresh(profileId, roundData, model)');
    });
});
