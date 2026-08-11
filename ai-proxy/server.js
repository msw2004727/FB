'use strict';

require('dotenv').config();

const express = require('express');
const aiRoutes = require('./routes/aiRoutes');
const rateLimit = require('./middleware/rateLimit');
const { createAnonymousSession } = require('./middleware/anonymousSession');
const { createCostProtection } = require('./middleware/costProtection');
const {
    configureTrustProxy,
    createCorsMiddleware,
    requestId,
    securityHeaders,
} = require('./middleware/httpSecurity');

function createApp(env = process.env) {
    const app = express();
    app.disable('x-powered-by');
    configureTrustProxy(app, env);

    const jsonLimit = boundedInteger(env.MAX_JSON_BYTES, 128 * 1024, 16 * 1024, 512 * 1024);
    const anonymousSession = createAnonymousSession({ env });
    const protection = createCostProtection({ env });

    app.use(requestId);
    app.use(securityHeaders(env));
    app.use(createCorsMiddleware(env));
    app.use(express.json({ limit: `${jsonLimit}b`, strict: true, type: 'application/json' }));

    app.get('/health', (_req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
    });

    const challengeLimiter = rateLimit({
        maxPoints: boundedInteger(env.SESSION_CHALLENGE_REQUESTS_PER_MINUTE, 10, 1, 1000),
        windowMs: 60 * 1000,
        skipWhenSecurityLimited: false,
    });
    app.get('/session/challenge', challengeLimiter, anonymousSession.challenge);
    app.post('/session', challengeLimiter, anonymousSession.issue);

    // The order is intentional: reject disabled high-cost functionality first,
    // then authenticate, validate/price, rate-limit, reserve one provider-facing
    // concurrency slot, and only then charge the local owner-funded budget.
    // Requests rejected for concurrency must never consume the budget window.
    app.use(
        '/ai',
        protection.imageGate,
        anonymousSession.authenticate,
        protection.validate,
        protection.weightedLimiter,
        protection.concurrency,
        protection.budgetGuard,
        aiRoutes,
    );

    app.use((_req, res) => {
        res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Route not found', requestId: res.get('X-Request-ID') });
    });

    app.use((err, req, res, _next) => {
        const isBodyTooLarge = err?.type === 'entity.too.large';
        const isBadJson = err instanceof SyntaxError && err?.type === 'entity.parse.failed';
        const candidateStatus = Number(err?.status);
        const safeStatus = Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus <= 599
            ? candidateStatus
            : 500;
        const status = isBodyTooLarge ? 413 : (isBadJson ? 400 : safeStatus);
        const expose = status < 500;
        console.error(JSON.stringify({
            event: 'server_error',
            requestId: req.id,
            status,
            message: err?.message || String(err),
        }));
        res.status(status).json({
            success: false,
            code: isBodyTooLarge ? 'PAYLOAD_TOO_LARGE' : (isBadJson ? 'INVALID_JSON' : 'INTERNAL_ERROR'),
            error: expose ? err.message : 'Internal server error',
            requestId: req.id,
        });
    });

    return app;
}

function start(env = process.env) {
    const app = createApp(env);
    const port = boundedInteger(env.PORT, 3001, 1, 65535);
    return app.listen(port, () => {
        console.log(`[AI Proxy] listening on port ${port}`);
    });
}

function boundedInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

if (require.main === module) start();

module.exports = { createApp, start };
