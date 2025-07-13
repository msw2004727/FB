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

// 定義需要被淨化（確保為數字類型）的欄位
const FIELDS_TO_PURIFY = [
    'internalPower', 
    'externalPower', 
    'lightness', 
    'morality', 
    'stamina', 
    'money', 
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
    console.log('--- [數據淨化程序啟動] ---');
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

        FIELDS_TO_PURIFY.forEach(field => {
            if (userData[field] !== undefined && typeof userData[field] !== 'number') {
                const originalValue = userData[field];
                const parsedValue = Number(originalValue);

                if (isNaN(parsedValue)) {
                    console.warn(`  - [警告] 欄位 ${field} 的值 "${originalValue}" 無法轉換為數字，將重置為 0。`);
                    updates[field] = 0;
                } else {
                    console.log(`  - [發現汙染] 欄位 ${field} 的值為字串 "${originalValue}"，將淨化為數字 ${parsedValue}。`);
                    updates[field] = parsedValue;
                }
                needsFix = true;
            }
        });

        if (needsFix) {
            contaminatedFiles++;
            // 為了安全起見，每個玩家的修復都獨立執行
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
            console.log(`所有 ${contaminatedFiles} 個玩家檔案已被成功淨化！舊玩家現在可以正常遊戲了。`);
        } catch (error) {
            console.error('批量修復過程中發生錯誤:', error);
        }
    } else {
        console.log('\n--- [檢查完畢] ---');
        console.log('所有玩家的數據檔案都非常健康，未發現類型汙染問題。');
    }

    // 正常結束程序
    process.exit(0);
}

// 執行淨化腳本
purifyAllUsersData().catch(error => {
    console.error('執行數據淨化腳本時發生致命錯誤:', error);
    process.exit(1);
});
