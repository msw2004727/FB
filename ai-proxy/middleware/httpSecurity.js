'use strict';

const crypto = require('crypto');

function configureTrustProxy(app, env = process.env) {
    const production = env.NODE_ENV === 'production';
    const raw = env.TRUST_PROXY_HOPS;
    // Google external HTTP(S) load balancing appends client-ip then
    // load-balancer-ip. Together with the socket peer, Express therefore needs
    // two trusted proxy hops to select the verified client IP while ignoring
    // any attacker-supplied values farther to the left.
    const hops = raw === undefined || raw === '' ? (production ? 2 : 0) : Number.parseInt(raw, 10);
    if (!Number.isInteger(hops) || hops < 0 || hops > 5) {
        throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 5');
    }
    // Numeric hop trust consumes addresses from the socket/right side. This
    // prevents trusting an attacker-controlled left-most X-Forwarded-For value.
    app.set('trust proxy', hops === 0 ? false : hops);
    return hops;
}

function createCorsMiddleware(env = process.env) {
    const production = env.NODE_ENV === 'production';
    const raw = String(env.CORS_ORIGINS || '').trim();
    if (production && (!raw || raw === '*')) {
        throw new Error('CORS_ORIGINS must be a non-wildcard allowlist in production');
    }
    const allowAny = !production && (raw === '*' || raw === '');
    const allowed = new Set(raw.split(',').map(normalizeOrigin).filter(Boolean));
    if (production && allowed.size === 0) {
        throw new Error('CORS_ORIGINS must contain at least one valid http(s) origin');
    }

    return (req, res, next) => {
        const origin = req.get('origin');
        if (!origin) return next();
        res.set('Vary', appendVary(res.get('Vary'), 'Origin'));
        const normalized = normalizeOrigin(origin);
        if (!allowAny && !allowed.has(normalized)) {
            res.set('Cache-Control', 'no-store');
            return res.status(403).json({
                success: false,
                code: 'ORIGIN_NOT_ALLOWED',
                error: 'Origin is not allowed',
                requestId: req.id,
            });
        }

        res.set('Access-Control-Allow-Origin', allowAny ? origin : normalized);
        res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type,X-FB-Session,X-Request-ID');
        res.set('Access-Control-Expose-Headers', 'X-Request-ID,RateLimit-Limit,RateLimit-Remaining,RateLimit-Reset,Retry-After');
        res.set('Access-Control-Max-Age', '600');
        if (req.method === 'OPTIONS') return res.status(204).end();
        next();
    };
}

function requestId(req, res, next) {
    const supplied = req.get('x-request-id');
    req.id = supplied && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(supplied)
        ? supplied
        : crypto.randomUUID();
    // Downstream routes must see only the normalized value, never the raw
    // attacker-controlled header.
    req.headers['x-request-id'] = req.id;
    res.set('X-Request-ID', req.id);
    next();
}

function securityHeaders(env = process.env) {
    const production = env.NODE_ENV === 'production';
    return (_req, res, next) => {
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('X-Frame-Options', 'DENY');
        res.set('Referrer-Policy', 'no-referrer');
        res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
        res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        // This API intentionally serves an allowlisted GitHub Pages origin on a
        // different site; strict CORS is the browser boundary here.
        res.set('Cross-Origin-Resource-Policy', 'cross-origin');
        if (production) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        next();
    };
}

function normalizeOrigin(value) {
    if (!value) return '';
    try {
        const url = new URL(String(value).trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
            return '';
        }
        return url.origin;
    } catch (_) {
        return '';
    }
}

function appendVary(existing, value) {
    const values = new Set(String(existing || '').split(',').map(item => item.trim()).filter(Boolean));
    values.add(value);
    return [...values].join(', ');
}

module.exports = { configureTrustProxy, createCorsMiddleware, requestId, securityHeaders, normalizeOrigin };
