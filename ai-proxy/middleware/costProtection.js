'use strict';

const rateLimit = require('./rateLimit');

const ALLOWED_TASKS = new Set([
    'story', 'progress-evaluator', 'narrative', 'prequel', 'epilogue', 'death-cause',
    'summary', 'action-classifier', 'suggestion', 'anachronism',
    'combat', 'combat-setup', 'surrender', 'post-combat',
    'npc-profile', 'npc-chat', 'npc-chat-summary', 'npc-memory',
    'give-item', 'give-narrative', 'proactive-chat', 'location-generator',
]);

const DEFAULT_MODELS = new Set(['minimax', 'openai', 'deepseek', 'grok', 'gemini', 'gemma', 'claude']);
const HIGH_COST_TASKS = new Set(['story', 'epilogue', 'combat', 'post-combat', 'npc-chat']);
const MEDIUM_COST_TASKS = new Set(['summary', 'npc-profile', 'npc-chat-summary', 'relation-graph']);
const GENERATE_FIELDS = new Set(['task', 'model', 'context', 'apiKey']);
const IMAGE_FIELDS = new Set(['prompt']);

function createCostProtection(options = {}) {
    const env = options.env || process.env;
    const now = options.now || (() => Date.now());
    const allowedModels = parseAllowlist(env.ALLOWED_AI_MODELS, DEFAULT_MODELS);
    const serverKeyModels = parseAllowlist(env.SERVER_KEY_MODELS, new Set(['minimax']));
    if (env.NODE_ENV === 'production' && !serverKeyModels.has('minimax')) {
        throw new Error('SERVER_KEY_MODELS must include minimax because the MiniMax adapter always uses the owner key');
    }
    if (env.NODE_ENV === 'production' && isWeakProviderKey(env.MINIMAX_API_KEY)) {
        throw new Error('MINIMAX_API_KEY must be a non-placeholder provider key in production');
    }
    const maxContextBytes = boundedInteger(env.MAX_CONTEXT_BYTES, 96 * 1024, 1024, 512 * 1024);
    const maxContextDepth = boundedInteger(env.MAX_CONTEXT_DEPTH, 12, 3, 30);
    const maxContextNodes = boundedInteger(env.MAX_CONTEXT_NODES, 5000, 100, 50_000);
    const maxStringBytes = boundedInteger(env.MAX_CONTEXT_STRING_BYTES, 32 * 1024, 1024, 128 * 1024);
    const imageEnabled = String(env.ENABLE_IMAGE_GENERATION || '').toLowerCase() === 'true';

    const taskWeight = req => {
        if (req.path === '/image') return 16;
        const task = req.body?.task;
        if (task === 'story') return 3;
        if (HIGH_COST_TASKS.has(task)) return 2;
        return 1;
    };

    const weightedLimiter = rateLimit({
        windowMs: boundedInteger(env.RATE_LIMIT_WINDOW_MS, 60_000, 1000, 60 * 60 * 1000),
        maxPoints: boundedNumber(env.RATE_LIMIT_SESSION_POINTS, 24, 1, 100_000),
        getWeight: taskWeight,
        markSecurityLimited: true,
        scopes: [
            {
                name: 'session',
                maxPoints: boundedNumber(env.RATE_LIMIT_SESSION_POINTS, 24, 1, 100_000),
                key: req => req.anonymousSessionId || `no-session:${req.ip || req.socket?.remoteAddress || 'unknown'}`,
            },
            {
                name: 'ip',
                maxPoints: boundedNumber(env.RATE_LIMIT_IP_POINTS, 48, 1, 100_000),
                key: req => req.ip || req.socket?.remoteAddress || 'unknown',
            },
        ],
    });

    const budgetGuard = createInstanceBudgetGuard(env, now);
    const concurrency = createConcurrencyGuard(env);

    function imageGate(req, res, next) {
        if (req.path === '/image' && !imageEnabled) {
            return res.status(404).json({
                success: false,
                code: 'IMAGE_GENERATION_DISABLED',
                error: 'Image generation is disabled',
                requestId: req.id,
            });
        }
        next();
    }

    function validate(req, res, next) {
        if (req.path !== '/generate' && req.path !== '/image') {
            return reject(res, req, 404, 'NOT_FOUND', 'Route not found');
        }
        if (req.method !== 'POST') {
            res.set('Allow', 'POST');
            return reject(res, req, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
        }
        if (!req.is('application/json')) return reject(res, req, 415, 'JSON_REQUIRED', 'Content-Type must be application/json');
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return reject(res, req, 400, 'INVALID_BODY', 'Request body must be a JSON object');
        }

        if (req.path === '/image') {
            if (Object.keys(req.body).some(key => !IMAGE_FIELDS.has(key))) {
                return reject(res, req, 400, 'UNKNOWN_FIELD', 'Image request contains an unknown field');
            }
            if (typeof req.body.prompt !== 'string' || req.body.prompt.trim().length < 1 ||
                Buffer.byteLength(req.body.prompt, 'utf8') > 4000) {
                return reject(res, req, 400, 'INVALID_IMAGE_PROMPT', 'Image prompt must be between 1 and 4000 bytes');
            }
            req.estimatedCostUsd = estimateCost(req, env);
            return next();
        }
        if (req.path !== '/generate') return next();

        if (Object.keys(req.body).some(key => !GENERATE_FIELDS.has(key))) {
            return reject(res, req, 400, 'UNKNOWN_FIELD', 'AI request contains an unknown field');
        }

        const { task, model = 'minimax', context, apiKey } = req.body;
        if (typeof task !== 'string' || !ALLOWED_TASKS.has(task)) {
            return reject(res, req, 400, 'TASK_NOT_ALLOWED', 'Unknown or disallowed AI task');
        }
        if (typeof model !== 'string' || !allowedModels.has(model)) {
            return reject(res, req, 400, 'MODEL_NOT_ALLOWED', 'Unknown or disallowed AI model');
        }
        if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 512)) {
            return reject(res, req, 400, 'INVALID_API_KEY', 'Invalid user-provided API key');
        }
        if (!serverKeyModels.has(model) && !apiKey) {
            return reject(res, req, 403, 'USER_API_KEY_REQUIRED', 'This model requires a user-provided API key');
        }
        if (!context || typeof context !== 'object' || Array.isArray(context)) {
            return reject(res, req, 400, 'INVALID_CONTEXT', 'Context must be a JSON object');
        }

        const contextBytes = Buffer.byteLength(JSON.stringify(context), 'utf8');
        if (contextBytes > maxContextBytes) {
            return reject(res, req, 413, 'CONTEXT_TOO_LARGE', 'AI context is too large');
        }
        const inspection = inspectJson(context, { maxDepth: maxContextDepth, maxNodes: maxContextNodes, maxStringBytes });
        if (!inspection.ok) return reject(res, req, 400, 'INVALID_CONTEXT', inspection.error);

        req.aiTask = task;
        req.aiModel = model;
        // Never infer BYOK from the mere presence of an apiKey. In particular,
        // MiniMax currently ignores a supplied key and always uses the owner
        // credential. SERVER_KEY_MODELS is the explicit funding boundary.
        req.isByok = Boolean(apiKey) && !serverKeyModels.has(model);
        req.estimatedCostUsd = estimateCost(req, env);
        next();
    }

    return { imageGate, validate, weightedLimiter, budgetGuard, concurrency, taskWeight };
}

function inspectJson(root, limits) {
    const stack = [{ value: root, depth: 0 }];
    let nodes = 0;
    while (stack.length) {
        const { value, depth } = stack.pop();
        nodes += 1;
        if (nodes > limits.maxNodes) return { ok: false, error: 'Context contains too many values' };
        if (depth > limits.maxDepth) return { ok: false, error: 'Context is nested too deeply' };
        if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > limits.maxStringBytes) {
            return { ok: false, error: 'Context contains an oversized string' };
        }
        if (typeof value === 'number' && !Number.isFinite(value)) {
            return { ok: false, error: 'Context contains a non-finite number' };
        }
        if (!value || typeof value !== 'object') continue;
        for (const [key, child] of Object.entries(value)) {
            if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
                return { ok: false, error: 'Context contains a forbidden key' };
            }
            stack.push({ value: child, depth: depth + 1 });
        }
    }
    return { ok: true };
}

function createConcurrencyGuard(env) {
    const maxConcurrent = boundedInteger(env.MAX_CONCURRENT_AI_REQUESTS, 4, 1, 1000);
    let active = 0;
    return (req, res, next) => {
        if (active >= maxConcurrent) {
            res.set('Retry-After', '5');
            return reject(res, req, 503, 'CONCURRENCY_LIMIT', 'AI service is busy; retry shortly');
        }
        active += 1;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            active = Math.max(0, active - 1);
        };
        res.once('finish', release);
        res.once('close', release);
        next();
    };
}

function createInstanceBudgetGuard(env, now) {
    const limits = {
        hourlyRequests: nonNegativeNumber(env.INSTANCE_MAX_REQUESTS_PER_HOUR, 300),
        dailyRequests: nonNegativeNumber(env.INSTANCE_MAX_REQUESTS_PER_DAY, 3000),
        hourlyUsd: nonNegativeNumber(env.INSTANCE_MAX_ESTIMATED_USD_PER_HOUR, 5),
        dailyUsd: nonNegativeNumber(env.INSTANCE_MAX_ESTIMATED_USD_PER_DAY, 25),
    };
    let hour = emptyWindow('hour', now());
    let day = emptyWindow('day', now());

    return (req, res, next) => {
        // BYOK traffic is still bounded by the per-session/IP limiter and the
        // concurrency guard, but it must not consume the owner's provider
        // budget window. Otherwise an attacker can submit a fake third-party
        // key repeatedly and force every owner-funded MiniMax request into a
        // 503 circuit-breaker response without spending the owner's money.
        if (req.isByok === true) return next();

        const timestamp = now();
        if (timestamp >= hour.endsAt) hour = emptyWindow('hour', timestamp);
        if (timestamp >= day.endsAt) day = emptyWindow('day', timestamp);
        const estimatedUsd = Number.isFinite(req.estimatedCostUsd) ? req.estimatedCostUsd : estimateCost(req, env);

        const hourlyBlocked = exceeds(hour.requests, 1, limits.hourlyRequests) || exceeds(hour.usd, estimatedUsd, limits.hourlyUsd);
        const dailyBlocked = exceeds(day.requests, 1, limits.dailyRequests) || exceeds(day.usd, estimatedUsd, limits.dailyUsd);
        if (hourlyBlocked || dailyBlocked) {
            const retryAt = hourlyBlocked ? hour.endsAt : day.endsAt;
            res.set('Retry-After', String(Math.max(1, Math.ceil((retryAt - timestamp) / 1000))));
            console.warn(JSON.stringify({
                event: 'instance_budget_guard_open',
                requestId: req.id,
                task: req.aiTask || (req.path === '/image' ? 'image' : 'unknown'),
                window: hourlyBlocked ? 'hour' : 'day',
            }));
            return reject(res, req, 503, 'INSTANCE_BUDGET_LIMIT', 'AI service budget guard is temporarily open');
        }

        hour.requests += 1;
        hour.usd += estimatedUsd;
        day.requests += 1;
        day.usd += estimatedUsd;

        // Prompt construction still happens inside the route. If it rejects the
        // context before any provider call, release this reservation on response
        // completion so malformed traffic cannot burn the owner's entire window.
        const reservedHour = hour;
        const reservedDay = day;
        let reservationSettled = false;
        const settleReservation = () => {
            if (reservationSettled) return;
            reservationSettled = true;
            if (req.providerCallStarted === true) return;
            reservedHour.requests = Math.max(0, reservedHour.requests - 1);
            reservedHour.usd = Math.max(0, reservedHour.usd - estimatedUsd);
            reservedDay.requests = Math.max(0, reservedDay.requests - 1);
            reservedDay.usd = Math.max(0, reservedDay.usd - estimatedUsd);
        };
        res.once('finish', settleReservation);
        res.once('close', settleReservation);
        next();
    };
}

function emptyWindow(kind, timestamp) {
    const date = new Date(timestamp);
    if (kind === 'hour') date.setUTCMinutes(60, 0, 0);
    else date.setUTCHours(24, 0, 0, 0);
    return { requests: 0, usd: 0, endsAt: date.getTime() };
}

function exceeds(current, increment, limit) {
    // A zero limit explicitly disables that circuit breaker dimension.
    return limit > 0 && current + increment > limit;
}

function estimateCost(req, env = process.env) {
    if (req.path === '/image') return nonNegativeNumber(env.ESTIMATED_IMAGE_REQUEST_USD, 0.08);
    if (req.isByok === true) return nonNegativeNumber(env.ESTIMATED_BYOK_REQUEST_USD, 0);
    if (req.aiTask === 'story') return nonNegativeNumber(env.ESTIMATED_STORY_REQUEST_USD, 0.012);
    if (HIGH_COST_TASKS.has(req.aiTask)) return nonNegativeNumber(env.ESTIMATED_HIGH_TASK_USD, 0.008);
    if (MEDIUM_COST_TASKS.has(req.aiTask)) return nonNegativeNumber(env.ESTIMATED_MEDIUM_TASK_USD, 0.005);
    return nonNegativeNumber(env.ESTIMATED_DEFAULT_TASK_USD, 0.003);
}

function reject(res, req, status, code, error) {
    return res.status(status).json({ success: false, code, error, requestId: req.id });
}

function parseAllowlist(raw, defaults) {
    if (!raw) return new Set(defaults);
    return new Set(String(raw).split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
}

function boundedInteger(value, fallback, min, max) {
    return Math.floor(boundedNumber(value, fallback, min, max));
}

function boundedNumber(value, fallback, min, max) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function nonNegativeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isWeakProviderKey(value) {
    const key = String(value || '').trim();
    return key.length < 20 || /(your|example|placeholder|replace|change[-_ ]?me|not[-_ ]?real)/i.test(key);
}

module.exports = {
    createCostProtection,
    createConcurrencyGuard,
    createInstanceBudgetGuard,
    inspectJson,
    ALLOWED_TASKS,
    DEFAULT_MODELS,
};
