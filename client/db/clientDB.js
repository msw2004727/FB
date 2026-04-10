// client/db/clientDB.js
// 核心 IndexedDB 資料層 — 精簡版（僅保留使用中的 Store）

import { DB_NAME, DB_VERSION, applySchema } from './schema.js';

let _db = null;

function generateId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── 初始化 ──────────────────────────────────────────

export async function init() {
    if (_db) return _db;
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            applySchema(event.target.result);
        };
        request.onsuccess = (event) => {
            _db = event.target.result;
            resolve(_db);
        };
        request.onerror = (event) => {
            reject(new Error(`IndexedDB 開啟失敗: ${event.target.error}`));
        };
    });
}

function getDB() {
    if (!_db) throw new Error('clientDB 尚未初始化，請先呼叫 init()');
    return _db;
}

// ── 通用低階操作 ─────────────────────────────────────

function tx(storeNames, mode = 'readonly') {
    const db = getDB();
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    return db.transaction(names, mode);
}

function promisify(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getOne(storeName, key) {
    const t = tx(storeName);
    return promisify(t.objectStore(storeName).get(key));
}

async function putOne(storeName, data) {
    const t = tx(storeName, 'readwrite');
    return promisify(t.objectStore(storeName).put(data));
}

async function deleteOne(storeName, key) {
    const t = tx(storeName, 'readwrite');
    return promisify(t.objectStore(storeName).delete(key));
}

async function getAllByIndex(storeName, indexName, value) {
    const t = tx(storeName);
    const index = t.objectStore(storeName).index(indexName);
    return promisify(index.getAll(value));
}

// ── 玩家檔案 (profiles) ─────────────────────────────

export const profiles = {
    async create(data) {
        const id = data.id || generateId();
        const profile = {
            id,
            username: data.username || '無名俠客',
            gender: data.gender || '男',
            morality: 0,
            isDeceased: false,
            timeOfDay: '上午',
            yearName: '元祐', year: 1, month: 1, day: 1,
            createdAt: new Date().toISOString(),
            ...data,
            id
        };
        await putOne('profiles', profile);
        return profile;
    },
    async get(profileId) {
        return getOne('profiles', profileId);
    },
    async update(profileId, changes) {
        const existing = await getOne('profiles', profileId);
        if (!existing) throw new Error(`找不到檔案: ${profileId}`);
        const updated = { ...existing, ...changes, id: profileId };
        await putOne('profiles', updated);
        return updated;
    },
    async list() {
        const t = tx('profiles');
        return promisify(t.objectStore('profiles').getAll());
    },
    async delete(profileId) {
        await deleteOne('profiles', profileId);
    }
};

// ── 遊戲存檔 (game_saves) ───────────────────────────

export const saves = {
    async add(profileId, roundData) {
        const record = { ...roundData, profileId };
        await putOne('game_saves', record);
        return record;
    },
    async getLatest(profileId) {
        const all = await getAllByIndex('game_saves', 'by_profile', profileId);
        if (!all.length) return null;
        all.sort((a, b) => (b.R || 0) - (a.R || 0));
        return all[0];
    },
    async getRecent(profileId, count = 3) {
        const all = await getAllByIndex('game_saves', 'by_profile', profileId);
        all.sort((a, b) => (b.R || 0) - (a.R || 0));
        return all.slice(0, count).reverse();
    },
    async getAll(profileId) {
        const all = await getAllByIndex('game_saves', 'by_profile', profileId);
        all.sort((a, b) => (a.R || 0) - (b.R || 0));
        return all;
    },
    async deleteAll(profileId) {
        const all = await getAllByIndex('game_saves', 'by_profile', profileId);
        const t = tx('game_saves', 'readwrite');
        const store = t.objectStore('game_saves');
        for (const record of all) store.delete([record.profileId, record.R]);
        return new Promise((resolve, reject) => {
            t.oncomplete = () => resolve();
            t.onerror = () => reject(t.error);
        });
    }
};

// ── 地點 (locations + location_states) ──────────────

export const locations = {
    async getTemplate(locationName) {
        return getOne('locations', locationName);
    },
    async setTemplate(locationName, data) {
        await putOne('locations', { ...data, locationName });
    },
    async listTemplates() {
        const t = tx('locations');
        return promisify(t.objectStore('locations').getAll());
    },
    async getState(profileId, locationName) {
        return getOne('location_states', [profileId, locationName]);
    },
    async setState(profileId, locationName, data) {
        await putOne('location_states', { ...data, profileId, locationName });
    },
    async listStates(profileId) {
        return getAllByIndex('location_states', 'by_profile', profileId);
    },
    async deleteAllStates(profileId) {
        const all = await this.listStates(profileId);
        const t = tx('location_states', 'readwrite');
        const store = t.objectStore('location_states');
        for (const l of all) store.delete([l.profileId, l.locationName]);
        return new Promise((resolve, reject) => {
            t.oncomplete = () => resolve();
            t.onerror = () => reject(t.error);
        });
    }
};

// ── 小說章節 (novel_chapters) ───────────────────────

export const novel = {
    async addChapter(profileId, round, story) {
        await putOne('novel_chapters', { profileId, round, story, timestamp: new Date().toISOString() });
    },
    async getAll(profileId) {
        const all = await getAllByIndex('novel_chapters', 'by_profile', profileId);
        all.sort((a, b) => (a.round || 0) - (b.round || 0));
        return all;
    },
    async deleteAll(profileId) {
        const all = await this.getAll(profileId);
        const t = tx('novel_chapters', 'readwrite');
        const store = t.objectStore('novel_chapters');
        for (const ch of all) store.delete([ch.profileId, ch.round]);
        return new Promise((resolve, reject) => {
            t.oncomplete = () => resolve();
            t.onerror = () => reject(t.error);
        });
    }
};

// ── 遊戲狀態 (game_state) ──────────────────────────

export const state = {
    async get(profileId, key) {
        const record = await getOne('game_state', [profileId, key]);
        return record ? record.data : null;
    },
    async set(profileId, key, data) {
        await putOne('game_state', { profileId, key, data });
    },
    async delete(profileId, key) {
        await deleteOne('game_state', [profileId, key]);
    },
    async deleteAll(profileId) {
        const all = await getAllByIndex('game_state', 'by_profile', profileId);
        const t = tx('game_state', 'readwrite');
        const store = t.objectStore('game_state');
        for (const s of all) store.delete([s.profileId, s.key]);
        return new Promise((resolve, reject) => {
            t.oncomplete = () => resolve();
            t.onerror = () => reject(t.error);
        });
    }
};

// ── 匯出/匯入 ──────────────────────────────────────

export async function exportAll(profileId) {
    const [profile, gameSaves, locStates, chapters] = await Promise.all([
        profiles.get(profileId),
        saves.getAll(profileId),
        locations.listStates(profileId),
        novel.getAll(profileId),
    ]);

    const locationNames = new Set(locStates.map(l => l.locationName));
    const locationTemplateList = [];
    for (const name of locationNames) {
        const tpl = await locations.getTemplate(name);
        if (tpl) locationTemplateList.push(tpl);
    }

    const stateKeys = ['summary'];
    const stateData = {};
    for (const key of stateKeys) {
        const val = await state.get(profileId, key);
        if (val !== null) stateData[key] = val;
    }

    return {
        exportVersion: 2,
        exportDate: new Date().toISOString(),
        profile,
        gameSaves,
        locationStates: locStates,
        locationTemplates: locationTemplateList,
        novelChapters: chapters,
        gameState: stateData
    };
}

export async function importAll(jsonData) {
    if (!jsonData || (jsonData.exportVersion !== 1 && jsonData.exportVersion !== 2)) {
        throw new Error('存檔格式不正確或版本不相容。');
    }

    const profileId = jsonData.profile.id;
    await putOne('profiles', jsonData.profile);

    for (const tpl of (jsonData.locationTemplates || [])) {
        await locations.setTemplate(tpl.locationName, tpl);
    }
    for (const save of (jsonData.gameSaves || [])) {
        await putOne('game_saves', { ...save, profileId });
    }
    for (const loc of (jsonData.locationStates || [])) {
        await putOne('location_states', { ...loc, profileId });
    }
    for (const ch of (jsonData.novelChapters || [])) {
        await putOne('novel_chapters', { ...ch, profileId });
    }
    for (const [key, data] of Object.entries(jsonData.gameState || {})) {
        await state.set(profileId, key, data);
    }

    return profileId;
}

// ── 完整重置 ────────────────────────────────────────

export async function resetProfile(profileId) {
    await Promise.all([
        saves.deleteAll(profileId),
        locations.deleteAllStates(profileId),
        novel.deleteAll(profileId),
        state.deleteAll(profileId)
    ]);
    const existing = await profiles.get(profileId);
    if (existing) {
        await profiles.update(profileId, {
            morality: 0,
            isDeceased: false
        });
    }
}

// ── 預設匯出 ────────────────────────────────────────

const clientDB = {
    init,
    profiles,
    saves,
    locations,
    novel,
    state,
    exportAll,
    importAll,
    resetProfile
};

export default clientDB;
