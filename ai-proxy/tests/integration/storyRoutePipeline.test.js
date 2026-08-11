import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

const providerMocks = {
    callAI: vi.fn(),
    streamAI: vi.fn(),
};

const aiRoutes = require('../../routes/aiRoutes');

const providerResult = JSON.stringify({
    story: '這是一段整合測試故事。'.repeat(42).slice(0, 470),
    roundData: {
        R: 1,
        playerState: 'alive',
        timeOfDay: '午後',
        moralityChange: 0,
        EVT: '測試事件',
        LOC: ['無名村'],
        PC: '狀態穩定',
        NPC: [],
        WRD: '晴朗',
        actionOptions: ['仔細觀察周圍動靜', '上前詢問事情原委', '暫退安全處再作打算'],
        actionMorality: [0, 1, -1],
        suggestion: '先觀察再行動。',
        progressEval: {
            triggered: false,
            reason: '尚無明確證據',
            questJournal: '持續追查線索。',
        },
    },
});

let server;
let baseUrl;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/ai', aiRoutes);
    app.use((error, _req, res, _next) => res.status(500).json({ success: false, error: error.message }));
    await new Promise(resolve => {
        server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    aiRoutes._internals.setAIProviderForTests(null);
    if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
    providerMocks.callAI.mockReset();
    providerMocks.streamAI.mockReset();
    providerMocks.callAI.mockResolvedValue(providerResult);
    providerMocks.streamAI.mockImplementation(async (_model, _prompt, _json, _config, _key, onDelta) => {
        for (let index = 0; index < providerResult.length; index += 37) {
            await onDelta(providerResult.slice(index, index + 37));
        }
        return { text: providerResult, streamed: true };
    });
    aiRoutes._internals.setAIProviderForTests(providerMocks);
});

function requestBody() {
    return {
        task: 'story',
        context: {
            currentRound: 0,
            playerAction: '觀察四周',
            player: {
                id: 'test-player', username: '測試者', scenario: 'wuxia',
                currentLocation: ['無名村'], currentTimeOfDay: '上午', R: 0,
            },
            recentHistory: [],
            achievedMilestones: [],
            cluesSummary: '',
        },
    };
}

describe('POST /ai/generate story integration', () => {
    it('uses exactly one provider call in backward-compatible JSON mode', async () => {
        const response = await fetch(`${baseUrl}/ai/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(requestBody()),
        });
        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.success).toBe(true);
        expect(payload.data.roundData.actionOptions).toHaveLength(3);
        expect(payload.data.roundData.progressEval.triggered).toBe(false);
        expect(providerMocks.callAI).toHaveBeenCalledTimes(1);
        expect(providerMocks.streamAI).not.toHaveBeenCalled();
    });

    it('negotiates SSE only through Accept and emits incremental story text', async () => {
        const body = requestBody();
        expect(body).not.toHaveProperty('stream');
        expect(body).not.toHaveProperty('model');
        const response = await fetch(`${baseUrl}/ai/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify(body),
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/event-stream');
        const events = await response.text();
        expect(events).toContain('event: story_delta');
        expect(events).toContain('event: result');
        expect(providerMocks.streamAI).toHaveBeenCalledTimes(1);
        expect(providerMocks.callAI).not.toHaveBeenCalled();
    });

    it('does not let a body field bypass Accept transport negotiation', async () => {
        const response = await fetch(`${baseUrl}/ai/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ ...requestBody(), stream: true }),
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(providerMocks.callAI).toHaveBeenCalledTimes(1);
        expect(providerMocks.streamAI).not.toHaveBeenCalled();
    });

    it.each([
        ['omitted Accept', undefined],
        ['wildcard Accept', '*/*'],
    ])('keeps legacy JSON transport for %s', async (_label, accept) => {
        const headers = { 'Content-Type': 'application/json' };
        if (accept) headers.Accept = accept;
        const response = await fetch(`${baseUrl}/ai/generate`, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody()),
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect((await response.json()).success).toBe(true);
        expect(providerMocks.callAI).toHaveBeenCalledTimes(1);
        expect(providerMocks.streamAI).not.toHaveBeenCalled();
    });
});
