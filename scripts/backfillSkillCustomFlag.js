// /scripts/backfillSkillCustomFlag.js

/**
 * 說明：
 * 這是一個一次性執行的數據維護腳本。
 * 目的：掃描 Firestore 資料庫中的 `skills` 集合，為所有沒有 'isCustom' 欄位的武學文件，
 * 自動添加 `isCustom: false` 欄位。這確保了所有既有的、非玩家自創的武學都有一個明確的標記。
 *
 * 如何使用：
 * 1. 將此檔案放置在您的後端專案的 `/scripts` 資料夾中。
 * 2. 確保您的環境已安裝 `firebase-admin` 且 `dotenv` 已配置。
 * 3. 確保您的 Firebase 服務帳戶金鑰 (通常在 .env 文件中) 是正確的。
 * 4. 在您的伺服器或本地環境中，透過終端機執行此腳本: `node scripts/backfillSkillCustomFlag.js`
 * 5. 腳本會自動連接到您的資料庫，完成檢查與更新，並在控制台輸出執行日誌。
 *
 * 注意：此腳本只會對缺少 `isCustom` 欄位的武學進行添加，不會覆蓋任何已有的值。
 */

require('dotenv').config();
const admin = require('firebase-admin');

// --- Firebase 初始化 ---
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountString) {
        throw new Error("環境變數 'FIREBASE_SERVICE_ACCOUNT' 未設定或為空。");
    }
    const serviceAccount = JSON.parse(serviceAccountString);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase 初始化成功，準備回填武學 isCustom 標記...");
} catch (error) {
    console.error("Firebase 初始化失敗:", error.message);
    process.exit(1);
}

const db = admin.firestore();

async function backfillIsCustomFlag() {
    console.log('--- [武學數據回填程序啟動] ---');
    console.log('正在掃描 /skills 集合...');

    const skillsRef = db.collection('skills');
    const snapshot = await skillsRef.get();

    if (snapshot.empty) {
        console.log('找不到任何武學資料，程序結束。');
        return;
    }

    const batch = db.batch();
    let updatesCount = 0;

    snapshot.forEach(doc => {
        const skillData = doc.data();
        const skillName = skillData.skillName || doc.id;

        // 檢查 isCustom 欄位是否存在
        if (skillData.isCustom === undefined) {
            console.log(`  - [發現缺失標記] 武學「${skillName}」缺少 isCustom 欄位，將補上預設值 false。`);
            batch.update(doc.ref, { isCustom: false });
            updatesCount++;
        } else {
            console.log(`  - [標記已存在] 武學「${skillName}」已有 isCustom 標記，跳過。`);
        }
    });

    if (updatesCount > 0) {
        await batch.commit();
        console.log(`\n--- [任務完成] ---`);
        console.log(`成功為 ${updatesCount} 個武學檔案補上了 isCustom: false 標記。`);
    } else {
        console.log('\n--- [檢查完畢] ---');
        console.log('所有武學檔案的數據結構都已是最新，無需更新。');
    }
}

// 執行回填腳本
backfillIsCustomFlag().then(() => {
    console.log('程序執行完畢。');
    process.exit(0);
}).catch(error => {
    console.error('執行武學數據回填腳本時發生致命錯誤:', error);
    process.exit(1);
});
