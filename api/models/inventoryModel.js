// api/models/inventoryModel.js
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 【重構版】裝備一件物品 (直接更新物品狀態)
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
        // 查找當前裝備在同一個或衝突槽位上的其他物品
        let slotsToClear = [equipSlot];
        // 如果裝備雙手武器，需要清空左右手和背部
        if (hands === 2) {
             slotsToClear = ['weapon_right', 'weapon_left', 'weapon_back'];
        }
        // 如果裝備單手武器或背部武器，需要檢查當前是否裝備了雙手武器
        if (equipSlot.startsWith('weapon')) {
            const rightHandItemSnapshot = await transaction.get(userInventoryRef.where('equipSlot', '==', 'weapon_right').limit(1));
            if (!rightHandItemSnapshot.empty) {
                const rightHandItemTemplateId = rightHandItemSnapshot.docs[0].data().templateId;
                const rightHandTemplateDoc = (await transaction.get(db.collection('items').doc(rightHandItemTemplateId))).data();
                if (rightHandTemplateDoc && rightHandTemplateDoc.hands === 2) {
                    slotsToClear.push('weapon_right'); // 將雙手武器卸下
                }
            }
        }
        
        // 批次卸下衝突裝備
        const currentlyEquippedSnapshot = await transaction.get(userInventoryRef.where('equipSlot', 'in', slotsToClear));
        currentlyEquippedSnapshot.forEach(doc => {
            transaction.update(doc.ref, { isEquipped: false, equipSlot: null });
        });

        // --- 正式裝備新物品 ---
        transaction.update(itemToEquipRef, { isEquipped: true, equipSlot: equipSlot });

        console.log(`[裝備系統 v2] 玩家 ${userId} 的 ${itemName} 已裝備至 ${equipSlot}。`);
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
        
        console.log(`[裝備系統 v2] 玩家 ${userId} 的 ${itemName} 已卸下。`);
        return { success: true, message: `${itemName} 已卸下。` };
    });
}


module.exports = {
    equipItem,
    unequipItem
};
