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
    const inventorySnapshot = await transaction.get(userRef.collection('inventory'));
    let totalBulk = 0;
    inventorySnapshot.forEach(doc => {
        const itemData = doc.data();
        // 只有在物品欄中的物品才計算負重
        if (itemData.bulk && BULK_MAP[itemData.bulk]) {
            totalBulk += BULK_MAP[itemData.bulk];
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
    const newItemRef = userRef.collection('inventory').doc(); // 自動生成ID

    await db.runTransaction(async (transaction) => {
        transaction.set(newItemRef, { ...itemData, uid: newItemRef.id });
        await calculateAndUpdateBulkScore(transaction, userRef);
    });

    return { success: true, itemId: newItemRef.id };
}

/**
 * 從玩家物品欄移除一件物品
 * @param {string} userId - 玩家ID
 * @param {string} itemId - 要移除的物品的唯一ID (uid)
 * @returns {Promise<object>} 返回操作結果
 */
async function removeItem(userId, itemId) {
    const userRef = db.collection('users').doc(userId);
    const itemRef = userRef.collection('inventory').doc(itemId);

    await db.runTransaction(async (transaction) => {
        transaction.delete(itemRef);
        await calculateAndUpdateBulkScore(transaction, userRef);
    });

    return { success: true, message: '物品已移除。' };
}

/**
 * 裝備一件物品
 * @param {string} userId - 玩家ID
 * @param {string} itemId - 要裝備的物品的唯一ID (uid)
 * @returns {Promise<object>} 返回操作結果
 */
async function equipItem(userId, itemId) {
    const userRef = db.collection('users').doc(userId);
    const itemRef = userRef.collection('inventory').doc(itemId);

    return db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        const itemDoc = await transaction.get(itemRef);

        if (!userDoc.exists) throw new Error("找不到玩家資料。");
        if (!itemDoc.exists) throw new Error("找不到要裝備的物品。");

        const userData = userDoc.data();
        const itemData = itemDoc.data();
        const { equipSlot, hands } = itemData;

        if (!equipSlot) throw new Error("此物品無法裝備。");

        let equipment = userData.equipment || {};
        const currentlyEquippedId = equipment[equipSlot];
        
        // 1. 處理被替換下來的舊裝備
        if (currentlyEquippedId) {
            const oldItemRef = userRef.collection('equipment').doc(currentlyEquippedId);
            const oldItemDoc = await transaction.get(oldItemRef);
            if (oldItemDoc.exists) {
                // 將舊裝備移回物品欄
                const oldItemData = oldItemDoc.data();
                transaction.set(userRef.collection('inventory').doc(oldItemData.uid), oldItemData);
                transaction.delete(oldItemRef);
                console.log(`[裝備系統] 物品 ${oldItemData.itemName} 已從裝備欄移回物品欄。`);
            }
        }

        // 2. 處理雙手武器的特殊邏輯
        if (hands === 2) {
            // 如果裝備雙手武器，需要清空雙手槽位
            const rightHandSlot = 'weapon_right';
            const leftHandSlot = 'weapon_left';
            
            const otherSlot = (equipSlot === rightHandSlot) ? leftHandSlot : rightHandSlot;
            const otherHandItemId = equipment[otherSlot];

            if (otherHandItemId) {
                 const otherHandItemRef = userRef.collection('equipment').doc(otherHandItemId);
                 const otherHandItemDoc = await transaction.get(otherHandItemRef);
                 if(otherHandItemDoc.exists){
                    const otherHandItemData = otherHandItemDoc.data();
                    transaction.set(userRef.collection('inventory').doc(otherHandItemData.uid), otherHandItemData);
                    transaction.delete(otherHandItemRef);
                    equipment[otherSlot] = null;
                    console.log(`[裝備系統] 因裝備雙手武器，另一隻手的武器 ${otherHandItemData.itemName} 已被卸下。`);
                 }
            }
            // 雙手武器同時佔用兩個槽位
            equipment[rightHandSlot] = itemData.uid;
            equipment[leftHandSlot] = itemData.uid;

        } else {
            // 單手武器或普通裝備
            equipment[equipSlot] = itemData.uid;
        }

        // 3. 將新裝備從物品欄移至裝備欄
        const newEquippedItemRef = userRef.collection('equipment').doc(itemData.uid);
        transaction.set(newEquippedItemRef, itemData);
        transaction.delete(itemRef); // 從 inventory 中刪除

        // 4. 更新玩家的裝備狀態 (注意：裝備/卸下不影響總負重)
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
        const equippedItemId = equipment[slotToUnequip];

        if (!equippedItemId) throw new Error("該部位沒有裝備任何物品。");

        const equippedItemRef = userRef.collection('equipment').doc(equippedItemId);
        const equippedItemDoc = await transaction.get(equippedItemRef);

        if (!equippedItemDoc.exists) {
            // 如果裝備庫找不到物品，可能是一個數據錯誤，直接清空該槽位
            console.error(`[裝備系統] 錯誤：在裝備庫中找不到ID為 ${equippedItemId} 的物品，將直接清空槽位 ${slotToUnequip}。`);
            equipment[slotToUnequip] = null;
            transaction.update(userRef, { equipment });
            return { success: false, message: '數據異常，已修正裝備槽。' };
        }
        
        const itemData = equippedItemDoc.data();

        // 1. 將裝備從裝備欄移回物品欄
        const newInventoryItemRef = userRef.collection('inventory').doc(itemData.uid);
        transaction.set(newInventoryItemRef, itemData);
        transaction.delete(equippedItemRef);

        // 2. 更新玩家的裝備狀態
        // 如果是雙手武器，需要同時清空兩個槽位
        if(itemData.hands === 2){
            equipment['weapon_right'] = null;
            equipment['weapon_left'] = null;
        } else {
            equipment[slotToUnequip] = null;
        }
        
        transaction.update(userRef, { equipment });
        
        console.log(`[裝備系統] 物品 ${itemData.itemName} 已從 ${slotToUnequip} 卸下，並移回物品欄。`);
        return { success: true, message: `${itemData.itemName} 已卸下。` };
    });
}


module.exports = {
    addItem,
    removeItem,
    equipItem,
    unequipItem,
    calculateAndUpdateBulkScore
};
