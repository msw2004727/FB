// client/db/clientDB.js
// 核心 IndexedDB 資料層 — 精簡版（僅保留使用中的 Store）

import { DB_NAME, DB_VERSION, applySchema } from './schema.js';

let _db = null;
let _initPromise = null;
const STORES_FOR_IMPORT = {
    profiles: true,
    game_saves: true,
    locations: true,
    location_states: true,
    novel_chapters: true,
    game_state: true,
};

function generateId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── 初始化 ──────────────────────────────────────────

export async function init() {
    if (_db) return _db;
    if (_initPromise) return _initPromise;

    _initPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            applySchema(event.target.result);
        };
        request.onsuccess = (event) => {
            _db = event.target.result;
            _db.onversionchange = () => {
                _db?.close();
                _db = null;
                _initPromise = null;
            };
            resolve(_db);
        };
        request.onerror = (event) => {
            _initPromise = null;
            reject(new Error(`IndexedDB 開啟失敗: ${event.target.error}`));
        };
        request.onblocked = () => {
            _initPromise = null;
            reject(new Error('資料庫升級被其他分頁阻擋，請關閉其他遊戲分頁後重試。'));
        };
    });
    return _initPromise;
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

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction 已取消'));
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction 失敗'));
    });
}

async function getOne(storeName, key) {
    const t = tx(storeName);
    return promisify(t.objectStore(storeName).get(key));
}

async function putOne(storeName, data) {
    const t = tx(storeName, 'readwrite');
    const done = transactionDone(t);
    try {
        const result = await promisify(t.objectStore(storeName).put(data));
        await done;
        return result;
    } catch (error) {
        await done.catch(() => {});
        throw error;
    }
}

async function addOne(storeName, data) {
    const t = tx(storeName, 'readwrite');
    const done = transactionDone(t);
    try {
        const result = await promisify(t.objectStore(storeName).add(data));
        await done;
        return result;
    } catch (error) {
        await done.catch(() => {});
        throw error;
    }
}

async function deleteOne(storeName, key) {
    const t = tx(storeName, 'readwrite');
    const done = transactionDone(t);
    try {
        const result = await promisify(t.objectStore(storeName).delete(key));
        await done;
        return result;
    } catch (error) {
        await done.catch(() => {});
        throw error;
    }
}

async function getAllByIndex(storeName, indexName, value) {
    const t = tx(storeName);
    const index = t.objectStore(storeName).index(indexName);
    return promisify(index.getAll(value));
}

function getLatestSaveFromStore(store, profileId) {
    // All records in by_profile share the same index key. An index cursor opened
    // in reverse order therefore uses the compound primary key [profileId, R]
    // as the tie-breaker and returns the greatest round first.
    const request = store.index('by_profile').openCursor(IDBKeyRange.only(profileId), 'prev');
    return promisify(request).then(cursor => cursor?.value || null);
}

// ── 玩家檔案 (profiles) ─────────────────────────────

export const profiles = {
    async create(data) {
        const id = data.id || generateId();
        const profile = {
            id,
            username: data.username || '冒險者',
            gender: data.gender || 'male',
            scenario: data.scenario || 'wuxia',
            morality: 0,
            isDeceased: false,
            timeOfDay: '',
            yearName: '', year: 0, month: 1, day: 1,
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
        const transaction = tx('profiles', 'readwrite');
        const done = transactionDone(transaction);
        try {
            const store = transaction.objectStore('profiles');
            const existing = await promisify(store.get(profileId));
            if (!existing) throw new Error(`找不到檔案: ${profileId}`);
            const updated = { ...existing, ...changes, id: profileId };
            await promisify(store.put(updated));
            await done;
            return updated;
        } catch (error) {
            try { transaction.abort(); } catch { /* transaction may already be closed */ }
            await done.catch(() => {});
            throw error;
        }
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
        // 同一玩家同一回合只能建立一次，避免多分頁或重試靜默覆寫存檔。
        await addOne('game_saves', record);
        return record;
    },
    async getLatest(profileId) {
        const transaction = tx('game_saves');
        const done = transactionDone(transaction);
        try {
            const latest = await getLatestSaveFromStore(transaction.objectStore('game_saves'), profileId);
            await done;
            return latest;
        } catch (error) {
            await done.catch(() => {});
            throw error;
        }
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

/**
 * 以同一個 readonly transaction 取得角色與其最新回合，避免跨分頁提交時
 * 組合出「舊 profile + 新 save」或相反方向的撕裂快照。
 */
export async function getProfileAndLatestSave(profileId) {
    const transaction = tx(['profiles', 'game_saves']);
    const done = transactionDone(transaction);
    try {
        const [profile, lastSave] = await Promise.all([
            promisify(transaction.objectStore('profiles').get(profileId)),
            getLatestSaveFromStore(transaction.objectStore('game_saves'), profileId),
        ]);
        await done;
        return { profile: profile || null, lastSave };
    } catch (error) {
        await done.catch(() => {});
        throw error;
    }
}

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

// ── 原子回合提交 ────────────────────────────────────

/**
 * 將玩家狀態、回合存檔、小說章節與衍生狀態放在同一個 transaction。
 * IndexedDB 會序列化重疊的 readwrite transaction；搭配回合檢查可阻止
 * 多分頁同時從同一回合產生結果後互相覆寫。
 */
export async function commitRound(profileId, roundData, options = {}) {
    const incomingRound = Number(roundData?.R);
    if (!profileId || !Number.isInteger(incomingRound) || incomingRound < 1) {
        throw new Error('回合資料缺少有效的玩家或回合編號。');
    }

    const profileUpdates = options.profileUpdates || {};
    const stateUpdates = options.stateUpdates || {};
    const expectedPreviousRound = Number.isInteger(options.expectedPreviousRound)
        ? options.expectedPreviousRound
        : incomingRound - 1;

    const db = getDB();
    const transaction = db.transaction(
        ['profiles', 'game_saves', 'novel_chapters', 'game_state'],
        'readwrite'
    );
    const done = transactionDone(transaction);

    try {
        const profileStore = transaction.objectStore('profiles');
        const saveStore = transaction.objectStore('game_saves');
        const chapterStore = transaction.objectStore('novel_chapters');
        const stateStore = transaction.objectStore('game_state');

        const [profile, existingSaves] = await Promise.all([
            promisify(profileStore.get(profileId)),
            promisify(saveStore.index('by_profile').getAll(profileId)),
        ]);
        if (!profile) throw new Error(`找不到檔案: ${profileId}`);

        const currentRound = existingSaves.reduce(
            (max, save) => Math.max(max, Number(save.R) || 0),
            0
        );
        if (currentRound !== expectedPreviousRound || incomingRound !== currentRound + 1) {
            const conflict = new Error(
                `回合衝突：目前為 R${currentRound}，收到 R${incomingRound}。請重新載入最新進度。`
            );
            conflict.code = 'ROUND_CONFLICT';
            throw conflict;
        }

        const updatedProfile = {
            ...profile,
            ...profileUpdates,
            id: profileId,
            lastCommittedRound: incomingRound,
            updatedAt: new Date().toISOString(),
        };
        const saveRecord = { ...roundData, profileId };

        profileStore.put(updatedProfile);
        saveStore.add(saveRecord);
        if (typeof roundData.story === 'string' && roundData.story.trim()) {
            chapterStore.put({
                profileId,
                round: incomingRound,
                story: roundData.story,
                timestamp: new Date().toISOString(),
            });
        }
        for (const [key, data] of Object.entries(stateUpdates)) {
            if (!key || key.length > 64) throw new Error('遊戲狀態鍵值不合法。');
            stateStore.put({ profileId, key, data });
        }

        await done;
        return { profile: updatedProfile, round: incomingRound };
    } catch (error) {
        try { transaction.abort(); } catch { /* transaction may already be closed */ }
        await done.catch(() => {});
        throw error;
    }
}

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

    const stateKeys = ['summary', 'summary_revision', 'milestones', 'clues_summary', 'epilogue'];
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

    const profileId = jsonData.profile?.id;
    if (typeof profileId !== 'string' || !profileId || profileId.length > 128) {
        throw new Error('存檔缺少有效的玩家識別碼。');
    }

    const collections = {
        gameSaves: jsonData.gameSaves || [],
        locationStates: jsonData.locationStates || [],
        locationTemplates: jsonData.locationTemplates || [],
        novelChapters: jsonData.novelChapters || [],
    };
    for (const [name, value] of Object.entries(collections)) {
        if (!Array.isArray(value) || value.length > 10000) {
            throw new Error(`存檔的 ${name} 資料量不合法。`);
        }
    }

    const db = getDB();
    const transaction = db.transaction(Object.keys(STORES_FOR_IMPORT), 'readwrite');
    const done = transactionDone(transaction);

    try {
        const profileStore = transaction.objectStore('profiles');
        const saveStore = transaction.objectStore('game_saves');
        const locationStateStore = transaction.objectStore('location_states');
        const locationStore = transaction.objectStore('locations');
        const chapterStore = transaction.objectStore('novel_chapters');
        const stateStore = transaction.objectStore('game_state');

        // 先清除同一 profile 的舊資料；整個匯入若任何一步失敗會自動 rollback。
        const [saveKeys, locationStateKeys, chapterKeys, stateKeys] = await Promise.all([
            promisify(saveStore.index('by_profile').getAllKeys(profileId)),
            promisify(locationStateStore.index('by_profile').getAllKeys(profileId)),
            promisify(chapterStore.index('by_profile').getAllKeys(profileId)),
            promisify(stateStore.index('by_profile').getAllKeys(profileId)),
        ]);
        for (const key of saveKeys) saveStore.delete(key);
        for (const key of locationStateKeys) locationStateStore.delete(key);
        for (const key of chapterKeys) chapterStore.delete(key);
        for (const key of stateKeys) stateStore.delete(key);

        profileStore.put({ ...jsonData.profile, id: profileId });
        for (const tpl of collections.locationTemplates) {
            if (typeof tpl?.locationName !== 'string' || !tpl.locationName) {
                throw new Error('存檔包含無效地點模板。');
            }
            locationStore.put({ ...tpl, locationName: tpl.locationName });
        }
        for (const save of collections.gameSaves) {
            if (!Number.isInteger(Number(save?.R)) || Number(save.R) < 0) {
                throw new Error('存檔包含無效回合。');
            }
            saveStore.add({ ...save, profileId, R: Number(save.R) });
        }
        for (const loc of collections.locationStates) {
            if (typeof loc?.locationName !== 'string' || !loc.locationName) {
                throw new Error('存檔包含無效地點狀態。');
            }
            locationStateStore.put({ ...loc, profileId });
        }
        for (const chapter of collections.novelChapters) {
            const round = Number(chapter?.round);
            if (!Number.isInteger(round) || round < 0) throw new Error('存檔包含無效章節。');
            chapterStore.put({ ...chapter, profileId, round });
        }
        for (const [key, data] of Object.entries(jsonData.gameState || {})) {
            if (!key || key.length > 64) throw new Error('存檔包含無效狀態鍵值。');
            stateStore.put({ profileId, key, data });
        }

        await done;
        return profileId;
    } catch (error) {
        try { transaction.abort(); } catch { /* already closed */ }
        await done.catch(() => {});
        throw error;
    }
}

// ── 完整重置 ────────────────────────────────────────

export async function resetProfile(profileId, options = {}) {
    const profileUpdates = options.profileUpdates || {};
    const initialRound = options.initialRound || null;
    if (initialRound !== null) {
        const round = Number(initialRound?.R);
        if (!Number.isInteger(round) || round !== 0) {
            throw new Error('初始回合必須是 R0。');
        }
    }

    const db = getDB();
    const transaction = db.transaction(
        ['profiles', 'game_saves', 'location_states', 'novel_chapters', 'game_state'],
        'readwrite'
    );
    const done = transactionDone(transaction);
    try {
        const profileStore = transaction.objectStore('profiles');
        const saveStore = transaction.objectStore('game_saves');
        const locationStateStore = transaction.objectStore('location_states');
        const chapterStore = transaction.objectStore('novel_chapters');
        const stateStore = transaction.objectStore('game_state');
        const [existing, saveKeys, locationKeys, chapterKeys, stateKeys] = await Promise.all([
            promisify(profileStore.get(profileId)),
            promisify(saveStore.index('by_profile').getAllKeys(profileId)),
            promisify(locationStateStore.index('by_profile').getAllKeys(profileId)),
            promisify(chapterStore.index('by_profile').getAllKeys(profileId)),
            promisify(stateStore.index('by_profile').getAllKeys(profileId)),
        ]);
        for (const key of saveKeys) saveStore.delete(key);
        for (const key of locationKeys) locationStateStore.delete(key);
        for (const key of chapterKeys) chapterStore.delete(key);
        for (const key of stateKeys) stateStore.delete(key);
        let updatedProfile = null;
        if (existing) {
            updatedProfile = {
                ...existing,
                morality: 0,
                isDeceased: false,
                lastCommittedRound: 0,
                ...profileUpdates,
                id: profileId,
                updatedAt: new Date().toISOString(),
            };
            profileStore.put(updatedProfile);
        }
        if (initialRound) {
            saveStore.add({ ...initialRound, profileId, R: 0 });
        }
        await done;
        return updatedProfile;
    } catch (error) {
        try { transaction.abort(); } catch { /* already closed */ }
        await done.catch(() => {});
        throw error;
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
    getProfileAndLatestSave,
    commitRound,
    exportAll,
    importAll,
    resetProfile
};

export default clientDB;
