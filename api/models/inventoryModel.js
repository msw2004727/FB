// api/models/inventoryModel.js
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 裝備一件物品
 * @param {string} userId - 玩家ID
 * @param {string} itemId - 要裝備的物品的唯一ID (instanceId)
 * @returns {Promise<object>} 返回操作結果
 */
async function equipItem(userId, itemId) {
    const userRef = db.collection('users').doc(userId);
    
    return db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists) throw new Error("找不到玩家資料。");

        const itemInstanceRef = userRef.collection('inventory_items').doc(itemId);
        const itemInstanceDoc = await transaction.get(itemInstanceRef);

        if (!itemInstanceDoc.exists) {
            throw new Error("在你的背包中找不到要裝備的物品。");
        }

        const userData = userDoc.data();
        const itemInstanceData = itemInstanceDoc.data();
        const templateId = itemInstanceData.templateId;

        if (!templateId) {
            throw new Error(`物品 ${itemId} 數據不完整，缺少templateId。`);
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

        let equipment = userData.equipment || {};
        
        const itemToEquip = { 
            ...itemTemplateData, 
            ...itemInstanceData,
            instanceId: itemId, 
            itemName: itemTemplateData.itemName || templateId 
        };

        // --- 核心卸下邏輯 ---
        if (hands === 2) { 
            const slotsToClear = ['weapon_right', 'weapon_left', 'weapon_back'];
            for (const slot of slotsToClear) {
                const unequippedItem = equipment[slot];
                if (unequippedItem && unequippedItem.instanceId) {
                    const unequippedRef = userRef.collection('inventory_items').doc(unequippedItem.instanceId);
                    transaction.set(unequippedRef, unequippedItem);
                }
                equipment[slot] = null;
            }
            equipment.weapon_right = itemToEquip; 
        } else { 
            const currentEquippedItem = equipment[equipSlot];
            if (currentEquippedItem && currentEquippedItem.instanceId) {
                 const oldItemRef = userRef.collection('inventory_items').doc(currentEquippedItem.instanceId);
                 transaction.set(oldItemRef, currentEquippedItem);
            }
            
            if(equipSlot.startsWith('weapon') && equipment.weapon_right?.hands === 2){
                const rightHandItem = equipment.weapon_right;
                if(rightHandItem && rightHandItem.instanceId) {
                    transaction.set(userRef.collection('inventory_items').doc(rightHandItem.instanceId), rightHandItem);
                }
                equipment.weapon_right = null;
            }
            equipment[equipSlot] = itemToEquip;
        }

        transaction.update(userRef, { equipment });
        transaction.delete(itemInstanceRef); 

        console.log(`[裝備系統] 物品 ${itemName} 已成功從背包移至裝備槽 ${equipSlot}。`);
        return { success: true, message: `${itemName} 已裝備。` };
    });
}


/**
 * 卸下一件裝備
 * @param {string} userId - 玩家ID
 * @param {string} slotToUnequip - 要卸下的裝備槽位
 * @returns {Promise<object>} 返回操作結果
 */
async function unequipItem(userId, slotToUnequip) {
    const userRef = db.collection('users').doc(userId);

    return db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists) throw new Error("找不到玩家資料。");

        const userData = userDoc.data();
        let equipment = userData.equipment || {};
        const equippedItemData = equipment[slotToUnequip];

        if (!equippedItemData || !equippedItemData.instanceId) {
            return { success: true, message: '該部位沒有裝備。' };
        }
        
        const inventoryItemRef = userRef.collection('inventory_items').doc(equippedItemData.instanceId);
        transaction.set(inventoryItemRef, equippedItemData);
        
        if(equippedItemData.hands === 2){
            equipment['weapon_right'] = null;
        } else {
            equipment[slotToUnequip] = null;
        }
        
        transaction.update(userRef, { equipment });
        
        console.log(`[裝備系統] 物品 ${equippedItemData.itemName} 已從 ${slotToUnequip} 卸下，並移回背包。`);
        return { success: true, message: `${equippedItemData.itemName} 已卸下。` };
    });
}


module.exports = {
    equipItem,
    unequipItem
};
