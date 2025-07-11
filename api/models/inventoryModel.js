// api/models/inventoryModel.js
const admin = require('firebase-admin');
const db = admin.firestore();

const BULK_MAP = {
    "輕": 0, // 輕的物品不增加負重
    "中": 2,
    "重": 5,
    "極重": 10,
};

/**
 * 計算並更新玩家的總負重分數
 * @param {FirebaseFirestore.Transaction} transaction - Firestore 事務對象
 * @param {FirebaseFirestore.DocumentReference} userRef - 玩家的文檔引用
 * @returns {Promise<number>} 返回計算出的總負重分數
 */
async function calculateAndUpdateBulkScore(transaction, userRef) {
    const inventorySnapshot = await transaction.get(userRef.collection('inventory_items'));
    let totalBulk = 0;
    
    // 將已裝備物品也納入計算
    const userDoc = await transaction.get(userRef);
    const equipment = userDoc.data().equipment || {};
    
    // 遍歷所有裝備槽位
    for (const slot in equipment) {
        const equippedItem = equipment[slot];
        if (equippedItem && equippedItem.templateId) {
            // 注意：雙手武器在equipment物件中只存一份，所以不會重複計算
            const itemTemplateDoc = await transaction.get(db.collection('items').doc(equippedItem.templateId));
            if(itemTemplateDoc.exists){
                const itemTemplateData = itemTemplateDoc.data();
                if (itemTemplateData.bulk && BULK_MAP[itemTemplateData.bulk] !== undefined) {
                    totalBulk += BULK_MAP[itemTemplateData.bulk];
                }
            }
        }
    }
    
    // 遍歷所有背包物品
    const itemTemplatePromises = [];
    inventorySnapshot.forEach(doc => {
        const itemData = doc.data();
        if (itemData.templateId) {
            itemTemplatePromises.push(transaction.get(db.collection('items').doc(itemData.templateId)));
        }
    });

    const itemTemplateDocs = await Promise.all(itemTemplatePromises);

    itemTemplateDocs.forEach((templateDoc, index) => {
        if(templateDoc.exists){
            const templateData = templateDoc.data();
            const quantity = inventorySnapshot.docs[index].data().quantity || 1;
            if (templateData.bulk && BULK_MAP[templateData.bulk] !== undefined) {
                totalBulk += BULK_MAP[templateData.bulk] * quantity;
            }
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
    const newItemRef = userRef.collection('inventory_items').doc(); // 自動生成ID

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
        
        // 將要裝備的物品實例與模板合併
        const itemToEquip = { ...itemTemplateData, ...itemInstanceData };

        // 1. 處理雙手武器的特殊情況，它會卸下所有武器槽位的裝備
        if (hands === 2) {
            const slotsToClear = ['weapon_right', 'weapon_left', 'weapon_back'];
            for (const slot of slotsToClear) {
                const unequippedItem = equipment[slot];
                if (unequippedItem && unequippedItem.instanceId) {
                    const unequippedRef = userRef.collection('inventory_items').doc(unequippedItem.instanceId);
                    transaction.set(unequippedRef, unequippedItem); // 移回背包
                    console.log(`[裝備系統] 因裝備雙手武器，槽位 ${slot} 的物品 ${unequippedItem.itemName} 已被卸下。`);
                }
                equipment[slot] = null;
            }
             equipment['weapon_right'] = itemToEquip; // 雙手武器裝備在右手槽
        } else {
            // 2. 卸下目標槽位的物品
            const currentEquippedItem = equipment[equipSlot];
            if (currentEquippedItem && currentEquippedItem.instanceId) {
                 const oldItemRef = userRef.collection('inventory_items').doc(currentEquippedItem.instanceId);
                 transaction.set(oldItemRef, currentEquippedItem);
                 console.log(`[裝備系統] 槽位 ${equipSlot} 的物品 ${currentEquippedItem.itemName} 已被卸下並移回背包。`);
            }
            // 3. 裝備新物品
             equipment[equipSlot] = itemToEquip;
        }

        // 4. 更新玩家的裝備狀態
        transaction.update(userRef, { equipment });
        
        // 5. 從背包(inventory)中刪除該物品實例
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
        
        // 1. 將裝備從裝備欄移回背包
        const inventoryItemRef = userRef.collection('inventory_items').doc(equippedItemData.instanceId);
        transaction.set(inventoryItemRef, equippedItemData);

        // 2. 更新玩家的裝備狀態
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
    addItem,
    removeItem,
    equipItem,
    unequipItem,
    calculateAndUpdateBulkScore
};
