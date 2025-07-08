// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// --- Firebase 初始化 ---
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (!serviceAccountString) {
        throw new Error("環境變數 'FIREBASE_SERVICE_ACCOUNT' 未設定或為空。請在Render後台設定此變數。");
    }

    let serviceAccount;
    try {
        serviceAccount = JSON.parse(serviceAccountString);
    } catch (parseError) {
        console.error("解析 FIREBASE_SERVICE_ACCOUNT 時發生錯誤:", parseError.message);
        throw new Error("FIREBASE_SERVICE_ACCOUNT 的值不是一個有效的 JSON 格式。請檢查您是否完整複製了 .json 金鑰檔案的全部內容，且格式沒有錯誤。");
    }

    if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
         throw new Error("解析後的 serviceAccount 物件缺少必要的屬性（如 project_id, private_key, client_email）。");
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

const corsOptions = {
    origin: 'https://msw2004727.github.io',
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

// --- 載入 API 路由 ---
const authMiddleware = require('./middleware/auth');
const authRoutes = require('./api/authRoutes');
const gameRoutes = require('./api/gameRoutes');
const libraryRoutes = require('./api/libraryRoutes');
const epilogueRoutes = require('./api/epilogue.js');
const bountyRoutes = require('./api/bountyRoutes');
const gmRoutes = require('./api/gmRoutes'); // 【核心新增】

// --- 使用路由 ---
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/epilogue', authMiddleware, epilogueRoutes);
app.use('/api/bounties', bountyRoutes);
app.use('/api/gm', gmRoutes); // 【核心新增】

// 根目錄健康檢查
app.get('/', (req, res) => {
    res.send('AI 武俠世界伺服器已啟動並採用最新模組化架構！');
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});
