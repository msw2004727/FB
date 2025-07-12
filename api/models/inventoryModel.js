// api/models/inventoryModel.js
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 【重構版 2.0】裝備一件物品 (智慧型槽位管理)
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
        const { equipSlot, hands, itemName } = itemTemplateData;

        if (!equipSlot) {
            throw new Error(`「${itemName}」不是可裝備的物品。`);
        }

        // --- 核心卸下邏輯 ---
        const unequipPromises = [];
        
        // 1. 如果要裝備的是雙手武器，則卸下所有武器槽的物品
        if (hands === 2) {
            const allWeaponsSnapshot = await transaction.get(userInventoryRef.where('equipSlot', 'in', ['weapon_right', 'weapon_left', 'weapon_back']));
            allWeaponsSnapshot.forEach(doc => {
                transaction.update(doc.ref, { isEquipped: false, equipSlot: null });
            });
        }

        // 2. 處理非武器或單手武器的槽位衝突
        //    (飾品槽位比較特殊，暫不在此處理，由前端邏輯或另一套系統處理)
        if (equipSlot !== 'accessory1' && equipSlot !== 'accessory2') {
             const conflictingItemSnapshot = await transaction.get(userInventoryRef.where('equipSlot', '==', equipSlot).limit(1));
             if (!conflictingItemSnapshot.empty) {
                const conflictingDocRef = conflictingItemSnapshot.docs[0].ref;
                transaction.update(conflictingDocRef, { isEquipped: false, equipSlot: null });
             }
        }
       
        // --- 正式裝備新物品 ---
        transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: equipSlot });

        console.log(`[裝備系統 v3.0] 玩家 ${userId} 的 ${itemName} 已裝備至 ${equipSlot}。`);
        return { success: true, message: `${itemName} 已裝備。` };
    });
}

/**
 * 【重構版】卸下一件裝備 (直接更新物品狀態)
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
        
        console.log(`[裝備系統 v3.0] 玩家 ${userId} 的 ${itemName} 已卸下。`);
        return { success: true, message: `${itemName} 已卸下。` };
    });
}


module.exports = {
    equipItem,
    unequipItem
};
