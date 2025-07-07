// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// Firebase 初始化
try {
    // 【核心修改】在讀取金鑰前，先進行安全檢查
    if (!process.env.FIREBASE_PRIVATE_KEY) {
        throw new Error("環境變數 'FIREBASE_PRIVATE_KEY' 未設定或為空。");
    }
    if (!process.env.FIREBASE_PROJECT_ID) {
        throw new Error("環境變數 'FIREBASE_PROJECT_ID' 未設定或為空。");
    }
    if (!process.env.FIREBASE_CLIENT_EMAIL) {
        throw new Error("環境變數 'FIREBASE_CLIENT_EMAIL' 未設定或為空。");
    }

    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;
    // 【核心修改】另一種初始化方式，直接從各個環境變數讀取，避免 FIREBASE_SERVICE_ACCOUNT 的複雜性
    const serviceAccount = {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
    };

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://md-server-main-default-rtdb.asia-southeast1.firebasedatabase.app"
    });

    console.log("Firebase 初始化成功！");
} catch (error) {
    console.error("Firebase 初始化失敗:", error.message);
    process.exit(1); // 初始化失敗時，終止應用程式
}

// Express App 設定
const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors({ origin: 'https://msw2004727.github.io' }));
app.use(express.json());

// --- 載入 API 路由 ---
const authMiddleware = require('./middleware/auth');
const authRoutes = require('./api/authRoutes');
const gameRoutes = require('./api/gameRoutes');
const libraryRoutes = require('./api/libraryRoutes');
const epilogueRoutes = require('./api/epilogue.js');
const bountyRoutes = require('./api/bountyRoutes');

// --- 使用路由 ---
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/epilogue', authMiddleware, epilogueRoutes);
app.use('/api/bounties', bountyRoutes);

// 根目錄健康檢查
app.get('/', (req, res) => {
    res.send('AI 武俠世界伺服器已啟動並採用最新模組化架構！');
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});
