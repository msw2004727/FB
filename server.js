// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// --- 【核心修正】Firebase 初始化區塊提前 ---
// 確保在載入任何其他使用Firebase的自訂模組前，Firebase App已被初始化
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

// --- 現在可以安全地載入其他模組 ---
const cacheManager = require('./api/cacheManager');
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
const inventoryRoutes = require('./api/inventoryRoutes');

// Express App 設定
const app = express();
const PORT = process.env.PORT || 3001;

// --- CORS 配置 ---
const allowedOrigins = [
    'https://msw2004727.github.io',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('此來源不被CORS策略允許'));
    }
  },
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());

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
app.use('/api/inventory', inventoryRoutes);

// 根目錄健康檢查
app.get('/', (req, res) => {
    res.send('AI 武俠世界伺服器已啟動並採用最新模組化架構！');
});

// --- 啟動時執行數據遷移 ---
const { runEquipmentMigration } = require('./api/migrations/equipmentMigration');

// 啟動伺服器
app.listen(PORT, async () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);

    // 【核心修改】註解掉此行，不再於啟動時預載所有快取
    // cacheManager.initializeCaches();

    // 執行數據遷移腳本
    try {
        await runEquipmentMigration();
    } catch (error) {
        console.error('[數據遷移] 啟動時執行遷移腳本失敗:', error);
    }
});
