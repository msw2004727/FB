// client/db/schema.js
// IndexedDB Schema Definition — 定義所有 Object Store 與索引

export const DB_NAME = 'WenJiang_Game';
export const DB_VERSION = 1;

/**
 * 定義所有 Store 與索引。
 * keyPath 為主鍵，indexes 為次索引。
 * 複合鍵用陣列表示，如 ['profileId', 'round']。
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
    inventory: {
        keyPath: ['profileId', 'instanceId'],
        indexes: [
            { name: 'by_profile', keyPath: 'profileId' }
        ]
    },
    skills: {
        keyPath: ['profileId', 'skillName'],
        indexes: [
            { name: 'by_profile', keyPath: 'profileId' }
        ]
    },
    npc_states: {
        keyPath: ['profileId', 'npcName'],
        indexes: [
            { name: 'by_profile', keyPath: 'profileId' }
        ]
    },
    npc_templates: {
        keyPath: 'name',
        indexes: []
    },
    item_templates: {
        keyPath: 'itemName',
        indexes: []
    },
    skill_templates: {
        keyPath: 'skillName',
        indexes: []
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
    bounties: {
        keyPath: ['profileId', 'bountyId'],
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
