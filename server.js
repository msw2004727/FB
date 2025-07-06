require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// Firebase 初始化
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountString) throw new Error('Firebase 服務帳戶金鑰未設定！');
    const serviceAccount = JSON.parse(serviceAccountString);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://md-server-main-default-rtdb.asia-southeast1.firebasedatabase.app"
    });
    console.log("Firebase 初始化成功！");
} catch (error) {
    console.error("Firebase 初始化失敗:", error.message);
    process.exit(1);
}

// Express App 設定
const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors({ origin: 'https://msw2004727.github.io' }));
app.use(express.json());

// --- 載入 API 路由 ---
const authRoutes = require('./api/authRoutes');
const gameRoutes = require('./api/gameRoutes');

// 【重要】使用路由器並指定基礎路徑
// 所有 /api/auth 的請求，都交給 authRoutes 處理
app.use('/api/auth', authRoutes);
// 所有 /api/game 的請求，都交給 gameRoutes 處理
app.use('/api/game', gameRoutes);

// 根目錄健康檢查
app.get('/', (req, res) => {
    res.send('AI 武俠世界伺服器已啟動並採用最新模組化架構！');
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});
