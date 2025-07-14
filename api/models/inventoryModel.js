// api/models/inventoryModel.js
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 【輔助函式】在事務中安全地獲取所需的所有文檔
 * @param {admin.firestore.Transaction} transaction - Firestore 事務對象
 * @param {string} userId - 玩家ID
 * @param {string} instanceId - 物品實例ID
 * @returns {Promise<{userRef: FirebaseFirestore.DocumentReference, itemRef: FirebaseFirestore.DocumentReference, itemDoc: FirebaseFirestore.DocumentSnapshot, itemTemplateDoc: FirebaseFirestore.DocumentSnapshot}>}
 */
async function getRequiredDocumentsForEquip(transaction, userId, instanceId) {
    const userRef = db.collection('users').doc(userId);
    const itemRef = userRef.collection('inventory_items').doc(instanceId);

    const [userDoc, itemDoc] = await transaction.getAll(userRef, itemRef);

    if (!userDoc.exists) throw new Error(`找不到玩家(ID: ${userId})的檔案。`);
    if (!itemDoc.exists) throw new Error(`在你的背包中找不到ID為 ${instanceId} 的物品。`);

    const templateId = itemDoc.data().templateId;
    if (!templateId) throw new Error(`物品 ${instanceId} 數據不完整，缺少 templateId。`);
    
    const itemTemplateRef = db.collection('items').doc(templateId);
    const itemTemplateDoc = await transaction.get(itemTemplateRef);

    if (!itemTemplateDoc.exists) throw new Error(`找不到物品「${templateId}」的設計圖。`);

    return { userRef, userDoc, itemRef, itemDoc, itemTemplateDoc };
}


/**
 * 【核心重構 v7.0】裝備一件物品 (整體替換 + 詳細日誌策略)
 * @param {string} userId - 玩家ID
 * @param {string} instanceId - 要裝備的物品的唯一實例ID
 * @returns {Promise<object>} 返回操作結果
 */
async function equipItem(userId, instanceId) {
    console.log(`[模型層 v7.0] equipItem 啟動，用戶: ${userId}, 物品: ${instanceId}`);
    
    return db.runTransaction(async (transaction) => {
        const { userRef, itemRef, itemTemplateDoc } = await getRequiredDocumentsForEquip(transaction, userId, instanceId);
        
        const itemTemplateData = itemTemplateDoc.data();
        const { equipSlot, hands, itemName, itemType } = itemTemplateData;

        if (itemType !== '武器' && itemType !== '裝備') {
            throw new Error(`「${itemName}」不是可裝備的物品。`);
        }
        console.log(`[模型層 v7.0] 準備裝備「${itemName}」到槽位: ${equipSlot}, 類型: ${itemType}`);

        const currentUserDoc = await transaction.get(userRef);
        let newEquipmentState = { ...(currentUserDoc.data().equipment || {}) };
        console.log('[模型層 v7.0] 讀取到的當前裝備狀態:', newEquipmentState);

        const itemsToUnequip = new Map();

        // 卸下衝突的裝備
        if (equipSlot && newEquipmentState[equipSlot]) {
            const conflictingItemId = newEquipmentState[equipSlot];
            itemsToUnequip.set(conflictingItemId, userRef.collection('inventory_items').doc(conflictingItemId));
            newEquipmentState[equipSlot] = null;
        }

        if (hands === 2) { // 裝備雙手武器，清空雙手
            if (newEquipmentState.weapon_right) itemsToUnequip.set(newEquipmentState.weapon_right, userRef.collection('inventory_items').doc(newEquipmentState.weapon_right));
            if (newEquipmentState.weapon_left) itemsToUnequip.set(newEquipmentState.weapon_left, userRef.collection('inventory_items').doc(newEquipmentState.weapon_left));
            newEquipmentState.weapon_right = null;
            newEquipmentState.weapon_left = null;
        } else if (hands === 1 && newEquipmentState.weapon_right) { // 裝備單手武器時，檢查右手是否為雙手武器
            const rightHandItemRef = userRef.collection('inventory_items').doc(newEquipmentState.weapon_right);
            const rightHandItemDoc = await transaction.get(rightHandItemRef);
            if(rightHandItemDoc.exists) {
                const rightHandTemplateDoc = await transaction.get(db.collection('items').doc(rightHandItemDoc.data().templateId));
                if (rightHandTemplateDoc.exists && rightHandTemplateDoc.data().hands === 2) {
                    itemsToUnequip.set(newEquipmentState.weapon_right, rightHandItemRef);
                    newEquipmentState.weapon_right = null;
                }
            }
        }
        
        // 批次卸下
        itemsToUnequip.forEach(ref => transaction.update(ref, { isEquipped: false }));
        console.log(`[模型層 v7.0] ${itemsToUnequip.size} 件物品已加入卸下佇列。`);

        // 裝備新物品
        transaction.update(itemRef, { isEquipped: true });
        newEquipmentState[equipSlot] = instanceId;
        console.log('[模型層 v7.0] 計算出的最終新裝備狀態:', newEquipmentState);

        // 將全新的、完整的裝備對象寫回玩家主文件
        transaction.update(userRef, { equipment: newEquipmentState });
        console.log('[模型層 v7.0] 事務更新已準備提交到 userRef。');

        return { success: true, message: `已成功裝備 ${itemName}。` };
    });
}

/**
 * 【核心重構 v7.0】卸下一件裝備 (整體替換 + 詳細日誌策略)
 * @param {string} userId - 玩家ID
 * @param {string} instanceId - 要卸下的裝備的實例ID
 * @returns {Promise<object>} 返回操作結果
 */
async function unequipItem(userId, instanceId) {
    console.log(`[模型層 v7.0] unequipItem 啟動，用戶: ${userId}, 物品: ${instanceId}`);

    return db.runTransaction(async (transaction) => {
        const { userRef, itemDoc, itemTemplateDoc } = await getRequiredDocumentsForEquip(transaction, userId, instanceId);

        if (!itemDoc.data().isEquipped) throw new Error('該物品未被裝備。');
        
        const itemName = itemTemplateDoc.data().itemName || "未知物品";
        const equipSlot = itemTemplateDoc.data().equipSlot;
        console.log(`[模型層 v7.0] 準備卸下「${itemName}」，它屬於槽位: ${equipSlot}`);
        
        transaction.update(itemDoc.ref, { isEquipped: false });
        
        const currentUserState = (await transaction.get(userRef)).data();
        let newEquipmentState = { ...currentUserState.equipment };
        let foundAndRemoved = false;
        
        Object.keys(newEquipmentState).forEach(slot => {
            if (newEquipmentState[slot] === instanceId) {
                newEquipmentState[slot] = null;
                foundAndRemoved = true;
                console.log(`[模型層 v7.0] 已從 newEquipmentState 的 ${slot} 槽位移除 ${instanceId}`);
            }
        });

        if (!foundAndRemoved) console.warn(`[模型層 v7.0] 警告：要卸下的物品 ${instanceId} 在玩家的 equipment 物件中未被找到！`);

        transaction.update(userRef, { equipment: newEquipmentState });
        console.log('[模型層 v7.0] 事務更新已準備提交到 userRef。');
        
        return { success: true, message: `${itemName} 已卸下。` };
    });
}

module.exports = {
    equipItem,
    unequipItem
};
