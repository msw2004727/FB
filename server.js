// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const cacheManager = require('./api/cacheManager');

// --- Firebase 初始化 ---
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountString) {
        throw new Error("環境變數 'FIREBASE_SERVICE_ACCOUNT' 未設定或為空。");
    }
    const serviceAccount = JSON.parse(serviceAccountString);
    if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
         throw new Error("解析後的 serviceAccount 物件缺少必要的屬性。");
    }
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

// --- 【核心修正】更強健的CORS配置 ---
// 定義允許的來源
const allowedOrigins = [
    'https://msw2004727.github.io', 
    'http://localhost:5500', // 方便本地開發測試
    'http://127.0.0.1:5500'  // 方便本地開發測試
];

const corsOptions = {
  origin: function (origin, callback) {
    // 允許沒有來源的請求 (例如伺服器間的請求或Postman) 或 來源在白名單中的請求
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('此來源不被CORS策略允許'));
    }
  },
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE", // 允許所有HTTP方法
  credentials: true, // 如果您將來需要處理cookies或session，這會很有用
  optionsSuccessStatus: 204 // 對於預檢請求(OPTIONS)直接回傳204 No Content
};

app.use(cors(corsOptions));
// 在所有路由之前處理OPTIONS請求
app.options('*', cors(corsOptions));

app.use(express.json());

// --- 載入 API 路由 ---
const authMiddleware = require('./middleware/auth');
const authRoutes = require('./api/authRoutes');
const gameRoutes = require('./api/gameRoutes');
const libraryRoutes = require('./api/libraryRoutes');
const epilogueRoutes = require('./api/epilogue.js');
const bountyRoutes = require('./api/bountyRoutes');
const gmRoutes = require('./api/gmRoutes');
const mapRoutes = require('./api/mapRoutes');
const adminRoutes = require('./api/admin/adminRoutes');
const beggarRoutes = require('./api/beggarRoutes');

// --- 使用路由 ---
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/epilogue', authMiddleware, epilogueRoutes);
app.use('/api/bounties', bountyRoutes);
app.use('/api/gm', gmRoutes);
app.use('/api/map', authMiddleware, mapRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/beggar', beggarRoutes);

// 根目錄健康檢查
app.get('/', (req, res) => {
    res.send('AI 武俠世界伺服器已啟動並採用最新模組化架構！');
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
    cacheManager.initializeNpcNameCache();
});
