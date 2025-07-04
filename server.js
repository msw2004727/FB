// server.js

// --- 基礎設定 ---
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// --- Firebase 初始化 ---
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

// --- Express App 設定 ---
const app = express();
const PORT = process.env.PORT || 3001;
const corsOptions = {
  origin: 'https://msw2004727.github.io',
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

// --- 載入 API 路由 ---
const gameRoutes = require('./api/gameRoutes');
app.use('/api', gameRoutes); // 所有遊戲路由都會有 /api 前綴，例如 /api/interact

// --- 根目錄健康檢查路由 ---
app.get('/', (req, res) => {
    res.send('AI 武俠世界伺服器已啟動並已模組化！');
});

// --- 啟動伺服器 ---
app.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});
