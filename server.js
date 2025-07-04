require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// Firebase Initialization
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountString) throw new Error('Firebase 服務帳戶金鑰未設定！');
    const serviceAccount = JSON.parse(serviceAccountString);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://ai-novel-final.firebaseio.com" // Recommended to use .firebaseio.com domain
    });
    console.log("Firebase 初始化成功！");
} catch (error) {
    console.error("Firebase 初始化失敗:", error.message);
    process.exit(1);
}

// Express App Setup
const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors({ origin: 'https://msw2004727.github.io' }));
app.use(express.json());

// --- API Routers ---
const authRoutes = require('./api/authRoutes');
const gameRoutes = require('./api/gameRoutes');

// Use the routers with specific base paths
app.use('/api/auth', authRoutes); // e.g., /api/auth/register
app.use('/api/game', gameRoutes); // e.g., /api/game/interact

// Root health check
app.get('/', (req, res) => {
    res.send('AI 武俠世界伺服器已啟動並採用最新模組化架構！');
});

// Start Server
app.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});
