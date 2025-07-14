// scripts/migrateEquipment.js
require('dotenv').config();
const admin = require('firebase-admin');

// --- Firebase 初始化 ---
// 腳本會使用跟你 server.js 相同的環境變數來連接資料庫
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountString) {
        throw new Error("環境變數 'FIREBASE_SERVICE_ACCOUNT' 未設定或為空。");
    }
    const serviceAccount = JSON.parse(serviceAccountString);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase 初始化成功，準備開始裝備數據遷移...");
} catch (error) {
    console.error("Firebase 初始化失敗:", error.message);
    process.exit(1); 
}

const db = admin.firestore();

// 定義最新、最完整的裝備欄位結構
const LATEST_EQUIPMENT_STRUCTURE = {
    head: null,
    body: null,
    hands: null,
    feet: null,
    weapon_right: null,
    weapon_left: null,
    weapon_back: null,
    accessory1: null,
    accessory2: null,
    manuscript: null,
};

async function migrateUserEquipment() {
    console.log('--- [裝備數據遷移程序啟動] ---');
    console.log('正在掃描所有玩家檔案，檢查 equipment 結構...');

    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();

    if (snapshot.empty) {
        console.log('找不到任何玩家資料，程序結束。');
        return;
    }

    const batch = db.batch();
    let usersToUpdate = 0;

    snapshot.forEach(doc => {
        const userData = doc.data();
        const userId = doc.id;
        const currentEquipment = userData.equipment || {};
        let needsUpdate = false;
        
        const updatePayload = {};

        // 遍歷標準結構，檢查玩家數據中是否缺少欄位
        for (const slot in LATEST_EQUIPMENT_STRUCTURE) {
            if (!Object.prototype.hasOwnProperty.call(currentEquipment, slot)) {
                needsUpdate = true;
                // 使用點表示法來更新巢狀物件中的特定欄位
                updatePayload[`equipment.${slot}`] = LATEST_EQUIPMENT_STRUCTURE[slot]; 
            }
        }

        if (needsUpdate) {
            console.log(` -> 發現玩家 [${userData.username || userId}] 的 equipment 結構不完整，已加入待更新佇列。`);
            batch.update(doc.ref, updatePayload);
            usersToUpdate++;
        }
    });

    if (usersToUpdate > 0) {
        console.log(`\n共發現 ${usersToUpdate} 位玩家的數據需要更新，正在執行批量寫入...`);
        try {
            await batch.commit();
            console.log(`--- [數據遷移成功] ---`);
            console.log(`所有 ${usersToUpdate} 個玩家的裝備結構已被成功修補！`);
        } catch (error) {
            console.error('批量更新過程中發生錯誤:', error);
        }
    } else {
        console.log('\n--- [檢查完畢] ---');
        console.log('所有玩家的裝備數據結構都已是最新版本，無需遷移。');
    }
}

// 執行遷移腳本
migrateUserEquipment().then(() => {
    console.log("腳本執行完畢。");
    process.exit(0);
}).catch(error => {
    console.error('執行數據遷移腳本時發生致命錯誤:', error);
    process.exit(1);
});
