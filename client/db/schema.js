// client/db/schema.js
// IndexedDB Schema Definition — 精簡版（移除已刪除功能的 Store）

export const DB_NAME = 'WenJiang_Game';
export const DB_VERSION = 2; // 升版：移除廢棄 Store

/**
 * 只保留實際使用中的 Store。
 * 已移除：inventory, skills, npc_states, npc_templates,
 *         item_templates, skill_templates, bounties
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
    // 移除舊版廢棄的 Store
    const deprecated = ['inventory', 'skills', 'npc_states', 'npc_templates', 'item_templates', 'skill_templates', 'bounties'];
    for (const name of deprecated) {
        if (db.objectStoreNames.contains(name)) {
            db.deleteObjectStore(name);
        }
    }

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
