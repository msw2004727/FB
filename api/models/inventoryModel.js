// api/models/inventoryModel.js
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 裝備一件物品 (狀態切換模型)
 * @param {string} userId - 玩家ID
 * @param {string} itemId - 要裝備的物品的唯一ID (instanceId)
 * @returns {Promise<object>} 返回操作結果
 */
async function equipItem(userId, itemId) {
    const userRef = db.collection('users').doc(userId);
    
    return db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists) throw new Error("找不到玩家資料。");

        // 驗證物品確實存在於玩家的背包中
        const itemInstanceRef = userRef.collection('inventory_items').doc(itemId);
        const itemInstanceDoc = await transaction.get(itemInstanceRef);
        if (!itemInstanceDoc.exists) {
            throw new Error(`在你的背包中找不到ID為 ${itemId} 的物品。`);
        }

        const templateId = itemInstanceDoc.data().templateId;
        if (!templateId) throw new Error(`物品 ${itemId} 數據不完整，缺少templateId。`);
        
        const itemTemplateRef = db.collection('items').doc(templateId);
        const itemTemplateDoc = await transaction.get(itemTemplateRef);
        if (!itemTemplateDoc.exists) throw new Error(`找不到物品「${templateId}」的設計圖。`);
        
        const itemTemplateData = itemTemplateDoc.data();
        const { equipSlot, hands, itemName } = itemTemplateData;

        if (!equipSlot) {
            throw new Error(`「${itemName}」不是可裝備的物品。`);
        }

        let equipment = userDoc.data().equipment || {};
        
        const itemToEquip = { 
            instanceId: itemId, 
            templateId: templateId,
            itemName: itemName || templateId,
            hands: hands || 1
        };

        // --- 核心卸下邏輯 (只操作equipment對象) ---
        if (hands === 2) { 
            const slotsToClear = ['weapon_right', 'weapon_left', 'weapon_back'];
            slotsToClear.forEach(slot => { equipment[slot] = null; });
            equipment.weapon_right = itemToEquip; 
        } else { 
            // 如果要裝備單手武器，且當前右手是雙手武器，則清空右手
            if(equipSlot.startsWith('weapon') && equipment.weapon_right?.hands === 2){
                equipment.weapon_right = null;
            }
            equipment[equipSlot] = itemToEquip;
        }

        // --- 只更新玩家主文檔的equipment欄位 ---
        transaction.update(userRef, { equipment });

        console.log(`[裝備系統] 玩家 ${userId} 的裝備狀態已更新。${itemName} 已裝備至 ${equipSlot}。`);
        return { success: true, message: `${itemName} 已裝備。` };
    });
}


/**
 * 卸下一件裝備 (狀態切換模型)
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
        
        const itemName = equippedItemData.itemName;
        
        // 如果是雙手武器，它只存在於 weapon_right，清空它
        if(equippedItemData.hands === 2){
            equipment['weapon_right'] = null;
        } else {
            equipment[slotToUnequip] = null;
        }
        
        // --- 只更新玩家主文檔的equipment欄位 ---
        transaction.update(userRef, { equipment });
        
        console.log(`[裝備系統] 玩家 ${userId} 的裝備狀態已更新。${itemName} 已從 ${slotToUnequip} 卸下。`);
        return { success: true, message: `${itemName} 已卸下。` };
    });
}


module.exports = {
    equipItem,
    unequipItem
};
