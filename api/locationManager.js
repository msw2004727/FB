// api/locationManager.js
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 【核心修改】處理來自AI的地點資訊更新指令，現在會更新玩家的個人狀態
 * @param {string} userId - 玩家的ID
 * @param {string} locationName - 要更新的地點名稱
 * @param {Array<Object>} updates - AI生成的更新指令陣列
 */
async function processLocationUpdates(userId, locationName, updates) {
    if (!userId || !locationName || !updates || !Array.isArray(updates) || updates.length === 0) {
        return;
    }

    console.log(`[檔案管理員] 收到為玩家 ${userId} 更新地點「${locationName}」狀態的指令...`);
    // 【核心修改】路徑指向玩家個人專屬的 location_states 集合
    const locationStateRef = db.collection('users').doc(userId).collection('location_states').doc(locationName);

    try {
        const doc = await locationStateRef.get();
        if (!doc.exists) {
            // 這個情況很罕見，因為理論上玩家抵達時就該被初始化了，但做個保護
            console.warn(`[檔案管理員] 警告：玩家 ${userId} 試圖更新一個不存在的地點狀態檔案「${locationName}」。`);
            return;
        }

        const batch = db.batch();

        for (const update of updates) {
            const { fieldToUpdate, newValue, updateType } = update;

            if (!fieldToUpdate || newValue === undefined) continue;

            let updatePayload = {};

            if (updateType === 'arrayUnion') {
                updatePayload[fieldToUpdate] = admin.firestore.FieldValue.arrayUnion(newValue);
            } else { // 預設為 'set'
                updatePayload[fieldToUpdate] = newValue;
            }

            batch.update(locationStateRef, updatePayload);
            console.log(`[檔案管理員] 已將玩家 ${userId} 在「${locationName}」的狀態欄位「${fieldToUpdate}」更新為：`, newValue);
        }

        await batch.commit();
        console.log(`[檔案管理員] 地點「${locationName}」的玩家個人狀態已成功提交。`);

    } catch (error) {
        console.error(`[檔案管理員] 在更新玩家 ${userId} 的地點「${locationName}」狀態時發生錯誤:`, error);
    }
}

module.exports = {
    processLocationUpdates,
};
