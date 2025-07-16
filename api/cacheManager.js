// api/cacheManager.js
const admin = require('firebase-admin');

// 【核心修改】將快取擴展為一個物件，可以存放更多類型的資料
const cache = {
    npcTemplates: new Map(), // 使用Map來儲存完整的NPC模板，以NPC姓名為鍵
    itemTemplates: new Map()   // 【新增】為物品模板也建立一個快取
};

/**
 * 初始化所有必要的快取
 * 這個函式會在伺服器啟動時被呼叫一次。
 */
async function initializeCaches() {
    const db = admin.firestore();
    console.log('[快取系統 v2.0] 開始初始化所有伺服器快取...');
    try {
        // 並行處理所有快取的初始化
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

/**
 * 【核心修改】提供獲取單一NPC模板的函式
 * @param {string} npcName - NPC的名稱
 * @returns {object|null} NPC的模板資料或null
 */
function getKnownNpcTemplate(npcName) {
    return cache.npcTemplates.get(npcName) || null;
}

/**
 * 【新增】提供獲取單一物品模板的函式
 * @param {string} itemName - 物品的名稱
 * @returns {object|null} 物品的模板資料或null
 */
function getKnownItemTemplate(itemName) {
    return cache.itemTemplates.get(itemName) || null;
}

/**
 * 【新增】在快取中新增或更新一個模板 (當AI動態生成時使用)
 * @param {'npc'|'item'} type - 模板類型
 * @param {string} key - 模板的鍵 (NPC姓名或物品名稱)
 * @param {object} data - 模板的資料
 */
function setTemplateInCache(type, key, data) {
    if (type === 'npc') {
        cache.npcTemplates.set(key, data);
    } else if (type === 'item') {
        cache.itemTemplates.set(key, data);
    }
}

// 【核心修改】導出新的函式
module.exports = {
    initializeCaches,
    getKnownNpcTemplate,
    getKnownItemTemplate,
    setTemplateInCache,
    // 為了相容舊程式碼，我們保留 getKnownNpcNames
    getKnownNpcNames: () => new Set(cache.npcTemplates.keys()),
};
