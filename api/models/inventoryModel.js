// api/models/inventoryModel.js
const admin = require('firebase-admin');
const db = admin.firestore();

// ... (BULK_MAP and other functions can remain the same)

/**
 * 裝備一件物品
 * @param {string} userId - 玩家ID
 * @param {string} itemId - 要裝備的物品的唯一ID (instanceId)
 * @returns {Promise<object>} 返回操作結果
 */
async function equipItem(userId, itemId) {
    const userRef = db.collection('users').doc(userId);
    const itemInstanceRef = userRef.collection('inventory_items').doc(itemId);

    return db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        const itemInstanceDoc = await transaction.get(itemInstanceRef);

        if (!userDoc.exists) throw new Error("找不到玩家資料。");
        if (!itemInstanceDoc.exists) throw new Error("在你的背包中找不到要裝備的物品。");

        const userData = userDoc.data();
        const itemInstanceData = itemInstanceDoc.data();
        const templateId = itemInstanceData.templateId;

        // 【核心修正】從 /items 集合獲取物品的模板(設計圖)
        const itemTemplateRef = db.collection('items').doc(templateId);
        const itemTemplateDoc = await transaction.get(itemTemplateRef);

        if (!itemTemplateDoc.exists) throw new Error(`找不到物品「${templateId}」的設計圖。`);
        
        const itemTemplateData = itemTemplateDoc.data();
        const { equipSlot, hands, itemName } = itemTemplateData;

        if (!equipSlot) {
            throw new Error(`「${itemName}」不是可裝備的物品。`);
        }

        let equipment = userData.equipment || {};

        // 卸下目標槽位的物品
        const currentEquippedItem = equipment[equipSlot];
        if (currentEquippedItem) {
            // 注意：這裡我們只是清空槽位，物品實例還在玩家身上
            console.log(`[裝備系統] 槽位 ${equipSlot} 的物品 ${currentEquippedItem.itemName} 已被卸下。`);
        }

        // 處理雙手武器的特殊邏輯
        if (hands === 2) {
            equipment.weapon_right = null;
            equipment.weapon_left = null;
            equipment.weapon_back = null; // 雙手武器也會卸下背後武器
            equipment['weapon_right'] = { ...itemTemplateData, ...itemInstanceData };
        } else {
            equipment[equipSlot] = { ...itemTemplateData, ...itemInstanceData };
        }
        
        // 更新玩家的裝備狀態
        transaction.update(userRef, { equipment });
        
        // 從背包(inventory)中移除該物品實例
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

        if (!equippedItemData) {
            return { success: true, message: '該部位沒有裝備。' };
        }
        
        // 將物品實例移回背包
        const inventoryItemRef = userRef.collection('inventory_items').doc(equippedItemData.instanceId);
        transaction.set(inventoryItemRef, equippedItemData);

        // 清空裝備槽
        if (equippedItemData.hands === 2) {
            equipment['weapon_right'] = null;
        } else {
            equipment[slotToUnequip] = null;
        }
        
        transaction.update(userRef, { equipment });
        
        console.log(`[裝備系統] 物品 ${equippedItemData.itemName} 已從 ${slotToUnequip} 卸下，並移回背包。`);
        return { success: true, message: `${equippedItemData.itemName} 已卸下。` };
    });
}

// 其餘 addItem, removeItem, calculateAndUpdateBulkScore 函式保持不變
// ...

module.exports = {
    // ... 其他導出的函式
    equipItem,
    unequipItem,
};
