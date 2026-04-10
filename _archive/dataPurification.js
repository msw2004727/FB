// dataPurification.js
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
    console.log("Firebase 初始化成功，準備開始數據淨化...");
} catch (error) {
    console.error("Firebase 初始化失敗:", error.message);
    process.exit(1); 
}

const db = admin.firestore();

// 舊的、可能存在的大小寫錯誤的欄位名稱列表
const LEGACY_FIELD_MAPPING = {
    // 功力巔峰值
    'maxinternalPowerAchieved': 'maxInternalPowerAchieved',
    'maxexternalPowerAchieved': 'maxExternalPowerAchieved',
    'maxlightnessAchieved': 'maxLightnessAchieved',
    // 當前功力值
    'internalpower': 'internalPower',
    'externalpower': 'externalPower',
    'lightnesspower': 'lightness',
};

// 【核心修正】需要被淨化（確保為數字類型）的欄位，加入了新的標準欄位
const FIELDS_TO_PURIFY = [
    'internalPower', 
    'externalPower', 
    'lightness', 
    'morality', 
    'stamina', 
    'bulkScore', 
    'R', 
    'shortActionCounter', 
    'year', 
    'month', 
    'day',
    'maxInternalPowerAchieved',
    'maxExternalPowerAchieved',
    'maxLightnessAchieved'
];

async function purifyAllUsersData() {
    console.log('--- [數據淨化程序 v2.0 啟動] ---');
    console.log('正在掃描所有玩家檔案...');

    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();

    if (snapshot.empty) {
        console.log('找不到任何玩家資料，程序結束。');
        return;
    }

    let contaminatedFiles = 0;
    const batchPromises = [];

    snapshot.forEach(doc => {
        const userData = doc.data();
        const updates = {};
        let needsFix = false;

        console.log(`\n正在檢查玩家: ${userData.username} (ID: ${doc.id})`);

        // 1. 【新增】檢查並修正大小寫錯誤的舊欄位
        for (const [legacyField, correctField] of Object.entries(LEGACY_FIELD_MAPPING)) {
            if (userData[legacyField] !== undefined) {
                console.log(`  - [發現遺留欄位] 發現 ${legacyField}，將其值轉移至 ${correctField} 並刪除舊欄位。`);
                updates[correctField] = userData[legacyField];
                updates[legacyField] = admin.firestore.FieldValue.delete(); // 刪除舊的錯誤欄位
                needsFix = true;
            }
        }

        // 2. 淨化數值類型
        FIELDS_TO_PURIFY.forEach(field => {
            // 合併了大小寫修正後的數據再進行檢查
            const finalValue = updates[field] !== undefined ? updates[field] : userData[field];
            
            if (finalValue !== undefined && typeof finalValue !== 'number') {
                const parsedValue = Number(finalValue);

                if (isNaN(parsedValue)) {
                    console.warn(`  - [警告] 欄位 ${field} 的值 "${finalValue}" 無法轉換為數字，將重置為 0。`);
                    updates[field] = 0;
                } else {
                    console.log(`  - [發現類型汙染] 欄位 ${field} 的值為字串 "${finalValue}"，將淨化為數字 ${parsedValue}。`);
                    updates[field] = parsedValue;
                }
                needsFix = true;
            }
        });

        if (needsFix) {
            contaminatedFiles++;
            batchPromises.push(usersRef.doc(doc.id).update(updates));
        } else {
            console.log('  - 數據健康，無需處理。');
        }
    });

    if (contaminatedFiles > 0) {
        console.log(`\n發現 ${contaminatedFiles} 個被汙染的玩家檔案，正在執行批量修復...`);
        try {
            await Promise.all(batchPromises);
            console.log(`--- [數據淨化成功] ---`);
            console.log(`所有 ${contaminatedFiles} 個玩家檔案已被成功淨化！`);
        } catch (error) {
            console.error('批量修復過程中發生錯誤:', error);
        }
    } else {
        console.log('\n--- [檢查完畢] ---');
        console.log('所有玩家的數據檔案都非常健康，未發現類型汙染與遺留欄位問題。');
    }

    process.exit(0);
}

// 執行淨化腳本
purifyAllUsersData().catch(error => {
    console.error('執行數據淨化腳本時發生致命錯誤:', error);
    process.exit(1);
});
