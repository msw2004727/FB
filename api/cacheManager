// api/cacheManager.js
const admin = require('firebase-admin');
// 【移除】不再在這裡初始化db

// 創建一個物件來存放我們的快取數據
const cache = {
    npcNames: new Set(),
};

/**
 * 初始化NPC名稱快取
 * 這個函式會在伺服器啟動時被呼叫一次。
 */
async function initializeNpcNameCache() {
    // 【修改】將db的初始化移到函式內部，確保此時Firebase App已經被初始化
    const db = admin.firestore();
    try {
        console.log('[快取系統] 正在初始化NPC名稱快取...');
        const snapshot = await db.collection('npcs').get();
        const names = new Set();
        snapshot.forEach(doc => {
            // 我們只儲存NPC的名字，因為這是唯一需要比對的資訊
            if (doc.data().name) {
                names.add(doc.data().name);
            }
        });
        cache.npcNames = names;
        console.log(`[快取系統] NPC名稱快取初始化完畢，共載入 ${cache.npcNames.size} 位NPC。`);
    } catch (error) {
        console.error('[快取系統] 初始化NPC名稱快取時發生嚴重錯誤:', error);
        // 即使出錯，也確保 cache.npcNames 是一個可迭代的物件，避免後續程式崩潰
        cache.npcNames = new Set();
    }
}

/**
 * 獲取所有NPC的名稱
 * @returns {Set<string>} 一個包含所有NPC名字的Set物件
 */
function getKnownNpcNames() {
    return cache.npcNames;
}

module.exports = {
    initializeNpcNameCache,
    getKnownNpcNames,
};
