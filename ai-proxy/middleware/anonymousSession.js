'use strict';

const crypto = require('crypto');

const SESSION_HEADER = 'X-FB-Session';

function createAnonymousSession(options = {}) {
    const env = options.env || process.env;
    const now = options.now || (() => Date.now());
    const production = env.NODE_ENV === 'production';
    const required = parseBoolean(env.REQUIRE_ANON_SESSION, production);
    const configuredSecret = String(env.ANON_SESSION_SECRET || '');

    if (required && isWeakSecret(configuredSecret)) {
        throw new Error('ANON_SESSION_SECRET must be a non-placeholder secret with at least 32 characters');
    }

    // Development-only fallback. It intentionally changes on restart.
    const secret = configuredSecret || crypto.randomBytes(32).toString('base64url');
    const challengeTtlMs = boundedInteger(env.SESSION_CHALLENGE_TTL_SECONDS, 120, 30, 600) * 1000;
    const sessionTtlMs = boundedInteger(env.SESSION_TTL_SECONDS, 24 * 60 * 60, 300, 7 * 24 * 60 * 60) * 1000;
    const difficulty = boundedInteger(env.SESSION_POW_DIFFICULTY, production ? 14 : 8, 0, 24);
    const consumedChallenges = new Map();

    const cleanup = setInterval(() => {
        const timestamp = now();
        for (const [digest, expiresAt] of consumedChallenges) {
            if (timestamp >= expiresAt) consumedChallenges.delete(digest);
        }
    }, Math.max(30_000, challengeTtlMs));
    cleanup.unref?.();

    function challenge(req, res) {
        const issuedAt = now();
        const expiresAt = issuedAt + challengeTtlMs;
        const payload = {
            v: 1,
            type: 'challenge',
            nonce: crypto.randomBytes(18).toString('base64url'),
            origin: requestOrigin(req),
            iat: issuedAt,
            exp: expiresAt,
        };
        const token = signPayload(payload, secret);
        res.set('Cache-Control', 'no-store');
        return res.json({
            success: true,
            challenge: {
                token,
                algorithm: 'sha256',
                difficulty,
                expiresAt: new Date(expiresAt).toISOString(),
            },
        });
    }

    function issue(req, res) {
        const challengeToken = req.body?.challengeToken;
        const solution = req.body?.solution;
        if (typeof challengeToken !== 'string' || challengeToken.length > 4096 ||
            !/^(0|[1-9]\d{0,19})$/.test(String(solution ?? ''))) {
            return sessionError(res, req, 400, 'CHALLENGE_INVALID', 'Invalid challenge or solution');
        }

        const verified = verifyPayload(challengeToken, secret);
        const timestamp = now();
        if (!verified.ok || verified.payload.type !== 'challenge' || verified.payload.v !== 1) {
            return sessionError(res, req, 400, 'CHALLENGE_INVALID', 'Invalid challenge or solution');
        }
        if (!Number.isFinite(verified.payload.exp) || timestamp >= verified.payload.exp) {
            return sessionError(res, req, 400, 'CHALLENGE_EXPIRED', 'Challenge expired');
        }
        if (verified.payload.origin !== requestOrigin(req)) {
            return sessionError(res, req, 400, 'CHALLENGE_ORIGIN_MISMATCH', 'Challenge origin mismatch');
        }

        const challengeDigest = crypto.createHash('sha256').update(challengeToken).digest('base64url');
        if (consumedChallenges.has(challengeDigest)) {
            return sessionError(res, req, 409, 'CHALLENGE_REPLAYED', 'Challenge already used');
        }

        const proofDigest = crypto.createHash('sha256')
            .update(`${challengeToken}.${String(solution)}`)
            .digest();
        if (!hasLeadingZeroBits(proofDigest, difficulty)) {
            return sessionError(res, req, 400, 'POW_INVALID', 'Invalid proof of work');
        }
        consumedChallenges.set(challengeDigest, verified.payload.exp);

        const expiresAt = timestamp + sessionTtlMs;
        const sessionPayload = {
            v: 1,
            type: 'session',
            sid: crypto.randomBytes(16).toString('base64url'),
            origin: verified.payload.origin,
            iat: timestamp,
            exp: expiresAt,
        };
        const token = signPayload(sessionPayload, secret);
        res.set('Cache-Control', 'no-store');
        return res.json({
            success: true,
            session: {
                token,
                expiresAt: new Date(expiresAt).toISOString(),
                header: SESSION_HEADER,
            },
        });
    }

    function authenticate(req, res, next) {
        if (!required) {
            req.anonymousSessionId = null;
            return next();
        }

        const token = req.get(SESSION_HEADER);
        if (!token) {
            return sessionError(
                res,
                req,
                401,
                'SESSION_REQUIRED',
                '網站安全機制已更新，請重新整理頁面後再試。'
            );
        }
        if (token.length > 4096) return sessionError(res, req, 401, 'SESSION_INVALID', 'Invalid anonymous session');

        const verified = verifyPayload(token, secret);
        if (!verified.ok || verified.payload.type !== 'session' || verified.payload.v !== 1 ||
            typeof verified.payload.sid !== 'string') {
            return sessionError(res, req, 401, 'SESSION_INVALID', 'Invalid anonymous session');
        }
        if (!Number.isFinite(verified.payload.exp) || now() >= verified.payload.exp) {
            return sessionError(res, req, 401, 'SESSION_EXPIRED', 'Anonymous session expired');
        }
        if (verified.payload.origin !== requestOrigin(req)) {
            return sessionError(res, req, 401, 'SESSION_INVALID', 'Anonymous session origin mismatch');
        }

        req.anonymousSessionId = verified.payload.sid;
        next();
    }

    return { challenge, issue, authenticate, required, header: SESSION_HEADER };
}

function signPayload(payload, secret) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
}

function verifyPayload(token, secret) {
    if (typeof token !== 'string') return { ok: false };
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false };
    const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest();
    let supplied;
    try { supplied = Buffer.from(parts[1], 'base64url'); } catch (_) { return { ok: false }; }
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return { ok: false };
    try {
        return { ok: true, payload: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) };
    } catch (_) {
        return { ok: false };
    }
}

function hasLeadingZeroBits(buffer, bits) {
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

function requestOrigin(req) {
    const origin = req.get?.('origin');
    return typeof origin === 'string' && origin.length <= 512 ? origin : '-';
}

function sessionError(res, req, status, code, error) {
    res.set('Cache-Control', 'no-store');
    return res.status(status).json({ success: false, code, error, requestId: req.id });
}

function parseBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw new Error('REQUIRE_ANON_SESSION must be true or false');
}

function isWeakSecret(secret) {
    return secret.length < 32 || /(replace|change[-_ ]?me|example|your[-_ ]?secret)/i.test(secret);
}

function boundedInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

module.exports = { createAnonymousSession, hasLeadingZeroBits, SESSION_HEADER };
