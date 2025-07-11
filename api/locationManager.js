// api/locationManager.js
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 【核心修改 2.0】處理來自AI的、更複雜的地點狀態更新指令陣列
 * @param {string} userId - 玩家的ID
 * @param {string} locationName - 要更新的地點名稱
 * @param {Array<Object>} updates - AI生成的更新指令陣列
 */
async function processLocationUpdates(userId, locationName, updates) {
    if (!userId || !locationName || !updates || !Array.isArray(updates) || updates.length === 0) {
        return;
    }

    console.log(`[地點狀態更新] 收到為玩家 ${userId} 更新地點「${locationName}」狀態的指令...`);
    const locationStateRef = db.collection('users').doc(userId).collection('location_states').doc(locationName);

    try {
        const doc = await locationStateRef.get();
        if (!doc.exists) {
            console.warn(`[地點狀態更新] 警告：玩家 ${userId} 試圖更新一個不存在的地點狀態檔案「${locationName}」。將跳過此操作。`);
            return;
        }

        const batch = db.batch();

        for (const update of updates) {
            const { fieldToUpdate, newValue, updateType } = update;

            if (!fieldToUpdate || newValue === undefined) continue;

            let updatePayload = {};

            switch (updateType) {
                case 'arrayUnion':
                    updatePayload[fieldToUpdate] = admin.firestore.FieldValue.arrayUnion(newValue);
                    break;
                case 'arrayRemove':
                    updatePayload[fieldToUpdate] = admin.firestore.FieldValue.arrayRemove(newValue);
                    break;
                case 'increment':
                     updatePayload[fieldToUpdate] = admin.firestore.FieldValue.increment(newValue);
                    break;
                case 'set':
                default:
                    // 使用點標記法來直接更新巢狀物件中的欄位
                    updatePayload[fieldToUpdate] = newValue;
                    break;
            }

            // 使用 set 配合 { merge: true } 來安全地更新巢狀欄位
            batch.set(locationStateRef, updatePayload, { merge: true });
            console.log(`[地點狀態更新] 已為玩家 ${userId} 在「${locationName}」的狀態檔案中，將欄位「${fieldToUpdate}」以「${updateType}」方式更新為：`, newValue);
        }

        await batch.commit();
        console.log(`[地點狀態更新] 地點「${locationName}」的玩家個人狀態已成功批次提交。`);

    } catch (error) {
        console.error(`[地點狀態更新] 在更新玩家 ${userId} 的地點「${locationName}」狀態時發生錯誤:`, error);
    }
}

module.exports = {
    processLocationUpdates,
};
