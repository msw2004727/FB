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
            instanceId: itemId // 確保instanceId被正確傳遞
        };

        // 卸下被替換的物品
        if (hands === 2) { // 裝備雙手武器
            const slotsToClear = ['weapon_right', 'weapon_left', 'weapon_back'];
            for (const slot of slotsToClear) {
                if (equipment[slot] && equipment[slot].instanceId) {
                    transaction.set(userRef.collection('inventory_items').doc(equipment[slot].instanceId), equipment[slot]);
                }
                equipment[slot] = null;
            }
            equipment.weapon_right = itemToEquip; 
        } else { // 裝備單手武器或防具
            const currentEquippedItem = equipment[equipSlot];
            if (currentEquippedItem && currentEquippedItem.instanceId) {
                 transaction.set(userRef.collection('inventory_items').doc(currentEquippedItem.instanceId), currentEquippedItem);
            }
            // 如果裝備的是單手武器，且另一隻手是雙手武器，則卸下雙手武器
            if(equipSlot === 'weapon_left' && equipment.weapon_right?.hands === 2){
                transaction.set(userRef.collection('inventory_items').doc(equipment.weapon_right.instanceId), equipment.weapon_right);
                equipment.weapon_right = null;
            }
             if(equipSlot === 'weapon_right' && equipment.weapon_right?.hands === 2){
                transaction.set(userRef.collection('inventory_items').doc(equipment.weapon_right.instanceId), equipment.weapon_right);
                equipment.weapon_right = null;
            }
            equipment[equipSlot] = itemToEquip;
        }

        // 從背包中刪除現在要裝備的物品
        transaction.delete(itemInstanceRef);
        // 更新玩家的裝備狀態
        transaction.update(userRef, { equipment });

        console.log(`[裝備系統] 物品 ${itemName} 已成功裝備至 ${equipSlot}。`);
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
        
        // 將裝備移回背包
        const inventoryItemRef = userRef.collection('inventory_items').doc(equippedItemData.instanceId);
        transaction.set(inventoryItemRef, equippedItemData);
        
        // 如果是雙手武器，它只存在於 weapon_right，只需清空該槽位
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
