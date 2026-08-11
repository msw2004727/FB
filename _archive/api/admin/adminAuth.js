// api/admin/adminAuth.js
const crypto = require('crypto');

function constantTimeEqual(left, right) {
    const leftBuffer = Buffer.from(String(left || ''));
    const rightBuffer = Buffer.from(String(right || ''));
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

const adminAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const adminToken = process.env.ADMIN_TOKEN;

    // 封存服務沒有安全設定時必須 fail closed，絕不使用預設密碼。
    if (!adminToken || adminToken.length < 32) {
        return res.status(503).json({ message: '封存後台已停用。' });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: '未提供後台授權令牌。' });
    }

    const token = authHeader.split(' ')[1];

    if (!constantTimeEqual(token, adminToken)) {
        return res.status(403).json({ message: '後台授權令牌無效。' });
    }

    // 驗證通過
    next();
};

module.exports = adminAuth;
