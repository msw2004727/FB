// api/models/inventoryModel.js
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 【輔助函式 v2.0】在事務中安全地獲取所需的所有文檔
 * @param {admin.firestore.Transaction} transaction - Firestore 事務對象
 * @param {string} userId - 玩家ID
 * @param {string} instanceId - 物品實例ID
 * @returns {Promise<{userRef: FirebaseFirestore.DocumentReference, userDoc: FirebaseFirestore.DocumentSnapshot, itemRef: FirebaseFirestore.DocumentReference, itemDoc: FirebaseFirestore.DocumentSnapshot, itemTemplateDoc: FirebaseFirestore.DocumentSnapshot}>}
 */
async function getRequiredDocumentsForEquip(transaction, userId, instanceId) {
    const userRef = db.collection('users').doc(userId);
    const itemRef = userRef.collection('inventory_items').doc(instanceId);

    // 執行所有讀取操作
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
 * 【核心重構 v9.0】裝備一件物品
 * @param {string} userId - 玩家ID
 * @param {string} instanceId - 要裝備的物品的唯一實例ID
 * @returns {Promise<object>} 返回操作結果
 */
async function equipItem(userId, instanceId) {
    console.log(`[模型層 v9.0] equipItem 啟動，用戶: ${userId}, 物品: ${instanceId}`);
    
    return db.runTransaction(async (transaction) => {
        // --- 讀取階段 ---
        const { userRef, userDoc, itemRef, itemTemplateDoc } = await getRequiredDocumentsForEquip(transaction, userId, instanceId);
        
        const itemTemplateData = itemTemplateDoc.data();
        const { equipSlot, hands, itemName, itemType } = itemTemplateData;

        if (itemType !== '武器' && itemType !== '裝備') {
            throw new Error(`「${itemName}」不是可裝備的物品。`);
        }
        
        const currentEquipmentState = { ...(userDoc.data().equipment || {}) };
        
        // 預備要卸下的物品引用
        const itemsToUnequipRefs = new Map();
        
        // 預讀取所有可能衝突的物品，以便後續判斷
        const conflictingItemIds = [];
        if (equipSlot && currentEquipmentState[equipSlot]) conflictingItemIds.push(currentEquipmentState[equipSlot]);
        if (hands === 2) {
             if (currentEquipmentState.weapon_right) conflictingItemIds.push(currentEquipmentState.weapon_right);
             if (currentEquipmentState.weapon_left) conflictingItemIds.push(currentEquipmentState.weapon_left);
        } else if (equipSlot && equipSlot.startsWith('weapon') && currentEquipmentState.weapon_right) {
             conflictingItemIds.push(currentEquipmentState.weapon_right);
        }

        const uniqueConflictingIds = [...new Set(conflictingItemIds.filter(id => id && id !== instanceId))];
        const conflictingItemDocs = uniqueConflictingIds.length > 0 
            ? await transaction.getAll(...uniqueConflictingIds.map(id => userRef.collection('inventory_items').doc(id)))
            : [];
        const conflictingItemTemplates = new Map();
        for(const doc of conflictingItemDocs) {
            if (doc.exists) {
                const templateId = doc.data().templateId;
                if(templateId) {
                    const template = (await transaction.get(db.collection('items').doc(templateId))).data();
                    conflictingItemTemplates.set(doc.id, template);
                }
            }
        }

        // --- 判斷與寫入階段 ---
        let newEquipmentState = { ...currentEquipmentState };

        // 卸下目標槽位的物品
        if (equipSlot && newEquipmentState[equipSlot]) {
             if (newEquipmentState[equipSlot] !== instanceId) {
                itemsToUnequipRefs.set(newEquipmentState[equipSlot], userRef.collection('inventory_items').doc(newEquipmentState[equipSlot]));
             }
        }
        
        // 處理雙手武器衝突
        if (hands === 2) {
            if (newEquipmentState.weapon_right) itemsToUnequipRefs.set(newEquipmentState.weapon_right, userRef.collection('inventory_items').doc(newEquipmentState.weapon_right));
            if (newEquipmentState.weapon_left) itemsToUnequipRefs.set(newEquipmentState.weapon_left, userRef.collection('inventory_items').doc(newEquipmentState.weapon_left));
        } else if (equipSlot && equipSlot.startsWith('weapon')) {
            if (newEquipmentState.weapon_right) {
                const rightHandTemplate = conflictingItemTemplates.get(newEquipmentState.weapon_right);
                if (rightHandTemplate && rightHandTemplate.hands === 2) {
                     itemsToUnequipRefs.set(newEquipmentState.weapon_right, userRef.collection('inventory_items').doc(newEquipmentState.weapon_right));
                }
            }
        }
        
        // 批次執行卸下
        itemsToUnequipRefs.forEach((ref, id) => {
            transaction.update(ref, { isEquipped: false });
            for(const slot in newEquipmentState) {
                if (newEquipmentState[slot] === id) {
                    newEquipmentState[slot] = null;
                }
            }
        });
        
        // 裝備新物品
        transaction.update(itemRef, { isEquipped: true });
        newEquipmentState[equipSlot] = instanceId;
        
        if (hands === 2) {
            newEquipmentState.weapon_right = instanceId;
            newEquipmentState.weapon_left = null;
        }
        
        transaction.update(userRef, { equipment: newEquipmentState });

        console.log(`[模型層 v9.0] 事務成功：裝備「${itemName}」，卸下了 ${itemsToUnequipRefs.size} 件物品。`);
        return { success: true, message: `已成功裝備 ${itemName}。` };
    });
}

/**
 * 【核心重構 v9.0】卸下一件裝備
 * @param {string} userId - 玩家ID
 * @param {string} instanceId - 要卸下的裝備的實例ID
 * @returns {Promise<object>} 返回操作結果
 */
async function unequipItem(userId, instanceId) {
    console.log(`[模型層 v9.0] unequipItem 啟動，用戶: ${userId}, 物品: ${instanceId}`);

    return db.runTransaction(async (transaction) => {
        // --- 讀取階段 ---
        const { userRef, userDoc, itemRef, itemDoc, itemTemplateDoc } = await getRequiredDocumentsForEquip(transaction, userId, instanceId);

        // --- 寫入階段 ---
        if (!itemDoc.data().isEquipped) {
            console.log(`[模型層 v9.0] 物品「${itemTemplateDoc.data().itemName}」已經是未裝備狀態。`);
            return { success: true, message: `${itemTemplateDoc.data().itemName} 已在背包中。` };
        }
        
        let newEquipmentState = { ...(userDoc.data().equipment || {}) };
        
        transaction.update(itemRef, { isEquipped: false });
        
        let foundAndRemoved = false;
        for (const slot in newEquipmentState) {
            if (newEquipmentState[slot] === instanceId) {
                newEquipmentState[slot] = null;
                foundAndRemoved = true;
            }
        }
        
        if (!foundAndRemoved) {
             console.warn(`[模型層 v9.0] 警告：要卸下的物品 ${instanceId} 在玩家的 equipment 物件中未被找到！但仍將其標記為未裝備。`);
        }

        transaction.update(userRef, { equipment: newEquipmentState });
        
        console.log(`[模型層 v9.0] 事務成功：卸下「${itemTemplateDoc.data().itemName}」。`);
        return { success: true, message: `${itemTemplateDoc.data().itemName} 已卸下。` };
    });
}


module.exports = {
    equipItem,
    unequipItem
};
