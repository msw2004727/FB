// api/cacheManager.js
const admin = require('firebase-admin');
const db = admin.firestore();

// 快取物件保持不變
const cache = {
    npcTemplates: new Map(),
    itemTemplates: new Map()
};

/**
 * 【核心修改】getKnownNpcTemplate 現在是一個異步函式 (async function)
 * 它會先檢查記憶體快取，如果找不到，才會去資料庫查詢。
 * @param {string} npcName - NPC的名稱
 * @returns {Promise<object|null>} NPC的模板資料或null
 */
async function getKnownNpcTemplate(npcName) {
    if (cache.npcTemplates.has(npcName)) {
        return cache.npcTemplates.get(npcName);
    }
    // 快取中沒有，從 Firestore 讀取
    try {
        const doc = await db.collection('npcs').doc(npcName).get();
        if (doc.exists) {
            const data = doc.data();
            cache.npcTemplates.set(npcName, data); // 存入快取供下次使用
            console.log(`[Cache Manager] 從資料庫讀取並快取了 NPC 模板: ${npcName}`);
            return data;
        }
    } catch (error) {
        console.error(`[Cache Manager] 讀取 NPC 模板 "${npcName}" 時發生錯誤:`, error);
    }
    return null;
}

/**
 * 【核心修改】getKnownItemTemplate 也修改為異步函式
 * @param {string} itemName - 物品的名稱
 * @returns {Promise<object|null>} 物品的模板資料或null
 */
async function getKnownItemTemplate(itemName) {
    if (cache.itemTemplates.has(itemName)) {
        return cache.itemTemplates.get(itemName);
    }
    // 快取中沒有，從 Firestore 讀取
    try {
        const doc = await db.collection('items').doc(itemName).get();
        if (doc.exists) {
            const data = doc.data();
            cache.itemTemplates.set(itemName, data); // 存入快取供下次使用
            console.log(`[Cache Manager] 從資料庫讀取並快取了物品模板: ${itemName}`);
            return data;
        }
    } catch (error) {
        console.error(`[Cache Manager] 讀取物品模板 "${itemName}" 時發生錯誤:`, error);
    }
    return null;
}

// 此函式保持不變，用於當AI動態生成新東西時，手動更新快取
function setTemplateInCache(type, key, data) {
    if (type === 'npc') {
        cache.npcTemplates.set(key, data);
    } else if (type === 'item') {
        cache.itemTemplates.set(key, data);
    }
}

// 原始的初始化函式，雖然不再於啟動時呼叫，但保留結構以備不時之需
async function initializeCaches() {
    console.log('[快取系統 v2.0] 開始初始化所有伺服器快取...');
    try {
        await Promise.all([
            (async () => {
                const snapshot = await db.collection('npcs').get();
                snapshot.forEach(doc => {
                    if (doc.data().name) {
                        cache.npcTemplates.set(doc.data().name, doc.data());
                    }
                });
                console.log(`[快取系統] NPC模板快取完畢，共載入 ${cache.npcTemplates.size} 位NPC。`);
            })(),
            (async () => {
                const snapshot = await db.collection('items').get();
                snapshot.forEach(doc => {
                    if (doc.data().itemName) {
                        cache.itemTemplates.set(doc.data().itemName, doc.data());
                    }
                });
                console.log(`[快取系統] 物品模板快取完畢，共載入 ${cache.itemTemplates.size} 件物品。`);
            })()
        ]);
        console.log('[快取系統 v2.0] 所有快取初始化完畢！');
    } catch (error) {
        console.error('[快取系統] 初始化快取時發生嚴重錯誤:', error);
    }
}


module.exports = {
    getKnownNpcTemplate,
    getKnownItemTemplate,
    setTemplateInCache,
    getKnownNpcNames: () => new Set(cache.npcTemplates.keys()),
};
