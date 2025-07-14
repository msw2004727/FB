// api/migrations/equipmentMigration.js
const admin = require('firebase-admin');
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

const MIGRATION_ID = 'equipment_structure_v1';

async function runEquipmentMigration() {
    const migrationRef = db.collection('migrations').doc(MIGRATION_ID);
    
    try {
        const migrationDoc = await migrationRef.get();

        if (migrationDoc.exists) {
            console.log(`[數據遷移] 腳本 ${MIGRATION_ID} 已經執行過，本次將跳過。`);
            return;
        }

        console.log(`--- [裝備數據遷移程序啟動: ${MIGRATION_ID}] ---`);
        console.log('正在掃描所有玩家檔案，檢查 equipment 結構...');

        const usersRef = db.collection('users');
        const snapshot = await usersRef.get();

        if (snapshot.empty) {
            console.log('找不到任何玩家資料，程序結束。');
            await migrationRef.set({ 
                description: 'No users found to migrate.',
                completedAt: admin.firestore.FieldValue.serverTimestamp() 
            });
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

            for (const slot in LATEST_EQUIPMENT_STRUCTURE) {
                if (!Object.prototype.hasOwnProperty.call(currentEquipment, slot)) {
                    needsUpdate = true;
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
            await batch.commit();
            console.log(`--- [數據遷移成功] ---`);
            console.log(`所有 ${usersToUpdate} 個玩家的裝備結構已被成功修補！`);
        } else {
            console.log('\n--- [檢查完畢] ---');
            console.log('所有玩家的裝備數據結構都已是最新版本，無需遷移。');
        }

        // 標記遷移完成
        await migrationRef.set({ 
            id: MIGRATION_ID,
            description: 'Ensures all users have the complete equipment object structure.',
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            usersAffected: usersToUpdate
        });

    } catch (error) {
        console.error(`[數據遷移] 執行 ${MIGRATION_ID} 時發生嚴重錯誤:`, error);
        // 不拋出錯誤，避免伺服器啟動失敗
    }
}

module.exports = { runEquipmentMigration };
