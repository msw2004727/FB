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

// --- 【修改】載入拆分後的新 API 路由 ---
const authRoutes = require('./api/authRoutes');
const interactRoutes = require('./routes/interactRoutes');
const chatRoutes = require('./routes/chatRoutes');
const dataRoutes = require('./routes/dataRoutes');
const playerRoutes = require('./routes/playerRoutes');

// --- 【修改】使用新的路由器並指定基礎路徑 ---
app.use('/api/auth', authRoutes);

// 所有遊戲相關的路由都掛載在 /api/game 底下
app.use('/api/game', interactRoutes);
app.use('/api/game', chatRoutes);
app.use('/api/game', dataRoutes);
app.use('/api/game', playerRoutes);


// 根目錄健康檢查
app.get('/', (req, res) => {
    res.send('AI 武俠世界伺服器已啟動並採用最新的模組化架構！');
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});
