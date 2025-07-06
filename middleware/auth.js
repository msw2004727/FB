const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    // Look for the token in the Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: '未經授權，請求中缺少令牌。' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // Verify the token using the secret key
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Attach the user's info (from the token) to the request object
        req.user = { id: decoded.userId, username: decoded.username };
        // If verification is successful, proceed to the next function (the actual API logic)
        next();
    } catch (error) {
        return res.status(401).json({ message: '無效或過期的身份令牌，請重新登入。' });
    }
};

module.exports = authMiddleware;
