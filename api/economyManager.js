// api/economyManager.js
const admin = require('firebase-admin');
const db = admin.firestore();

const SILVER_ITEM_ID = '銀兩';

/**
 * 獲取玩家當前的銀兩數量
 * @param {string} userId - 玩家ID
 * @param {admin.Transaction} [transaction] - 可選的 Firestore 事務對象
 * @returns {Promise<number>} - 返回玩家的銀兩數量
 */
async function getPlayerCurrency(userId, transaction) {
    const silverRef = db.collection('users').doc(userId).collection('inventory_items').doc(SILVER_ITEM_ID);
    try {
        const doc = transaction ? await transaction.get(silverRef) : await silverRef.get();
        if (!doc.exists) {
            return 0;
        }
        return doc.data().quantity || 0;
    } catch (error) {
        console.error(`[經濟系統] 獲取玩家 ${userId} 的貨幣時出錯:`, error);
        return 0;
    }
}

/**
 * 為玩家增加銀兩
 * @param {string} userId - 玩家ID
 * @param {number} amount - 要增加的數量
 * @param {admin.Transaction | admin.WriteBatch} tx - Firestore 事務或批次寫入對象
 */
async function addCurrency(userId, amount, tx) {
    if (amount <= 0) return;
    const silverRef = db.collection('users').doc(userId).collection('inventory_items').doc(SILVER_ITEM_ID);
    
    // 使用 set 配合 merge:true，確保即使文件不存在也能創建
    tx.set(silverRef, {
        templateId: SILVER_ITEM_ID,
        itemType: '財寶', // 根據你的物品設計
        quantity: admin.firestore.FieldValue.increment(amount)
    }, { merge: true });
    console.log(`[經濟系統] 已為玩家 ${userId} 加入 ${amount} 兩銀子到佇列。`);
}

/**
 * 為玩家花費銀兩
 * @param {string} userId - 玩家ID
 * @param {number} amount - 要花費的數量
 * @param {admin.Transaction | admin.WriteBatch} tx - Firestore 事務或批次寫入對象
 * @returns {Promise<void>}
 * @throws {Error} 如果餘額不足
 */
async function spendCurrency(userId, amount, tx) {
    if (amount <= 0) return;
    const silverRef = db.collection('users').doc(userId).collection('inventory_items').doc(SILVER_ITEM_ID);

    // 在事務中，我們需要先讀取再寫入
    if (tx instanceof admin.firestore.Transaction) {
        const silverDoc = await tx.get(silverRef);
        const currentAmount = silverDoc.exists ? silverDoc.data().quantity : 0;
        if (currentAmount < amount) {
            throw new Error('銀兩不足，無法完成此操作。');
        }
        tx.update(silverRef, { quantity: admin.firestore.FieldValue.increment(-amount) });
    } else { // 在批次寫入中，我們直接執行扣除
        tx.update(silverRef, { quantity: admin.firestore.FieldValue.increment(-amount) });
    }
    console.log(`[經濟系統] 已為玩家 ${userId} 扣除 ${amount} 兩銀子到佇列。`);
}

module.exports = {
    getPlayerCurrency,
    addCurrency,
    spendCurrency
};
