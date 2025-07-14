// api/models/inventoryModel.js
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 輔助函式：在事務中獲取所有已裝備的物品及其模板數據
 * @param {admin.Transaction} transaction - Firestore 事務對象
 * @param {CollectionReference} userInventoryRef - 玩家物品集合的引用
 * @returns {Promise<Map<string, object>>} 返回一個 Map，鍵為裝備槽位，值為包含文檔和模板數據的武器物件
 */
async function getEquippedItemsWithTemplate(transaction, userInventoryRef) {
    const equippedItems = new Map();
    const snapshot = await transaction.get(userInventoryRef.where('isEquipped', '==', true));

    if (snapshot.empty) {
        return equippedItems;
    }
    
    // 預先抓取所有模板，減少事務中的讀取次數
    const templateIds = snapshot.docs.map(doc => doc.data().templateId).filter(Boolean);
    const templateRefs = templateIds.map(id => db.collection('items').doc(id));
    const templateDocs = await transaction.getAll(...templateRefs);
    const templates = new Map(templateDocs.map(doc => [doc.id, doc.data()]));

    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.equipSlot) {
            equippedItems.set(data.equipSlot, { 
                id: doc.id, 
                ref: doc.ref, 
                ...data,
                template: templates.get(data.templateId) || {}
            });
        }
    });

    return equippedItems;
}


/**
 * 【重構版 4.0】裝備一件物品 (全新智慧槽位管理系統)
 * @param {string} userId - 玩家ID
 * @param {string} instanceId - 要裝備的物品的唯一實例ID
 * @returns {Promise<object>} 返回操作結果
 */
async function equipItem(userId, instanceId) {
    const userInventoryRef = db.collection('users').doc(userId).collection('inventory_items');
    
    return db.runTransaction(async (transaction) => {
        const itemToEquipRef = userInventoryRef.doc(instanceId);
        const itemToEquipDoc = await transaction.get(itemToEquipRef);

        if (!itemToEquipDoc.exists) {
            throw new Error(`在你的背包中找不到ID為 ${instanceId} 的物品。`);
        }

        const templateId = itemToEquipDoc.data().templateId;
        if (!templateId) {
            throw new Error(`物品 ${instanceId} 數據不完整，缺少templateId。`);
        }
        
        const itemTemplateRef = db.collection('items').doc(templateId);
        const itemTemplateDoc = await transaction.get(itemTemplateRef);

        if (!itemTemplateDoc.exists) {
            throw new Error(`找不到物品「${templateId}」的設計圖。`);
        }
        
        const itemTemplateData = itemTemplateDoc.data();
        const { equipSlot, hands, itemName, itemType } = itemTemplateData;

        if (itemType !== '武器' && itemType !== '裝備') {
            throw new Error(`「${itemName}」不是可裝備的物品。`);
        }

        const equippedItems = await getEquippedItemsWithTemplate(transaction, userInventoryRef);

        // --- 處理非武器裝備的邏輯 (防具/飾品) ---
        if (itemType === '裝備') {
             if (!equipSlot) {
                throw new Error(`「${itemName}」作為一件裝備，卻沒有指定的裝備槽位(equipSlot)。`);
             }
             // 卸下同一槽位的裝備
             const conflictingItem = equippedItems.get(equipSlot);
             if (conflictingItem) {
                 transaction.update(conflictingItem.ref, { isEquipped: false, equipSlot: null });
             }
             // 裝備新物品
             transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: equipSlot });
             return { success: true, message: `${itemName} 已裝備。` };
        }

        // --- 全新的武器裝備邏輯 ---
        if (itemType === '武器') {
            const isTwoHanded = hands === 2;

            const rightHandWeapon = equippedItems.get('weapon_right');
            const leftHandWeapon = equippedItems.get('weapon_left');
            const backWeapon = equippedItems.get('weapon_back');
            const isRightHandTwoHanded = rightHandWeapon && rightHandWeapon.template.hands === 2;

            if (isTwoHanded) {
                // **裝備雙手武器**
                if (!rightHandWeapon || !isRightHandTwoHanded) {
                    // 優先裝備到手上：如果右手沒武器，或右手是單手武器
                    if (rightHandWeapon) transaction.update(rightHandWeapon.ref, { isEquipped: false, equipSlot: null });
                    if (leftHandWeapon) transaction.update(leftHandWeapon.ref, { isEquipped: false, equipSlot: null });
                    transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: 'weapon_right' });
                } else if (!backWeapon) {
                    // 手上已經是雙手武器，則嘗試裝備到背後
                    transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: 'weapon_back' });
                } else {
                    // 手上和背後都滿了，替換手上的
                    transaction.update(rightHandWeapon.ref, { isEquipped: false, equipSlot: null });
                    transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: 'weapon_right' });
                }
            } else {
                // **裝備單手武器**
                if (!rightHandWeapon) {
                    transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: 'weapon_right' });
                } else if (!isRightHandTwoHanded && !leftHandWeapon) {
                    // 右手是單手且左手為空
                    transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: 'weapon_left' });
                } else if (!backWeapon) {
                    transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: 'weapon_back' });
                } else {
                    // 所有槽位都滿了，替換右手武器
                    if (isRightHandTwoHanded) { // 如果右手是雙手武器，則左右手都空出來
                         if (leftHandWeapon) transaction.update(leftHandWeapon.ref, { isEquipped: false, equipSlot: null });
                    }
                    transaction.update(rightHandWeapon.ref, { isEquipped: false, equipSlot: null });
                    transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: 'weapon_right' });
                }
            }
        }
        
        return { success: true, message: `${itemName} 已裝備。` };
    });
}


/**
 * 卸下一件裝備
 * @param {string} userId - 玩家ID
 * @param {string} instanceId - 要卸下的裝備的實例ID
 * @returns {Promise<object>} 返回操作結果
 */
async function unequipItem(userId, instanceId) {
    const userInventoryRef = db.collection('users').doc(userId).collection('inventory_items');
    const itemToUnequipRef = userInventoryRef.doc(instanceId);

    return db.runTransaction(async (transaction) => {
        const itemDoc = await transaction.get(itemToUnequipRef);
        if (!itemDoc.exists || !itemDoc.data().isEquipped) {
            throw new Error('該物品未被裝備或不存在。');
        }

        const itemName = itemDoc.data().templateId || '未知物品';
        
        transaction.update(itemToUnequipRef, { isEquipped: false, equipSlot: null });
        
        console.log(`[裝備系統 v4.0] 玩家 ${userId} 的 ${itemName} 已卸下。`);
        return { success: true, message: `${itemName} 已卸下。` };
    });
}


module.exports = {
    equipItem,
    unequipItem
};
