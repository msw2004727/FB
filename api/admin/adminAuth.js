// api/admin/adminAuth.js
const ADMIN_PASSWORD = '1121'; // 預設後台密碼

const adminAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: '未提供後台授權令牌。' });
    }

    const token = authHeader.split(' ')[1];

    if (token !== ADMIN_PASSWORD) {
        return res.status(403).json({ message: '後台授權令牌無效。' });
    }

    // 驗證通過
    next();
};

module.exports = adminAuth;
