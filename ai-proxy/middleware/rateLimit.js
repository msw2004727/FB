'use strict';

/**
 * In-memory, fixed-window limiter. It is deliberately instance-local: Cloud Run
 * autoscaling can spread traffic across instances, so this is a first line of
 * defence only. Provider-side hard budgets/quotas are still mandatory.
 *
 * Backwards compatible signatures:
 *   rateLimit(30, 60_000)
 *   rateLimit({ maxPoints, windowMs, scopes, getWeight, ... })
 */
function rateLimit(maxOrOptions = 30, legacyWindowMs = 60 * 1000) {
    const options = typeof maxOrOptions === 'object'
        ? { ...maxOrOptions }
        : { maxPoints: maxOrOptions, windowMs: legacyWindowMs };

    const windowMs = positiveInteger(options.windowMs, 60 * 1000);
    const defaultMax = positiveNumber(options.maxPoints, 30);
    const getWeight = options.getWeight || (() => 1);
    const skipWhenSecurityLimited = options.skipWhenSecurityLimited !== false;
    const scopes = (options.scopes || [{
        name: 'ip',
        maxPoints: defaultMax,
        // req.ip is computed by Express from the configured trusted-proxy hop.
        // Never read the left-most X-Forwarded-For value directly.
        key: req => req.ip || req.socket?.remoteAddress || 'unknown',
    }]).map(scope => ({
        name: scope.name || 'scope',
        maxPoints: positiveNumber(scope.maxPoints, defaultMax),
        key: scope.key,
        hits: new Map(),
    }));

    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const scope of scopes) {
            for (const [key, entry] of scope.hits) {
                if (now >= entry.resetTime) scope.hits.delete(key);
            }
        }
    }, Math.max(1000, windowMs * 2));
    cleanupInterval.unref?.();

    return (req, res, next) => {
        if (skipWhenSecurityLimited && req.securityRateLimitApplied) return next();

        const now = Date.now();
        const weight = positiveNumber(getWeight(req), 1);
        const candidates = scopes.map(scope => {
            const rawKey = typeof scope.key === 'function' ? scope.key(req) : 'unknown';
            const key = String(rawKey || 'unknown').slice(0, 256);
            let entry = scope.hits.get(key);
            if (!entry || now >= entry.resetTime) {
                entry = { count: 0, resetTime: now + windowMs };
            }
            return { scope, key, entry };
        });

        const blocked = candidates.find(({ scope, entry }) => entry.count + weight > scope.maxPoints);
        const effective = blocked || candidates.reduce((tightest, candidate) => {
            if (!tightest) return candidate;
            const remainingRatio = (candidate.scope.maxPoints - candidate.entry.count) / candidate.scope.maxPoints;
            const tightestRatio = (tightest.scope.maxPoints - tightest.entry.count) / tightest.scope.maxPoints;
            return remainingRatio < tightestRatio ? candidate : tightest;
        }, null);

        const resultingCount = blocked ? blocked.entry.count : effective.entry.count + weight;
        if (!blocked) {
            for (const candidate of candidates) {
                candidate.entry.count += weight;
                candidate.scope.hits.set(candidate.key, candidate.entry);
            }
        }

        const remaining = Math.max(0, effective.scope.maxPoints - resultingCount);
        const resetSeconds = Math.ceil(effective.entry.resetTime / 1000);
        setRateHeaders(res, effective.scope.maxPoints, remaining, resetSeconds, now);

        if (blocked) {
            const retryAfter = Math.max(1, Math.ceil((blocked.entry.resetTime - now) / 1000));
            res.set('Retry-After', String(retryAfter));
            return res.status(429).json({
                success: false,
                code: 'RATE_LIMITED',
                error: 'Too many requests. Please slow down.',
                requestId: req.id,
            });
        }

        if (options.markSecurityLimited) req.securityRateLimitApplied = true;
        next();
    };
}

function setRateHeaders(res, limit, remaining, resetEpochSeconds, nowMs) {
    const normalizedLimit = String(Math.floor(limit));
    const normalizedRemaining = String(Math.floor(remaining));
    const resetDelay = String(Math.max(0, Math.ceil(resetEpochSeconds - (nowMs / 1000))));
    res.set('RateLimit-Limit', normalizedLimit);
    res.set('RateLimit-Remaining', normalizedRemaining);
    // Standard RateLimit-Reset is a delay in seconds; legacy X-RateLimit-Reset
    // remains an epoch timestamp for backwards compatibility.
    res.set('RateLimit-Reset', resetDelay);
    // Retain legacy names for existing clients and tests.
    res.set('X-RateLimit-Limit', normalizedLimit);
    res.set('X-RateLimit-Remaining', normalizedRemaining);
    res.set('X-RateLimit-Reset', String(resetEpochSeconds));
}

function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveInteger(value, fallback) {
    return Math.floor(positiveNumber(value, fallback));
}

module.exports = rateLimit;
