// api/models/inventoryModel.js
const admin = require('firebase-admin');
const db = admin.firestore();

const BULK_MAP = {
    "輕": 1,
    "中": 2,
    "重": 5,
    "極重": 10,
};

/**
 * 計算並更新玩家的總負重分數
 * @param {FirebaseFirestore.Transaction} transaction - Firestore 事務對象
 * @param {FirebaseFirestore.DocumentReference} userRef - 玩家的文檔引用
 */
async function calculateAndUpdateBulkScore(transaction, userRef) {
    const inventorySnapshot = await transaction.get(userRef.collection('inventory_items'));
    let totalBulk = 0;
    
    // 將已裝備物品也納入計算
    const userDoc = await transaction.get(userRef);
    const equipment = userDoc.data().equipment || {};
    const equippedItemsData = await Promise.all(
        Object.values(equipment)
        .filter(item => item && item.instanceId)
        .map(item => transaction.get(db.collection('items').doc(item.templateId)))
    );

    equippedItemsData.forEach(doc => {
        if(doc.exists){
            const itemData = doc.data();
             if (itemData.bulk && BULK_MAP[itemData.bulk]) {
                totalBulk += BULK_MAP[itemData.bulk];
            }
        }
    });

    inventorySnapshot.forEach(doc => {
        const itemData = doc.data();
        if (itemData.bulk && BULK_MAP[itemData.bulk]) {
            totalBulk += BULK_MAP[itemData.bulk] * (itemData.quantity || 1);
        }
    });

    console.log(`[負重計算] 玩家 ${userRef.id} 的最新總負重為: ${totalBulk}`);
    transaction.update(userRef, { bulkScore: totalBulk });
    return totalBulk;
}

/**
 * 為玩家添加一件物品
 * @param {string} userId - 玩家ID
 * @param {object} itemData - 要添加的物品數據
 * @returns {Promise<object>} 返回包含更新後負重分數的結果
 */
async function addItem(userId, itemData) {
    const userRef = db.collection('users').doc(userId);
    const newItemRef = userRef.collection('inventory_items').doc(); 

    await db.runTransaction(async (transaction) => {
        transaction.set(newItemRef, { ...itemData, instanceId: newItemRef.id });
        await calculateAndUpdateBulkScore(transaction, userRef);
    });

    return { success: true, itemId: newItemRef.id };
}

/**
 * 從玩家物品欄移除一件物品
 * @param {string} userId - 玩家ID
 * @param {string} itemId - 要移除的物品的唯一ID (instanceId)
 * @returns {Promise<object>} 返回操作結果
 */
async function removeItem(userId, itemId) {
    const userRef = db.collection('users').doc(userId);
    const itemRef = userRef.collection('inventory_items').doc(itemId);

    await db.runTransaction(async (transaction) => {
        transaction.delete(itemRef);
        await calculateAndUpdateBulkScore(transaction, userRef);
    });

    return { success: true, message: '物品已移除。' };
}

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
        
        // 【核心修正】在事務中同時嘗試從兩個地方獲取物品
        const itemFromInventoryRef = userRef.collection('inventory_items').doc(itemId);
        let itemDoc = await transaction.get(itemFromInventoryRef);
        let isFromInventory = true;

        if (!itemDoc.exists) {
            throw new Error("找不到要裝備的物品。");
        }

        const userData = userDoc.data();
        const itemData = itemDoc.data();
        const { equipSlot, hands } = itemData;

        if (!equipSlot) throw new Error("此物品無法裝備。");

        let equipment = userData.equipment || {};
        
        // 卸下目標槽位的物品
        const currentEquippedId = equipment[equipSlot];
        if (currentEquippedId) {
            const oldItemRef = userRef.collection('inventory_items').doc(currentEquippedId);
            // 由於我們只是移動物品，這裡直接更新equipment對象即可
            // 不需要真的從一個集合移動到另一個
             console.log(`[裝備系統] 槽位 ${equipSlot} 的物品 ${currentEquippedId} 已被卸下。`);
        }

        // 處理雙手武器的特殊邏輯
        if (hands === 2) {
            const slotsToClear = ['weapon_right', 'weapon_left', 'weapon_back'];
            for (const slot of slotsToClear) {
                if (equipment[slot]) {
                     console.log(`[裝備系統] 因裝備雙手武器，槽位 ${slot} 的物品已被卸下。`);
                    equipment[slot] = null;
                }
            }
             equipment['weapon_right'] = itemData; // 雙手武器佔用右手槽
        } else {
             equipment[equipSlot] = itemData;
        }

        // 更新玩家的裝備狀態
        transaction.update(userRef, { equipment });

        console.log(`[裝備系統] 物品 ${itemData.itemName} 已成功裝備至 ${equipSlot}。`);
        return { success: true, message: `${itemData.itemName} 已裝備。` };
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
        const equippedItem = equipment[slotToUnequip];

        if (!equippedItem) {
            console.log(`[裝備系統] 槽位 ${slotToUnequip} 並沒有裝備任何物品。`);
            return { success: true, message: '該部位沒有裝備。' };
        }
        
        // 如果是雙手武器，需要同時清空兩個槽位
        if(equippedItem.hands === 2){
            equipment['weapon_right'] = null;
            equipment['weapon_left'] = null;
        } else {
            equipment[slotToUnequip] = null;
        }
        
        transaction.update(userRef, { equipment });
        
        console.log(`[裝備系統] 物品 ${equippedItem.itemName} 已從 ${slotToUnequip} 卸下。`);
        return { success: true, message: `${equippedItem.itemName} 已卸下。` };
    });
}


module.exports = {
    addItem,
    removeItem,
    equipItem,
    unequipItem,
    calculateAndUpdateBulkScore
};
