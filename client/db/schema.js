// client/db/schema.js
// IndexedDB Schema Definition — 保守升級版

export const DB_NAME = 'WenJiang_Game';
// v2 已包含目前所有 active stores。沒有真正 schema 變更時不可升版：
// 舊 v0.26 分頁不會主動關閉連線，無意義升版會讓新版分頁永久 blocked。
export const DB_VERSION = 2;

/**
 * 目前程式會使用的 Store。舊版本建立的其他 Store 會原樣保留，
 * 避免使用者僅因開啟新版網站便永久失去資料。
 */
export const STORES = {
    profiles: {
        keyPath: 'id',
        autoIncrement: false,
        indexes: [
            { name: 'by_name', keyPath: 'username', unique: true }
        ]
    },
    game_saves: {
        keyPath: ['profileId', 'R'],
        indexes: [
            { name: 'by_profile', keyPath: 'profileId' },
            { name: 'by_profile_round', keyPath: ['profileId', 'R'] }
        ]
    },
    locations: {
        keyPath: 'locationName',
        indexes: []
    },
    location_states: {
        keyPath: ['profileId', 'locationName'],
        indexes: [
            { name: 'by_profile', keyPath: 'profileId' }
        ]
    },
    novel_chapters: {
        keyPath: ['profileId', 'round'],
        indexes: [
            { name: 'by_profile', keyPath: 'profileId' }
        ]
    },
    game_state: {
        keyPath: ['profileId', 'key'],
        indexes: [
            { name: 'by_profile', keyPath: 'profileId' }
        ]
    }
};

/**
 * 在 onupgradeneeded 中呼叫，建立或升級所有 Store。
 */
export function applySchema(db) {
    // 建立新 Store（如果不存在）
    for (const [storeName, config] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(storeName)) continue;

        const storeOpts = {};
        if (config.keyPath) storeOpts.keyPath = config.keyPath;
        if (config.autoIncrement) storeOpts.autoIncrement = true;

        const store = db.createObjectStore(storeName, storeOpts);

        for (const idx of config.indexes || []) {
            store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique });
        }
    }
}
