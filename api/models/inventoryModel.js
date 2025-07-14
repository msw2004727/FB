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
 * 【核心重構 v9.2 - 規則強化版】裝備一件物品
 * @param {string} userId - 玩家ID
 * @param {string} instanceId - 要裝備的物品的唯一實例ID
 * @returns {Promise<object>} 返回操作結果
 */
async function equipItem(userId, instanceId) {
    console.log(`[模型層 v9.2] equipItem 啟動，用戶: ${userId}, 物品: ${instanceId}`);
    
    return db.runTransaction(async (transaction) => {
        const { userRef, userDoc, itemRef, itemDoc, itemTemplateDoc } = await getRequiredDocumentsForEquip(transaction, userId, instanceId);
        
        const itemToEquipData = itemTemplateDoc.data();
        const { equipSlot, hands, itemName, itemType } = itemToEquipData;

        if (itemType !== '武器' && itemType !== '裝備') {
            throw new Error(`「${itemName}」不是可裝備的物品。`);
        }
        
        const currentEquipment = { ...(userDoc.data().equipment || {}) };
        const itemsToUnequip = new Map(); // 使用Map來防止重複卸下同一件物品

        // --- 核心規則判斷 ---

        // 1. 如果要裝備的是非武器裝備（頭、身、手、腳等）
        if (itemType === '裝備') {
            if (currentEquipment[equipSlot]) {
                itemsToUnequip.set(currentEquipment[equipSlot], `卸下原本的${equipSlot}`);
            }
        }

        // 2. 如果要裝備的是武器
        if (itemType === '武器') {
            // 2a. 如果要裝備的是【雙手武器】
            if (hands === 2) {
                // 無論目標槽位是什麼，雙手武器都會佔用左右腰部，並卸下這兩個位置的任何東西
                if (currentEquipment.weapon_right) itemsToUnequip.set(currentEquipment.weapon_right, '為雙手武器騰出右腰');
                if (currentEquipment.weapon_left) itemsToUnequip.set(currentEquipment.weapon_left, '為雙手武器騰出左腰');
            }
            // 2b. 如果要裝備的是【單手武器】
            else {
                // 如果目標槽位（左/右腰）已經有【雙手武器】，則必須卸下該雙手武器
                if ((equipSlot === 'weapon_left' || equipSlot === 'weapon_right') && currentEquipment.weapon_right && currentEquipment.weapon_right === currentEquipment.weapon_left) {
                     itemsToUnequip.set(currentEquipment.weapon_right, '為單手武器騰出空間');
                }
                // 如果目標槽位已有其他物品，卸下它
                else if (currentEquipment[equipSlot]) {
                    itemsToUnequip.set(currentEquipment[equipSlot], `卸下原本的${equipSlot}`);
                }
            }
        }
        
        // --- 執行變更 ---

        // 建立一個新的裝備狀態物件
        let newEquipmentState = { ...currentEquipment };

        // 批次卸下需要卸下的物品
        itemsToUnequip.forEach((reason, id) => {
            console.log(`[裝備邏輯] 預計卸下 ${id}，原因: ${reason}`);
            const itemToUnequipRef = userRef.collection('inventory_items').doc(id);
            transaction.update(itemToUnequipRef, { isEquipped: false, equipSlot: null });
            // 從新的裝備狀態中移除
            for (const slot in newEquipmentState) {
                if (newEquipmentState[slot] === id) {
                    newEquipmentState[slot] = null;
                }
            }
        });

        // 裝備新物品
        transaction.update(itemRef, { isEquipped: true, equipSlot: equipSlot });
        
        // 更新新的裝備狀態
        if (hands === 2) {
            // 雙手武器同時佔用左右兩個邏輯槽位，但都指向同一個物品實例ID
            newEquipmentState.weapon_right = instanceId;
            newEquipmentState.weapon_left = instanceId;
        } else {
            newEquipmentState[equipSlot] = instanceId;
        }
        
        // 將最終的裝備狀態寫回玩家檔案
        transaction.update(userRef, { equipment: newEquipmentState });

        console.log(`[模型層 v9.2] 事務成功：裝備「${itemName}」。`);
        return { success: true, message: `已成功佩掛 ${itemName}。` };
    });
}


/**
 * 【核心重構 v9.2 - 規則強化版】卸下一件裝備
 * @param {string} userId - 玩家ID
 * @param {string} instanceId - 要卸下的裝備的實例ID
 * @returns {Promise<object>} 返回操作結果
 */
async function unequipItem(userId, instanceId) {
    console.log(`[模型層 v9.2] unequipItem 啟動，用戶: ${userId}, 物品: ${instanceId}`);

    return db.runTransaction(async (transaction) => {
        const { userRef, userDoc, itemRef, itemDoc, itemTemplateDoc } = await getRequiredDocumentsForEquip(transaction, userId, instanceId);

        if (!itemDoc.data().isEquipped) {
            console.log(`[模型層 v9.2] 物品「${itemTemplateDoc.data().itemName}」已經是未裝備狀態。`);
            return { success: true, message: `${itemTemplateDoc.data().itemName} 已在背包中。` };
        }
        
        let newEquipmentState = { ...(userDoc.data().equipment || {}) };
        
        // 標記物品為未裝備，並清除其槽位資訊
        transaction.update(itemRef, { isEquipped: false, equipSlot: null });
        
        // 從玩家的裝備狀態中移除該物品
        let foundAndRemoved = false;
        for (const slot in newEquipmentState) {
            if (newEquipmentState[slot] === instanceId) {
                newEquipmentState[slot] = null;
                foundAndRemoved = true;
            }
        }
        
        if (!foundAndRemoved) {
             console.warn(`[模型層 v9.2] 警告：要卸下的物品 ${instanceId} 在玩家的 equipment 物件中未被找到！但仍將其標記為未裝備。`);
        }

        transaction.update(userRef, { equipment: newEquipmentState });
        
        console.log(`[模型層 v9.2] 事務成功：卸下「${itemTemplateDoc.data().itemName}」。`);
        return { success: true, message: `${itemTemplateDoc.data().itemName} 已卸下。` };
    });
}

module.exports = {
    equipItem,
    unequipItem
};
