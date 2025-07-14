// api/models/inventoryModel.js
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 輔助函式：在事務中獲取所有已裝備的武器
 * @param {admin.Transaction} transaction - Firestore 事務對象
 * @param {CollectionReference} userInventoryRef - 玩家物品集合的引用
 * @returns {Promise<Map<string, object>>} 返回一個 Map，鍵為裝備槽位，值為武器文檔
 */
async function getEquippedWeapons(transaction, userInventoryRef) {
    const equippedWeapons = new Map();
    const snapshot = await transaction.get(userInventoryRef.where('isEquipped', '==', true));
    
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.equipSlot && data.equipSlot.startsWith('weapon')) {
            equippedWeapons.set(data.equipSlot, { id: doc.id, ref: doc.ref, ...data });
        }
    });
    return equippedWeapons;
}


/**
 * 【重構版 3.0】裝備一件物品 (全新智慧槽位管理系統)
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

        // --- 獲取當前所有已裝備的武器 ---
        const equippedWeapons = await getEquippedWeapons(transaction, userInventoryRef);

        // --- 處理非武器裝備的邏輯 ---
        if (itemType === '裝備') {
             if (!equipSlot) {
                throw new Error(`「${itemName}」作為一件裝備，卻沒有指定的裝備槽位(equipSlot)。`);
             }
             // 卸下同一槽位的裝備
             const conflictingItem = equippedWeapons.get(equipSlot);
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

            if (isTwoHanded) {
                // **裝備雙手武器**
                // 需要 'weapon_right' 和 'weapon_left' 兩個槽位
                
                // 卸下左右手槽位的任何武器
                const rightHandWeapon = equippedWeapons.get('weapon_right');
                const leftHandWeapon = equippedWeapons.get('weapon_left');
                if (rightHandWeapon) {
                    transaction.update(rightHandWeapon.ref, { isEquipped: false, equipSlot: null });
                }
                if (leftHandWeapon) {
                    transaction.update(leftHandWeapon.ref, { isEquipped: false, equipSlot: null });
                }
                
                // 裝備雙手武器，標記到 'weapon_right' 代表佔用雙手
                transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: 'weapon_right' });
                console.log(`[裝備系統 v3.0] 玩家 ${userId} 的雙手武器 ${itemName} 已裝備，佔用左右手槽位。`);

            } else {
                // **裝備單手武器**
                // 智慧尋找可用槽位：右手 -> 左手 -> 背後
                
                const rightHandWeapon = equippedWeapons.get('weapon_right');
                const leftHandWeapon = equippedWeapons.get('weapon_left');
                const backWeapon = equippedWeapons.get('weapon_back');

                if (!rightHandWeapon) {
                    // 右手為空，直接裝備
                    transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: 'weapon_right' });
                } else if (!leftHandWeapon) {
                    // 左手為空，判斷右手是否為雙手武器
                    const rightHandTemplateDoc = await transaction.get(db.collection('items').doc(rightHandWeapon.templateId));
                    if (rightHandTemplateDoc.exists && rightHandTemplateDoc.data().hands === 2) {
                        // 如果右手是雙手武器，則必須先卸下
                        transaction.update(rightHandWeapon.ref, { isEquipped: false, equipSlot: null });
                        transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: 'weapon_right' });
                    } else {
                        // 右手是單手，直接裝備到左手
                        transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: 'weapon_left' });
                    }
                } else if (!backWeapon) {
                    // 左右手都滿了，裝備到背後
                    transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: 'weapon_back' });
                } else {
                    // 所有槽位都滿了，替換掉右手武器
                    transaction.update(rightHandWeapon.ref, { isEquipped: false, equipSlot: null });
                    transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: 'weapon_right' });
                }
                 console.log(`[裝備系統 v3.0] 玩家 ${userId} 的單手武器 ${itemName} 已裝備。`);
            }
        }
        
        return { success: true, message: `${itemName} 已裝備。` };
    });
}

/**
 * 卸下一件裝備 (支持雙手武器)
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
        
        // 卸下邏輯很簡單，直接清除標記即可
        transaction.update(itemToUnequipRef, { isEquipped: false, equipSlot: null });
        
        console.log(`[裝備系統 v3.0] 玩家 ${userId} 的 ${itemName} 已卸下。`);
        return { success: true, message: `${itemName} 已卸下。` };
    });
}


module.exports = {
    equipItem,
    unequipItem
};
