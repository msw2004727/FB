// api/locationManager.js
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 處理來自AI的地點資訊更新指令
 * @param {string} locationName 要更新的地點名稱
 * @param {Array<Object>} updates AI生成的更新指令陣列
 */
async function processLocationUpdates(locationName, updates) {
    if (!locationName || !updates || !Array.isArray(updates) || updates.length === 0) {
        return;
    }

    console.log(`[檔案管理員] 收到地點「${locationName}」的更新指令...`);
    const locationRef = db.collection('locations').doc(locationName);

    try {
        const doc = await locationRef.get();
        if (!doc.exists) {
            console.warn(`[檔案管理員] 警告：試圖更新一個不存在的地點檔案「${locationName}」。`);
            return;
        }

        // 使用 batch 來一次性處理所有更新，確保資料一致性
        const batch = db.batch();

        for (const update of updates) {
            const { fieldToUpdate, newValue, updateType } = update;

            if (!fieldToUpdate || newValue === undefined) continue;

            let updatePayload = {};

            if (updateType === 'arrayUnion') {
                // 使用 arrayUnion 來向陣列中添加新元素，可避免重複
                updatePayload[fieldToUpdate] = admin.firestore.FieldValue.arrayUnion(newValue);
            } else { // 預設為 'set'
                updatePayload[fieldToUpdate] = newValue;
            }

            batch.update(locationRef, updatePayload);
            console.log(`[檔案管理員] 已將「${locationName}」的欄位「${fieldToUpdate}」更新為：`, newValue);
        }

        await batch.commit();
        console.log(`[檔案管理員] 地點「${locationName}」的所有更新已成功提交。`);

    } catch (error) {
        console.error(`[檔案管理員] 在更新地點「${locationName}」時發生錯誤:`, error);
    }
}

module.exports = {
    processLocationUpdates,
};
