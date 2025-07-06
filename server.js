// server.js

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

// --- 載入所有路由與中間件 ---
const authMiddleware = require('./middleware/auth.js');
const authRoutes = require('./api/authRoutes');
const interactRoutes = require('./routes/interactRoutes');
const chatRoutes = require('./routes/chatRoutes');
const dataRoutes = require('./routes/dataRoutes');
const playerRoutes = require('./routes/playerRoutes');

// --- 【修改】重新規劃路由掛載 ---

// 1. 掛載不需要身分驗證的路由
app.use('/api/auth', authRoutes);

// 2. 在這之後，掛載身分驗證中間件
// 這代表所有在這行程式碼之後的路由，都必須先通過 authMiddleware 的檢查
app.use(authMiddleware);

// 3. 掛載所有需要身分驗證的遊戲路由
// 因為它們都在 authMiddleware 之後，所以 req.user 將永遠存在
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
