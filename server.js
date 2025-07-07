// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// --- Firebase Admin SDK 初始化 ---
const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


// --- Express App 設定 ---
const app = express();

// 設置 CORS
const allowedOrigins = ['http://127.0.0.1:5500', 'https://msw2004727.github.io'];
const corsOptions = {
  origin: function (origin, callback) {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('public'));


// --- API 路由 ---
// 【核心修改】重新組織路由，使其更清晰
const authRoutes = require('./api/authRoutes');
const gameRoutes = require('./api/gameRoutes');
const bountyRoutes = require('./api/bountyRoutes');
const libraryRoutes = require('./api/libraryRoutes'); // 載入之前被遺漏的圖書館路由

// 公開路由 (例如圖書館，不需要登入即可查看)
app.use('/api/library', libraryRoutes);

// 身份驗證路由
app.use('/api/auth', authRoutes);

// 主要遊戲邏輯路由 (身份驗證在 gameRoutes 內部處理)
app.use('/api/game', gameRoutes);

// 懸賞任務路由 (身份驗證在 bountyRoutes 內部處理)
app.use('/api/bounties', bountyRoutes);


// --- 伺服器啟動 ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`江湖伺服器已在 ${PORT} 端口啟動...`);
});
