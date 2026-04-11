// ai-proxy/middleware/rateLimit.js

/**
 * Simple in-memory rate limiter.
 * @param {number} maxRequests - Max requests per window (default 30)
 * @param {number} windowMs    - Window size in milliseconds (default 60 000 = 1 min)
 */
function rateLimit(maxRequests = 30, windowMs = 60 * 1000) {
    const hits = new Map(); // ip -> { count, resetTime }

    // Periodically clean expired entries to avoid memory leaks
    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [ip, entry] of hits) {
            if (now >= entry.resetTime) {
                hits.delete(ip);
            }
        }
    }, windowMs * 2);
    // Allow the process to exit even if the timer is still active
    if (cleanupInterval.unref) cleanupInterval.unref();

    return (req, res, next) => {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || 'unknown';
        const now = Date.now();

        let entry = hits.get(ip);
        if (!entry || now >= entry.resetTime) {
            entry = { count: 0, resetTime: now + windowMs };
            hits.set(ip, entry);
        }

        entry.count++;

        // Set informational headers
        res.set('X-RateLimit-Limit', String(maxRequests));
        res.set('X-RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)));
        res.set('X-RateLimit-Reset', String(Math.ceil(entry.resetTime / 1000)));

        if (entry.count > maxRequests) {
            return res.status(429).json({
                success: false,
                error: 'Too many requests. Please slow down.',
            });
        }

        next();
    };
}

module.exports = rateLimit;
