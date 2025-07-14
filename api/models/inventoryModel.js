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
 * 【核心重構 v9.3 - 武器佩掛規則強化版】裝備一件物品
 * @param {string} userId - 玩家ID
 * @param {string} instanceId - 要裝備的物品的唯一實例ID
 * @returns {Promise<object>} 返回操作結果
 */
async function equipItem(userId, instanceId) {
    console.log(`[模型層 v9.3] equipItem 啟動，用戶: ${userId}, 物品: ${instanceId}`);
    
    return db.runTransaction(async (transaction) => {
        const { userRef, userDoc, itemRef, itemTemplateDoc } = await getRequiredDocumentsForEquip(transaction, userId, instanceId);
        
        const itemToEquipData = itemTemplateDoc.data();
        const { equipSlot, hands, itemName, itemType } = itemToEquipData;

        if (!equipSlot || (itemType !== '武器' && itemType !== '裝備')) {
            throw new Error(`「${itemName}」不是可裝備的物品。`);
        }
        
        let newEquipmentState = { ...(userDoc.data().equipment || {}) };
        const itemsToUnequip = new Map(); // 使用Map來防止重複卸下同一件物品

        // --- 核心規則 v9.3 ---
        if (itemType === '武器') {
            // 情況一：佩掛【雙手武器】
            if (hands === 2) {
                // 雙手武器必須佩掛在腰間，佔用左右兩個位置
                if (newEquipmentState.weapon_right) itemsToUnequip.set(newEquipmentState.weapon_right, '為雙手武器騰出右腰');
                if (newEquipmentState.weapon_left) itemsToUnequip.set(newEquipmentState.weapon_left, '為雙手武器騰出左腰');
            } 
            // 情況二：佩掛【單手武器】
            else {
                // 如果目標位置是腰部（左或右）
                if (equipSlot === 'weapon_right' || equipSlot === 'weapon_left') {
                    // 檢查腰間當前是否佩掛著雙手武器
                    if (newEquipmentState.weapon_right && newEquipmentState.weapon_right === newEquipmentState.weapon_left) {
                        itemsToUnequip.set(newEquipmentState.weapon_right, '為單手武器騰出空間');
                    }
                    // 否則，只檢查目標單一位置
                    else if (newEquipmentState[equipSlot]) {
                        itemsToUnequip.set(newEquipmentState[equipSlot], `替換${equipSlot}的武器`);
                    }
                }
                // 如果目標位置是背後，則直接檢查背後
                else if (equipSlot === 'weapon_back' && newEquipmentState.weapon_back) {
                    itemsToUnequip.set(newEquipmentState.weapon_back, '替換背後的武器');
                }
            }
        } 
        // 情況三：穿戴防具或飾品
        else {
            if (newEquipmentState[equipSlot]) {
                itemsToUnequip.set(newEquipmentState[equipSlot], `替換舊裝備`);
            }
        }
        
        // --- 執行變更 ---
        // 1. 執行卸下
        itemsToUnequip.forEach((reason, id) => {
            console.log(`[裝備邏輯] 預計卸下 ${id}，原因: ${reason}`);
            const itemToUnequipRef = userRef.collection('inventory_items').doc(id);
            transaction.update(itemToUnequipRef, { isEquipped: false, equipSlot: null });
            // 從裝備狀態中移除所有指向該ID的槽位
            for (const slot in newEquipmentState) {
                if (newEquipmentState[slot] === id) {
                    newEquipmentState[slot] = null;
                }
            }
        });

        // 2. 執行佩掛/穿戴
        if (hands === 2) {
            newEquipmentState.weapon_right = instanceId;
            newEquipmentState.weapon_left = instanceId; // 用同一個ID表示這是一件雙手武器
        } else {
            newEquipmentState[equipSlot] = instanceId;
        }

        // 3. 更新資料庫
        transaction.update(itemRef, { isEquipped: true, equipSlot: equipSlot });
        transaction.update(userRef, { equipment: newEquipmentState });

        console.log(`[模型層 v9.3] 事務成功：裝備「${itemName}」。`);
        return { success: true, message: `已成功佩掛 ${itemName}。` };
    });
}


/**
 * 【核心重構 v9.3 - 規則強化版】卸下一件裝備
 * @param {string} userId - 玩家ID
 * @param {string} instanceId - 要卸下的裝備的實例ID
 * @returns {Promise<object>} 返回操作結果
 */
async function unequipItem(userId, instanceId) {
    console.log(`[模型層 v9.3] unequipItem 啟動，用戶: ${userId}, 物品: ${instanceId}`);

    return db.runTransaction(async (transaction) => {
        const { userRef, userDoc, itemRef, itemDoc, itemTemplateDoc } = await getRequiredDocumentsForEquip(transaction, userId, instanceId);

        if (!itemDoc.data().isEquipped) {
            console.log(`[模型層 v9.3] 物品「${itemTemplateDoc.data().itemName}」已經是未裝備狀態。`);
            return { success: true, message: `${itemTemplateDoc.data().itemName} 已在背包中。` };
        }
        
        let newEquipmentState = { ...(userDoc.data().equipment || {}) };
        
        // 標記物品為未裝備，並清除其槽位資訊
        transaction.update(itemRef, { isEquipped: false, equipSlot: null });
        
        // 從玩家的裝備狀態中移除該物品 (可能會有多個槽位指向同一個ID，例如雙手武器)
        let foundAndRemoved = false;
        for (const slot in newEquipmentState) {
            if (newEquipmentState[slot] === instanceId) {
                newEquipmentState[slot] = null;
                foundAndRemoved = true;
            }
        }
        
        if (!foundAndRemoved) {
             console.warn(`[模型層 v9.3] 警告：要卸下的物品 ${instanceId} 在玩家的 equipment 物件中未被找到！但仍將其標記為未裝備。`);
        }

        transaction.update(userRef, { equipment: newEquipmentState });
        
        console.log(`[模型層 v9.3] 事務成功：卸下「${itemTemplateDoc.data().itemName}」。`);
        return { success: true, message: `${itemTemplateDoc.data().itemName} 已卸下。` };
    });
}

module.exports = {
    equipItem,
    unequipItem
};
