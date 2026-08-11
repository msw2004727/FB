'use strict';

import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { EventEmitter, once } from 'events';

const { createApp } = require('../../server');
const aiRoutes = require('../../routes/aiRoutes');
const {
    createConcurrencyGuard,
    createCostProtection,
    createInstanceBudgetGuard,
    inspectJson,
} = require('../../middleware/costProtection');
const rateLimit = require('../../middleware/rateLimit');

const openServers = new Set();

afterEach(async () => {
    aiRoutes._internals.setAIProviderForTests(null);
    await Promise.all([...openServers].map(server => new Promise(resolve => server.close(resolve))));
    openServers.clear();
});

function productionEnv(overrides = {}) {
    return {
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://allowed.example',
        TRUST_PROXY_HOPS: '2',
        REQUIRE_ANON_SESSION: 'true',
        ANON_SESSION_SECRET: 'test-secret-with-at-least-thirty-two-characters',
        MINIMAX_API_KEY: 'test-minimax-provider-key-1234567890',
        SESSION_POW_DIFFICULTY: '4',
        SESSION_CHALLENGE_REQUESTS_PER_MINUTE: '20',
        RATE_LIMIT_SESSION_POINTS: '100',
        RATE_LIMIT_IP_POINTS: '100',
        INSTANCE_MAX_REQUESTS_PER_HOUR: '1000',
        INSTANCE_MAX_REQUESTS_PER_DAY: '1000',
        INSTANCE_MAX_ESTIMATED_USD_PER_HOUR: '100',
        INSTANCE_MAX_ESTIMATED_USD_PER_DAY: '100',
        ...overrides,
    };
}

async function withServer(env, callback) {
    const server = createApp(env).listen(0, '127.0.0.1');
    openServers.add(server);
    await once(server, 'listening');
    const address = server.address();
    return callback(`http://127.0.0.1:${address.port}`);
}

async function getSession(baseUrl, origin = 'https://allowed.example') {
    const challengeResponse = await fetch(`${baseUrl}/session/challenge`, { headers: { Origin: origin } });
    expect(challengeResponse.status).toBe(200);
    const challengeBody = await challengeResponse.json();
    const challenge = challengeBody.challenge;
    const solution = solvePow(challenge.token, challenge.difficulty);
    const sessionResponse = await fetch(`${baseUrl}/session`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: challenge.token, solution }),
    });
    return { challenge, solution, response: sessionResponse, body: await sessionResponse.json() };
}

function solvePow(token, difficulty) {
    for (let solution = 0; solution < 10_000_000; solution += 1) {
        const digest = crypto.createHash('sha256').update(`${token}.${solution}`).digest();
        if (leadingZeroBits(digest, difficulty)) return String(solution);
    }
    throw new Error('Unable to solve test proof of work');
}

function leadingZeroBits(buffer, bits) {
    let remaining = bits;
    for (const byte of buffer) {
        if (remaining <= 0) return true;
        if (remaining >= 8) {
            if (byte !== 0) return false;
            remaining -= 8;
        } else {
            return (byte >>> (8 - remaining)) === 0;
        }
    }
    return remaining <= 0;
}

describe('production HTTP boundary', () => {
    it('fails startup when production CORS is absent or wildcarded', () => {
        expect(() => createApp(productionEnv({ CORS_ORIGINS: '' }))).toThrow(/CORS_ORIGINS/);
        expect(() => createApp(productionEnv({ CORS_ORIGINS: '*' }))).toThrow(/CORS_ORIGINS/);
        expect(() => createApp(productionEnv({ CORS_ORIGINS: 'not-an-origin' }))).toThrow(/CORS_ORIGINS/);
    });

    it('fails startup for weak session configuration', () => {
        expect(() => createApp(productionEnv({ ANON_SESSION_SECRET: 'replace-with-at-least-32-random-characters' })))
            .toThrow(/ANON_SESSION_SECRET/);
        expect(() => createApp(productionEnv({ REQUIRE_ANON_SESSION: 'treu' })))
            .toThrow(/REQUIRE_ANON_SESSION/);
        expect(() => createApp(productionEnv({ SERVER_KEY_MODELS: 'openai' })))
            .toThrow(/SERVER_KEY_MODELS.*minimax/);
        expect(() => createApp(productionEnv({ MINIMAX_API_KEY: '' })))
            .toThrow(/MINIMAX_API_KEY/);
        expect(() => createApp(productionEnv({ MINIMAX_API_KEY: 'your-minimax-key-here' })))
            .toThrow(/MINIMAX_API_KEY/);
    });

    it('allows an allowlisted preflight and rejects another browser origin', async () => {
        await withServer(productionEnv(), async baseUrl => {
            const allowed = await fetch(`${baseUrl}/session/challenge`, {
                method: 'OPTIONS',
                headers: { Origin: 'https://allowed.example', 'Access-Control-Request-Method': 'GET' },
            });
            expect(allowed.status).toBe(204);
            expect(allowed.headers.get('access-control-allow-origin')).toBe('https://allowed.example');

            const rejected = await fetch(`${baseUrl}/session/challenge`, {
                headers: { Origin: 'https://attacker.example' },
            });
            expect(rejected.status).toBe(403);
            expect((await rejected.json()).code).toBe('ORIGIN_NOT_ALLOWED');
        });
    });

    it('sets a safe request id and API security headers', async () => {
        await withServer(productionEnv(), async baseUrl => {
            const response = await fetch(`${baseUrl}/health`, {
                headers: { 'X-Request-ID': '<script>bad</script>' },
            });
            expect(response.status).toBe(200);
            expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
            expect(response.headers.get('x-content-type-options')).toBe('nosniff');
            expect(response.headers.get('x-frame-options')).toBe('DENY');
            expect(response.headers.get('strict-transport-security')).toContain('max-age=');
            expect(response.headers.get('x-powered-by')).toBeNull();
        });
    });

    it('uses the trusted right-most proxy address rather than attacker XFF input', async () => {
        const env = productionEnv({ SESSION_CHALLENGE_REQUESTS_PER_MINUTE: '1' });
        await withServer(env, async baseUrl => {
            const first = await fetch(`${baseUrl}/session/challenge`, {
                headers: {
                    Origin: 'https://allowed.example',
                    'X-Forwarded-For': '203.0.113.10, 198.51.100.5, 192.0.2.250',
                },
            });
            expect(first.status).toBe(200);

            const second = await fetch(`${baseUrl}/session/challenge`, {
                headers: {
                    Origin: 'https://allowed.example',
                    'X-Forwarded-For': '203.0.113.99, 198.51.100.5, 192.0.2.250',
                },
            });
            expect(second.status).toBe(429);
        });
    });
});

describe('signed anonymous session challenge', () => {
    it('issues an origin-bound session and refuses challenge replay', async () => {
        await withServer(productionEnv(), async baseUrl => {
            const issued = await getSession(baseUrl);
            expect(issued.response.status).toBe(200);
            expect(issued.body.session.header).toBe('X-FB-Session');
            expect(issued.body.session.token).toEqual(expect.any(String));

            const replay = await fetch(`${baseUrl}/session`, {
                method: 'POST',
                headers: { Origin: 'https://allowed.example', 'Content-Type': 'application/json' },
                body: JSON.stringify({ challengeToken: issued.challenge.token, solution: issued.solution }),
            });
            expect(replay.status).toBe(409);
            expect((await replay.json()).code).toBe('CHALLENGE_REPLAYED');

            const guarded = await fetch(`${baseUrl}/ai/generate`, {
                method: 'POST',
                headers: {
                    Origin: 'https://allowed.example',
                    'Content-Type': 'application/json',
                    'X-FB-Session': issued.body.session.token,
                },
                body: JSON.stringify({ task: 'not-real', model: 'minimax', context: {} }),
            });
            expect(guarded.status).toBe(400);
            expect((await guarded.json()).code).toBe('TASK_NOT_ALLOWED');
        });
    });

    it('rejects a missing token before a provider call', async () => {
        await withServer(productionEnv(), async baseUrl => {
            const response = await fetch(`${baseUrl}/ai/generate`, {
                method: 'POST',
                headers: { Origin: 'https://allowed.example', 'Content-Type': 'application/json' },
                body: JSON.stringify({ task: 'summary', model: 'minimax', context: {} }),
            });
            expect(response.status).toBe(401);
            expect((await response.json()).code).toBe('SESSION_REQUIRED');
        });
    });
});

describe('cost and payload guardrails', () => {
    const noSession = { REQUIRE_ANON_SESSION: 'false' };

    it('keeps image generation disabled by default', async () => {
        await withServer(productionEnv(), async baseUrl => {
            const response = await fetch(`${baseUrl}/ai/image`, {
                method: 'POST',
                headers: { Origin: 'https://allowed.example', 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: 'expensive image' }),
            });
            expect(response.status).toBe(404);
            expect((await response.json()).code).toBe('IMAGE_GENERATION_DISABLED');
        });
    });

    it('enforces task, model, top-level field and BYOK allowlists', async () => {
        await withServer(productionEnv(noSession), async baseUrl => {
            const requests = [
                [{ task: 'unknown', model: 'minimax', context: {} }, 'TASK_NOT_ALLOWED', 400],
                [{ task: 'summary', model: 'made-up', context: {} }, 'MODEL_NOT_ALLOWED', 400],
                [{ task: 'summary', model: 'openai', context: {} }, 'USER_API_KEY_REQUIRED', 403],
                [{ task: 'summary', model: 'minimax', context: {}, surprise: true }, 'UNKNOWN_FIELD', 400],
            ];
            for (const [body, code, status] of requests) {
                const response = await fetch(`${baseUrl}/ai/generate`, {
                    method: 'POST',
                    headers: { Origin: 'https://allowed.example', 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                expect(response.status).toBe(status);
                expect((await response.json()).code).toBe(code);
            }
        });
    });

    it('rejects malformed JSON and oversized bodies', async () => {
        await withServer(productionEnv({ ...noSession, MAX_JSON_BYTES: '16384' }), async baseUrl => {
            const malformed = await fetch(`${baseUrl}/ai/generate`, {
                method: 'POST',
                headers: { Origin: 'https://allowed.example', 'Content-Type': 'application/json' },
                body: '{',
            });
            expect(malformed.status).toBe(400);
            expect((await malformed.json()).code).toBe('INVALID_JSON');

            const oversized = await fetch(`${baseUrl}/ai/generate`, {
                method: 'POST',
                headers: { Origin: 'https://allowed.example', 'Content-Type': 'application/json' },
                body: JSON.stringify({ task: 'summary', model: 'minimax', context: { text: 'x'.repeat(20_000) } }),
            });
            expect(oversized.status).toBe(413);
            expect((await oversized.json()).code).toBe('PAYLOAD_TOO_LARGE');
        });
    });

    it('opens the configured estimated-cost circuit before a provider call', async () => {
        await withServer(productionEnv({
            ...noSession,
            INSTANCE_MAX_ESTIMATED_USD_PER_HOUR: '0.001',
        }), async baseUrl => {
            const response = await fetch(`${baseUrl}/ai/generate`, {
                method: 'POST',
                headers: { Origin: 'https://allowed.example', 'Content-Type': 'application/json' },
                body: JSON.stringify({ task: 'summary', model: 'minimax', context: {} }),
            });
            expect(response.status).toBe(503);
            expect((await response.json()).code).toBe('INSTANCE_BUDGET_LIMIT');
        });
    });

    it('rolls back owner budget when prompt construction fails before the provider call', async () => {
        const provider = {
            callAI: vi.fn().mockResolvedValue('{"summary":"有效摘要"}'),
            streamAI: vi.fn(),
        };
        aiRoutes._internals.setAIProviderForTests(provider);
        await withServer(productionEnv({
            ...noSession,
            INSTANCE_MAX_REQUESTS_PER_HOUR: '1',
            INSTANCE_MAX_REQUESTS_PER_DAY: '1',
        }), async baseUrl => {
            const malformed = await fetch(`${baseUrl}/ai/generate`, {
                method: 'POST',
                headers: { Origin: 'https://allowed.example', 'Content-Type': 'application/json' },
                body: JSON.stringify({ task: 'prequel', model: 'minimax', context: {} }),
            });
            expect(malformed.status).toBe(500);
            expect(provider.callAI).not.toHaveBeenCalled();

            const valid = await fetch(`${baseUrl}/ai/generate`, {
                method: 'POST',
                headers: { Origin: 'https://allowed.example', 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task: 'summary', model: 'minimax',
                    context: { oldSummary: '舊摘要', newRoundData: { rounds: [] }, revision: 1 },
                }),
            });
            expect(valid.status).toBe(200);
            expect(provider.callAI).toHaveBeenCalledOnce();
        });
    });

    it('uses the BYOK estimate only outside configured server-key models', () => {
        const protection = createCostProtection({
            env: {
                SERVER_KEY_MODELS: 'minimax',
                ESTIMATED_BYOK_REQUEST_USD: '0.0001',
                ESTIMATED_DEFAULT_TASK_USD: '0.01',
            },
        });
        const byok = {
            method: 'POST',
            path: '/generate',
            body: { task: 'summary', model: 'openai', context: {}, apiKey: 'sk-user-test-key' },
            is: () => true,
        };
        const minimaxWithFakeKey = {
            method: 'POST',
            path: '/generate',
            body: { task: 'summary', model: 'minimax', context: {}, apiKey: 'fake-key-that-is-ignored' },
            is: () => true,
        };

        protection.validate(byok, mockResponse(), vi.fn());
        protection.validate(minimaxWithFakeKey, mockResponse(), vi.fn());

        expect(byok.isByok).toBe(true);
        expect(byok.estimatedCostUsd).toBe(0.0001);
        expect(minimaxWithFakeKey.isByok).toBe(false);
        expect(minimaxWithFakeKey.estimatedCostUsd).toBe(0.005);
    });

    it('does not let BYOK traffic consume the owner-funded instance budget', () => {
        const guard = createInstanceBudgetGuard({
            INSTANCE_MAX_REQUESTS_PER_HOUR: '1',
            INSTANCE_MAX_REQUESTS_PER_DAY: '1',
            INSTANCE_MAX_ESTIMATED_USD_PER_HOUR: '1',
            INSTANCE_MAX_ESTIMATED_USD_PER_DAY: '1',
        }, () => Date.UTC(2026, 7, 11, 6, 0, 0));
        const byokNext = vi.fn();
        guard({ isByok: true, id: 'byok-1' }, mockResponse(), byokNext);
        guard({ isByok: true, id: 'byok-2' }, mockResponse(), byokNext);
        expect(byokNext).toHaveBeenCalledTimes(2);

        const ownerNext = vi.fn();
        guard({ isByok: false, estimatedCostUsd: 0.01, id: 'owner-1' }, mockResponse(), ownerNext);
        expect(ownerNext).toHaveBeenCalledOnce();

        const blockedResponse = mockResponse();
        guard({ isByok: false, estimatedCostUsd: 0.01, id: 'owner-2' }, blockedResponse, vi.fn());
        expect(blockedResponse.status).toHaveBeenCalledWith(503);
        expect(blockedResponse.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'INSTANCE_BUDGET_LIMIT',
        }));
    });

    it('rejects deep or dangerous context structures', () => {
        expect(inspectJson({ a: { b: { c: true } } }, {
            maxDepth: 2,
            maxNodes: 20,
            maxStringBytes: 100,
        })).toEqual({ ok: false, error: 'Context is nested too deeply' });

        const dangerous = JSON.parse('{"__proto__":{"polluted":true}}');
        expect(inspectJson(dangerous, {
            maxDepth: 5,
            maxNodes: 20,
            maxStringBytes: 100,
        })).toEqual({ ok: false, error: 'Context contains a forbidden key' });

        expect(inspectJson({ amount: Infinity }, {
            maxDepth: 5,
            maxNodes: 20,
            maxStringBytes: 100,
        })).toEqual({ ok: false, error: 'Context contains a non-finite number' });
    });
});

describe('concurrency guard', () => {
    it('rejects excess work and releases its slot on finish', () => {
        const guard = createConcurrencyGuard({ MAX_CONCURRENT_AI_REQUESTS: '1' });
        const firstRes = mockResponse();
        const secondRes = mockResponse();
        const thirdRes = mockResponse();
        const nextOne = vi.fn();
        const nextTwo = vi.fn();
        const nextThree = vi.fn();

        guard({ id: 'one' }, firstRes, nextOne);
        guard({ id: 'two' }, secondRes, nextTwo);
        expect(nextOne).toHaveBeenCalledOnce();
        expect(nextTwo).not.toHaveBeenCalled();
        expect(secondRes.status).toHaveBeenCalledWith(503);

        firstRes.emit('finish');
        guard({ id: 'three' }, thirdRes, nextThree);
        expect(nextThree).toHaveBeenCalledOnce();
    });

    it('does not charge owner budget for a request rejected by concurrency', () => {
        const protection = createCostProtection({
            env: {
                MAX_CONCURRENT_AI_REQUESTS: '1',
                INSTANCE_MAX_REQUESTS_PER_HOUR: '2',
                INSTANCE_MAX_REQUESTS_PER_DAY: '2',
                INSTANCE_MAX_ESTIMATED_USD_PER_HOUR: '1',
                INSTANCE_MAX_ESTIMATED_USD_PER_DAY: '1',
            },
            now: () => Date.UTC(2026, 7, 11, 6, 0, 0),
        });
        const enterProtectedWork = (request, response, next) => {
            protection.concurrency(request, response, () => {
                protection.budgetGuard(request, response, next);
            });
        };

        const firstResponse = mockResponse();
        const firstNext = vi.fn();
        enterProtectedWork({ id: 'owner-1', isByok: false, estimatedCostUsd: 0.01 }, firstResponse, firstNext);
        expect(firstNext).toHaveBeenCalledOnce();

        const rejectedResponse = mockResponse();
        enterProtectedWork({ id: 'owner-rejected', isByok: false, estimatedCostUsd: 0.01 }, rejectedResponse, vi.fn());
        expect(rejectedResponse.status).toHaveBeenCalledWith(503);
        firstResponse.emit('finish');

        const secondAccepted = vi.fn();
        enterProtectedWork({ id: 'owner-2', isByok: false, estimatedCostUsd: 0.01 }, mockResponse(), secondAccepted);
        expect(secondAccepted).toHaveBeenCalledOnce();

        const serverSource = require('fs').readFileSync(require('path').join(__dirname, '../../server.js'), 'utf8');
        expect(serverSource.indexOf('protection.concurrency')).toBeLessThan(serverSource.indexOf('protection.budgetGuard'));
    });
});

describe('weighted session and IP limiter', () => {
    it('charges a story-sized request three points and then blocks it', () => {
        const limiter = rateLimit({
            maxPoints: 3,
            windowMs: 60_000,
            getWeight: () => 3,
            markSecurityLimited: true,
            scopes: [
                { name: 'session', maxPoints: 3, key: req => req.anonymousSessionId },
                { name: 'ip', maxPoints: 6, key: req => req.ip },
            ],
        });
        const request = { id: 'weighted', ip: '192.0.2.1', anonymousSessionId: 'session-a' };
        const first = mockResponse();
        const second = mockResponse();
        const nextOne = vi.fn();
        const nextTwo = vi.fn();

        limiter(request, first, nextOne);
        // Simulate a separate request; the legacy route limiter skip marker is
        // per-request and must not suppress this call.
        delete request.securityRateLimitApplied;
        limiter(request, second, nextTwo);

        expect(nextOne).toHaveBeenCalledOnce();
        expect(first.set).toHaveBeenCalledWith('RateLimit-Remaining', '0');
        expect(nextTwo).not.toHaveBeenCalled();
        expect(second.status).toHaveBeenCalledWith(429);
    });
});

function mockResponse() {
    const response = new EventEmitter();
    response.set = vi.fn();
    response.status = vi.fn().mockReturnValue(response);
    response.json = vi.fn().mockReturnValue(response);
    return response;
}
