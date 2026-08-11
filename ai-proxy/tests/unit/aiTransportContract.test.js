import { afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import http from 'node:http';
import path from 'path';
import { OpenAI } from 'openai';

const { createCostProtection } = require('../../middleware/costProtection');
const {
    callAI,
    streamAI,
    _internals: aiServiceInternals,
} = require('../../services/aiService');

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
    aiServiceInternals.setMinimaxClientForTests(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('AI transport hardening contract', () => {
    const serviceSource = fs.readFileSync(path.join(__dirname, '../../services/aiService.js'), 'utf8');
    const clientSource = fs.readFileSync(path.join(__dirname, '../../../client/ai/aiProxy.js'), 'utf8');
    const engineSource = fs.readFileSync(path.join(__dirname, '../../../client/engine/gameEngine.js'), 'utf8');
    const gameLoopSource = fs.readFileSync(path.join(__dirname, '../../../scripts/gameLoop.js'), 'utf8');

    it('uses official MiniMax endpoint and bounded request controls', () => {
        expect(serviceSource).toContain("'https://api.minimax.io/v1'");
        expect(serviceSource).toContain('max_completion_tokens');
        expect(serviceSource).toContain('maxRetries: DEFAULT_MAX_RETRIES');
        expect(serviceSource).toContain('createDeadlineSignal');
    });

    it('normalizes upstream 429 and MiniMax 2056 without leaking provider text', () => {
        const rawMessage = 'Token Plan usage limit reached: secret provider detail';
        const fromStatus = aiServiceInternals.normalizeProviderError({
            status: 429,
            code: 'rate_limit_exceeded',
            message: rawMessage,
        });
        const fromCode = aiServiceInternals.normalizeProviderError({
            status: 400,
            body: { error: { code: 2056, message: rawMessage } },
        });

        for (const error of [fromStatus, fromCode]) {
            expect(error.status).toBe(503);
            expect(error.code).toBe('PROVIDER_QUOTA_EXHAUSTED');
            expect(error.retryable).toBe(false);
            expect(error.message).toContain('自備 API Key（BYOK）');
            expect(error.message).not.toContain(rawMessage);
            expect(aiServiceInternals.publicProviderErrorPayload(error, 'request-1')).toMatchObject({
                success: false,
                status: 503,
                code: 'PROVIDER_QUOTA_EXHAUSTED',
                retryable: false,
                request_id: 'request-1',
            });
        }
    });

    it.each([
        ['raw base_resp', { raw: { base_resp: { status_code: 2056 } } }],
        ['body status_code', { body: { status_code: 1008 } }],
        ['response data base_resp', { response: { data: { base_resp: { status_code: 2056 } } } }],
    ])('recognizes MiniMax quota metadata from %s', (_label, providerError) => {
        const error = aiServiceInternals.normalizeProviderError(providerError);
        expect(error).toMatchObject({
            status: 503,
            code: 'PROVIDER_QUOTA_EXHAUSTED',
            retryable: false,
        });
    });

    it('rejects a raw MiniMax HTTP-200 JSON quota response before parsing or fallback', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const create = vi.fn().mockResolvedValue({
            id: 'provider-response',
            base_resp: {
                status_code: 2056,
                status_msg: 'Token Plan usage limit reached: private JSON detail',
            },
            choices: [{ message: { content: '{"story":"must not be used"}' } }],
        });
        aiServiceInternals.setMinimaxClientForTests({ chat: { completions: { create } } });
        vi.stubEnv('MINIMAX_API_KEY', 'test-minimax-key');

        let caught;
        try {
            await callAI('minimax', '測試', true, { requestId: 'json-quota-test' });
        } catch (error) {
            caught = error;
        }

        expect(caught).toMatchObject({
            status: 503,
            code: 'PROVIDER_QUOTA_EXHAUSTED',
            retryable: false,
        });
        expect(caught.message).toContain('自備 API Key（BYOK）');
        expect(caught.message).not.toContain('Token Plan');
        expect(caught.message).not.toContain('must not be used');
        expect(create).toHaveBeenCalledOnce();
        expect(JSON.stringify(logSpy.mock.calls)).not.toContain('Token Plan');
        expect(JSON.stringify(logSpy.mock.calls)).not.toContain('must not be used');
    });

    it('rejects a raw MiniMax HTTP-200 SSE quota chunk without emitting fallback text', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const providerStream = {
            async *[Symbol.asyncIterator]() {
                yield {
                    base_resp: {
                        status_code: 1008,
                        status_msg: 'insufficient balance: private SSE detail',
                    },
                    choices: [{ delta: { content: '{"story":"must not stream"}' } }],
                };
            },
        };
        const create = vi.fn().mockResolvedValue(providerStream);
        const onDelta = vi.fn();
        aiServiceInternals.setMinimaxClientForTests({ chat: { completions: { create } } });
        vi.stubEnv('MINIMAX_API_KEY', 'test-minimax-key');

        let caught;
        try {
            await streamAI('minimax', '測試', true, { requestId: 'sse-quota-test' }, null, onDelta);
        } catch (error) {
            caught = error;
        }

        expect(caught).toMatchObject({
            status: 503,
            code: 'PROVIDER_QUOTA_EXHAUSTED',
            retryable: false,
            partial: false,
        });
        expect(caught.message).not.toContain('insufficient balance');
        expect(onDelta).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledOnce();
        expect(JSON.stringify(logSpy.mock.calls)).not.toContain('insufficient balance');
        expect(JSON.stringify(logSpy.mock.calls)).not.toContain('must not stream');
    });

    it('rejects MiniMax HTTP-200 JSON bodies before the real OpenAI SDK SSE parser', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const responses = [
            {
                base_resp: {
                    status_code: 2056,
                    status_msg: 'Token Plan private local-server detail',
                },
                choices: [{ delta: { content: 'quota fallback must not stream' } }],
            },
            {
                base_resp: { status_code: 0, status_msg: 'success-shaped JSON is still not SSE' },
                choices: [{ delta: { content: 'status-zero fallback must not stream' } }],
            },
        ];
        let requestCount = 0;
        const providerServer = http.createServer((_req, res) => {
            const payload = responses[Math.min(requestCount, responses.length - 1)];
            requestCount += 1;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(payload));
        });
        await new Promise(resolve => providerServer.listen(0, '127.0.0.1', resolve));

        try {
            const address = providerServer.address();
            const client = new OpenAI({
                apiKey: 'local-sdk-regression-key',
                baseURL: `http://127.0.0.1:${address.port}/v1`,
                maxRetries: 0,
            });
            aiServiceInternals.setMinimaxClientForTests(client);
            vi.stubEnv('MINIMAX_API_KEY', 'test-minimax-key');
            const onDelta = vi.fn();

            const errors = [];
            for (let index = 0; index < responses.length; index += 1) {
                try {
                    await streamAI('minimax', '測試', true, { requestId: `real-sdk-${index}` }, null, onDelta);
                } catch (error) {
                    errors.push(error);
                }
            }

            expect(errors).toHaveLength(2);
            expect(errors[0]).toMatchObject({
                status: 503,
                code: 'PROVIDER_QUOTA_EXHAUSTED',
                retryable: false,
                partial: false,
            });
            expect(errors[1]).toMatchObject({
                status: 503,
                code: 'PROVIDER_RESPONSE_REJECTED',
                retryable: false,
                partial: false,
            });
            expect(onDelta).not.toHaveBeenCalled();
            expect(requestCount).toBe(2);
            const publicSurface = JSON.stringify({
                errors: errors.map(error => ({ message: error.message, code: error.code })),
                logs: logSpy.mock.calls,
            });
            expect(publicSurface).not.toContain('Token Plan');
            expect(publicSurface).not.toContain('fallback must not stream');
            expect(publicSurface).not.toContain('success-shaped JSON');
        } finally {
            await new Promise(resolve => providerServer.close(resolve));
        }
    });

    it('keeps generic provider failures safe for SSE clients', () => {
        const error = aiServiceInternals.normalizeProviderError(new Error('private upstream response body'));
        expect(error.status).toBe(502);
        expect(error.code).toBe('AI_PROVIDER_ERROR');
        expect(error.message).not.toContain('private upstream response body');
    });

    it('treats every non-zero MiniMax base response as a safe non-retryable 503', () => {
        let raw;
        try {
            aiServiceInternals.assertMinimaxResponseSucceeded({
                base_resp: { status_code: 9999, status_msg: 'private provider rejection' },
            });
        } catch (error) {
            raw = error;
        }
        const error = aiServiceInternals.normalizeProviderError(raw);
        expect(error).toMatchObject({
            status: 503,
            code: 'PROVIDER_RESPONSE_REJECTED',
            retryable: false,
        });
        expect(error.message).not.toContain('private provider rejection');
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
        expect(clientSource).toContain("PROVIDER_QUOTA_CODE = 'PROVIDER_QUOTA_EXHAUSTED'");
        expect(clientSource).toContain('error.retryable = code === PROVIDER_QUOTA_CODE ? false');
        expect(gameLoopSource).toContain('if (error.retryable !== false)');
    });

    it('preserves non-retryable quota metadata for the frontend without exposing upstream text', async () => {
        vi.resetModules();
        const storage = { getItem: () => null, setItem() {}, removeItem() {} };
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('sessionStorage', storage);
        vi.stubGlobal('window', {
            location: { hostname: 'localhost' },
            dispatchEvent() {},
        });
        vi.stubGlobal('fetch', vi.fn(async (_url, init = {}) => {
            if (!init.method || init.method === 'GET') return new Response('', { status: 404 });
            return new Response(JSON.stringify({
                success: false,
                code: 'PROVIDER_QUOTA_EXHAUSTED',
                error: 'unsafe upstream Token Plan text',
                retryable: false,
                status: 503,
            }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
            });
        }));

        const proxy = await import('../../../client/ai/aiProxy.js');
        let caught;
        try {
            await proxy.generate('story', null, {}, { stream: true });
        } catch (error) {
            caught = error;
        }

        expect(caught).toMatchObject({
            code: 'PROVIDER_QUOTA_EXHAUSTED',
            status: 503,
            retryable: false,
        });
        expect(caught.message).toContain('自備 API Key（BYOK）');
        expect(caught.message).not.toContain('Token Plan');
        expect(fetch).toHaveBeenCalledTimes(2);
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
