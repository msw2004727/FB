// api/itemManager.js
const admin = require('firebase-admin');
const { getOrGenerateItemTemplate } = require('./playerStateHelpers');
const { v4: uuidv4 } = require('uuid');

const db = admin.firestore();

/**
 * 【重構 2.0】從NPC的庫存或裝備中移除物品
 * @param {string} userId - 玩家ID
 * @param {string} npcName - NPC的名稱
 * @param {string} itemName - 要移除的物品名稱
 * @param {number} quantity - 要移除的數量
 * @param {admin.firestore.WriteBatch} batch - Firestore的批次寫入對象
 */
async function removeItemFromNpc(userId, npcName, itemName, quantity, batch) {
    if (!npcName || !itemName || !quantity) return;
    
    console.log(`[物品管理器 v2] 準備從NPC「${npcName}」處轉移 ${quantity} 個「${itemName}」...`);
    const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);
    
    try {
        const npcStateDoc = await npcStateRef.get();
        if (!npcStateDoc.exists) {
            console.warn(`[物品管理器 v2] 找不到NPC「${npcName}」的狀態檔案，無法移除物品。`);
            return;
        }
        const npcStateData = npcStateDoc.data();
        let npcEquipment = npcStateData.equipment || [];
        
        let quantityToRemove = quantity;
        let removedFromEquipment = false;

        // 優先從裝備中移除
        const updatedEquipment = [];
        for (const equip of npcEquipment) {
            if (equip.templateId === itemName && quantityToRemove > 0) {
                quantityToRemove--;
                removedFromEquipment = true;
                // 這個物品被移除了，所以不要加回 updatedEquipment
            } else {
                updatedEquipment.push(equip);
            }
        }

        if (removedFromEquipment) {
            batch.update(npcStateRef, { equipment: updatedEquipment });
            console.log(`[物品管理器 v2] 已將「${itemName}」從NPC「${npcName}」的裝備中移除。`);
        }

        // 如果從裝備中移除後數量還不夠，再從庫存中扣除
        if (quantityToRemove > 0) {
            const inventoryUpdate = {
                [`inventory.${itemName}`]: admin.firestore.FieldValue.increment(-quantityToRemove)
            };
            batch.set(npcStateRef, inventoryUpdate, { merge: true });
            console.log(`[物品管理器 v2] 已將 ${quantityToRemove} 個「${itemName}」從NPC「${npcName}」的庫存中扣除。`);
        }

    } catch (error) {
        console.error(`[物品管理器 v2] 從NPC「${npcName}」移除「${itemName}」時發生錯誤:`, error);
        // 在批次處理中，向上拋出錯誤以中斷整個批次
        throw error;
    }
}

/**
 * 將物品添加到玩家的庫存中
 * @param {string} userId - 玩家ID
 * @param {string} itemName - 要添加的物品名稱
 * @param {number} quantity - 要添加的數量
 * @param {admin.firestore.WriteBatch} batch - Firestore的批次寫入對象
 * @param {object} roundData - 當前回合數據，用於生成新物品模板
 */
async function addItemToPlayer(userId, itemName, quantity, batch, roundData = {}) {
    if (!itemName || !quantity) return;
    
    console.log(`[物品管理器 v2] 準備為玩家 ${userId} 添加 ${quantity} 個「${itemName}」...`);
    const itemTemplateResult = await getOrGenerateItemTemplate(itemName, roundData);
    if (!itemTemplateResult || !itemTemplateResult.template) {
        console.error(`[物品管理器 v2] 無法獲取或生成「${itemName}」的模板，操作中止。`);
        return;
    }
    
    const itemTemplate = itemTemplateResult.template;
    const userInventoryRef = db.collection('users').doc(userId).collection('inventory_items');
    
    // 判斷物品是否可堆疊
    const isStackable = ['材料', '道具', '丹藥', '其他'].includes(itemTemplate.itemType);

    if (isStackable || itemTemplate.itemName === '銀兩') {
        const itemRef = userInventoryRef.doc(itemName);
        batch.set(itemRef, {
            templateId: itemName,
            quantity: admin.firestore.FieldValue.increment(quantity),
            itemType: itemTemplate.itemType,
        }, { merge: true });
    } else {
        // 對於不可堆疊物品，創建多個獨立的實例
        for (let i = 0; i < quantity; i++) {
            const instanceId = uuidv4();
            const itemRef = userInventoryRef.doc(instanceId);
            batch.set(itemRef, {
                templateId: itemName,
                quantity: 1,
                itemType: itemTemplate.itemType,
                instanceId: instanceId,
                isEquipped: false, // 預設為未裝備
                equipSlot: null,  // 預設為空
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
    }
}

/**
 * 處理來自AI的 itemChanges 陣列 (給予玩家物品)
 * @param {string} userId - 玩家ID
 * @param {Array<object>} itemChanges - AI返回的物品變化陣列
 * @param {admin.firestore.WriteBatch} batch - Firestore的批次寫入對象
 * @param {object} roundData - 當前回合數據
 * @param {string|null} sourceNpcName - 物品的來源NPC (可選)
 */
async function processItemChanges(userId, itemChanges, batch, roundData, sourceNpcName = null) {
    if (!itemChanges || !Array.isArray(itemChanges) || itemChanges.length === 0) {
        return;
    }

    console.log(`[物品管理器 v2] 開始處理來自 ${sourceNpcName ? `NPC「${sourceNpcName}」` : '系統'} 的 ${itemChanges.length} 項物品變更...`);

    for (const change of itemChanges) {
        const { action, itemName, quantity = 1 } = change;
        
        if (action === 'add') {
            await addItemToPlayer(userId, itemName, quantity, batch, roundData);
            if (sourceNpcName) {
                // 如果是NPC給予的，要從NPC庫存或裝備中扣除
                await removeItemFromNpc(userId, sourceNpcName, itemName, quantity, batch);
            }
        }
        // 未來可以擴展 'remove' 等其他操作
    }
}

module.exports = {
    processItemChanges,
    addItemToPlayer,
    removeItemFromNpc
};
