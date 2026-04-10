// middleware/auth.js
const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: '未經授權，請求中缺少令牌。' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // --- 【核心除錯步驟】---
        // 記錄解碼後的內容，確認 userId 是否存在
        console.log('[Auth Middleware] Token decoded successfully. Payload:', decoded);
        
        // 確保 decoded.userId 存在且不為空
        if (!decoded || !decoded.userId) {
            console.error('[Auth Middleware] 嚴重錯誤: Token payload 中缺少 userId 欄位!', decoded);
            return res.status(401).json({ message: '身份令牌無效 (缺少使用者資訊)。' });
        }
        
        req.user = { id: decoded.userId, username: decoded.username };
        
        // 記錄最終附加到 req.user 的內容
        console.log('[Auth Middleware] Attaching to req.user:', req.user);
        // --- 除錯結束 ---

        next();
    } catch (error) {
        console.error('[Auth Middleware] Token verification failed:', error.message);
        return res.status(401).json({ message: '無效或過期的身份令牌，請重新登入。' });
    }
};

module.exports = authMiddleware;
