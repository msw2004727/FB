// tests/unit/rateLimit.test.js
// Rate limiter 中介軟體測試

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rateLimit = require('../../middleware/rateLimit');

function createMockReqRes(ip = '127.0.0.1') {
    const headers = {};
    return {
        req: { ip, connection: { remoteAddress: ip } },
        res: {
            set: vi.fn((key, val) => { headers[key] = val; }),
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
            _headers: headers
        },
        next: vi.fn()
    };
}

describe('rateLimit middleware', () => {
    it('should allow requests within limit', () => {
        const limiter = rateLimit(5, 60000);
        const { req, res, next } = createMockReqRes();

        limiter(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('should set rate limit headers', () => {
        const limiter = rateLimit(10, 60000);
        const { req, res, next } = createMockReqRes();

        limiter(req, res, next);
        expect(res.set).toHaveBeenCalledWith('X-RateLimit-Limit', '10');
        expect(res.set).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(String));
        expect(res.set).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
    });

    it('should decrement remaining count', () => {
        const limiter = rateLimit(5, 60000);
        const { req, res, next } = createMockReqRes();

        limiter(req, res, next);
        // 第一次 remaining 應為 4 (5 - 1)
        expect(res.set).toHaveBeenCalledWith('X-RateLimit-Remaining', '4');
    });

    it('should block requests exceeding limit', () => {
        const limiter = rateLimit(3, 60000);
        const ip = '10.0.0.1';

        for (let i = 0; i < 3; i++) {
            const { req, res, next } = createMockReqRes(ip);
            limiter(req, res, next);
        }

        // 第 4 次應被阻擋
        const { req, res, next } = createMockReqRes(ip);
        limiter(req, res, next);

        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            error: expect.stringContaining('Too many requests')
        }));
        expect(next).not.toHaveBeenCalled();
    });

    it('should track different IPs separately', () => {
        const limiter = rateLimit(2, 60000);

        // IP A 用掉 2 次
        for (let i = 0; i < 2; i++) {
            const { req, res, next } = createMockReqRes('1.1.1.1');
            limiter(req, res, next);
        }

        // IP B 應該還有配額
        const { req, res, next } = createMockReqRes('2.2.2.2');
        limiter(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('should reset after window expires', async () => {
        const limiter = rateLimit(2, 50); // 50ms window

        const ip = '3.3.3.3';
        // 用完配額
        for (let i = 0; i < 3; i++) {
            const { req, res, next } = createMockReqRes(ip);
            limiter(req, res, next);
        }

        // 等 window 過期
        await new Promise(r => setTimeout(r, 60));

        const { req, res, next } = createMockReqRes(ip);
        limiter(req, res, next);
        expect(next).toHaveBeenCalled();
    });
});
