// client/db/clientDB.js
// 核心 IndexedDB 資料層 — 取代 Firebase Firestore 的所有讀寫操作

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

async function clearStore(storeName) {
    const t = tx(storeName, 'readwrite');
    return promisify(t.objectStore(storeName).clear());
}

// ── 玩家檔案 (profiles) ─────────────────────────────

export const profiles = {
    async create(data) {
        const id = data.id || generateId();
        const profile = {
            id,
            username: data.username || '無名俠客',
            gender: data.gender || '男',
            internalPower: 5, externalPower: 5, lightness: 5,
            morality: 0, stamina: 100, bulkScore: 0,
            isDeceased: false,
            equipment: {
                head: null, body: null, hands: null, feet: null,
                weapon_right: null, weapon_left: null, weapon_back: null,
                accessory1: null, accessory2: null, manuscript: null
            },
            maxInternalPowerAchieved: 5,
            maxExternalPowerAchieved: 5,
            maxLightnessAchieved: 5,
            customSkillsCreated: { internal: 0, external: 0, lightness: 0, none: 0 },
            shortActionCounter: 0,
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
        return all.slice(0, count).reverse(); // 按 R 升序
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
        for (const record of all) {
            store.delete([record.profileId, record.R]);
        }
        return new Promise((resolve, reject) => {
            t.oncomplete = () => resolve();
            t.onerror = () => reject(t.error);
        });
    }
};

// ── 物品 (inventory) ────────────────────────────────

export const inventory = {
    async list(profileId) {
        return getAllByIndex('inventory', 'by_profile', profileId);
    },
    async get(profileId, instanceId) {
        return getOne('inventory', [profileId, instanceId]);
    },
    async add(profileId, item) {
        const instanceId = item.instanceId || `item-${generateId()}`;
        const record = { ...item, profileId, instanceId };
        await putOne('inventory', record);
        return record;
    },
    async update(profileId, instanceId, changes) {
        const existing = await getOne('inventory', [profileId, instanceId]);
        if (!existing) throw new Error(`找不到物品: ${instanceId}`);
        const updated = { ...existing, ...changes };
        await putOne('inventory', updated);
        return updated;
    },
    async remove(profileId, instanceId) {
        await deleteOne('inventory', [profileId, instanceId]);
    },
    async equip(profileId, instanceId) {
        return this.update(profileId, instanceId, { isEquipped: true });
    },
    async unequip(profileId, instanceId) {
        return this.update(profileId, instanceId, { isEquipped: false, equipSlot: null });
    },
    async deleteAll(profileId) {
        const all = await this.list(profileId);
        const t = tx('inventory', 'readwrite');
        const store = t.objectStore('inventory');
        for (const item of all) store.delete([item.profileId, item.instanceId]);
        return new Promise((resolve, reject) => {
            t.oncomplete = () => resolve();
            t.onerror = () => reject(t.error);
        });
    }
};

// ── 技能 (skills) ───────────────────────────────────

export const skills = {
    async list(profileId) {
        return getAllByIndex('skills', 'by_profile', profileId);
    },
    async get(profileId, skillName) {
        return getOne('skills', [profileId, skillName]);
    },
    async add(profileId, skill) {
        const record = { ...skill, profileId };
        await putOne('skills', record);
        return record;
    },
    async update(profileId, skillName, changes) {
        const existing = await getOne('skills', [profileId, skillName]);
        if (!existing) throw new Error(`找不到技能: ${skillName}`);
        const updated = { ...existing, ...changes };
        await putOne('skills', updated);
        return updated;
    },
    async remove(profileId, skillName) {
        await deleteOne('skills', [profileId, skillName]);
    },
    async deleteAll(profileId) {
        const all = await this.list(profileId);
        const t = tx('skills', 'readwrite');
        const store = t.objectStore('skills');
        for (const s of all) store.delete([s.profileId, s.skillName]);
        return new Promise((resolve, reject) => {
            t.oncomplete = () => resolve();
            t.onerror = () => reject(t.error);
        });
    }
};

// ── NPC 狀態 (npc_states) ───────────────────────────

export const npcs = {
    async getState(profileId, npcName) {
        return getOne('npc_states', [profileId, npcName]);
    },
    async setState(profileId, npcName, data) {
        const record = { ...data, profileId, npcName };
        await putOne('npc_states', record);
        return record;
    },
    async listStates(profileId) {
        return getAllByIndex('npc_states', 'by_profile', profileId);
    },
    async deleteState(profileId, npcName) {
        await deleteOne('npc_states', [profileId, npcName]);
    },
    async deleteAllStates(profileId) {
        const all = await this.listStates(profileId);
        const t = tx('npc_states', 'readwrite');
        const store = t.objectStore('npc_states');
        for (const n of all) store.delete([n.profileId, n.npcName]);
        return new Promise((resolve, reject) => {
            t.oncomplete = () => resolve();
            t.onerror = () => reject(t.error);
        });
    },
    // NPC 模板（全域）
    async getTemplate(npcName) {
        return getOne('npc_templates', npcName);
    },
    async setTemplate(npcName, data) {
        await putOne('npc_templates', { ...data, name: npcName });
    },
    async listTemplates() {
        const t = tx('npc_templates');
        return promisify(t.objectStore('npc_templates').getAll());
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

// ── 模板快取 (item_templates, skill_templates) ──────

export const templates = {
    async getItem(itemName) {
        return getOne('item_templates', itemName);
    },
    async setItem(itemName, data) {
        await putOne('item_templates', { ...data, itemName });
    },
    async getSkill(skillName) {
        return getOne('skill_templates', skillName);
    },
    async setSkill(skillName, data) {
        await putOne('skill_templates', { ...data, skillName });
    }
};

// ── 懸賞 (bounties) ────────────────────────────────

export const bounties = {
    async list(profileId) {
        return getAllByIndex('bounties', 'by_profile', profileId);
    },
    async add(profileId, bounty) {
        const bountyId = bounty.bountyId || generateId();
        const record = { ...bounty, profileId, bountyId };
        await putOne('bounties', record);
        return record;
    },
    async update(profileId, bountyId, changes) {
        const existing = await getOne('bounties', [profileId, bountyId]);
        if (!existing) return null;
        const updated = { ...existing, ...changes };
        await putOne('bounties', updated);
        return updated;
    },
    async deleteAll(profileId) {
        const all = await this.list(profileId);
        const t = tx('bounties', 'readwrite');
        const store = t.objectStore('bounties');
        for (const b of all) store.delete([b.profileId, b.bountyId]);
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
    const [
        profile,
        gameSaves,
        inv,
        sk,
        npcStates,
        locStates,
        bountyList,
        chapters,
    ] = await Promise.all([
        profiles.get(profileId),
        saves.getAll(profileId),
        inventory.list(profileId),
        skills.list(profileId),
        npcs.listStates(profileId),
        locations.listStates(profileId),
        bounties.list(profileId),
        novel.getAll(profileId),
    ]);

    // 收集相關的模板
    const npcTemplateNames = new Set(npcStates.map(n => n.npcName));
    const npcTemplateList = [];
    for (const name of npcTemplateNames) {
        const tpl = await npcs.getTemplate(name);
        if (tpl) npcTemplateList.push(tpl);
    }

    const locationNames = new Set(locStates.map(l => l.locationName));
    const locationTemplateList = [];
    for (const name of locationNames) {
        const tpl = await locations.getTemplate(name);
        if (tpl) locationTemplateList.push(tpl);
    }

    // 收集 game_state
    const stateKeys = ['summary', 'current_combat', 'pending_combat_result', 'novel_cache'];
    const stateData = {};
    for (const key of stateKeys) {
        const val = await state.get(profileId, key);
        if (val !== null) stateData[key] = val;
    }

    return {
        exportVersion: 1,
        exportDate: new Date().toISOString(),
        profile,
        gameSaves,
        inventory: inv,
        skills: sk,
        npcStates,
        npcTemplates: npcTemplateList,
        locationStates: locStates,
        locationTemplates: locationTemplateList,
        bounties: bountyList,
        novelChapters: chapters,
        gameState: stateData
    };
}

export async function importAll(jsonData) {
    if (!jsonData || jsonData.exportVersion !== 1) {
        throw new Error('存檔格式不正確或版本不相容。');
    }

    const profileId = jsonData.profile.id;

    // 匯入檔案
    await putOne('profiles', jsonData.profile);

    // 匯入模板（全域）
    for (const tpl of (jsonData.npcTemplates || [])) {
        await npcs.setTemplate(tpl.name, tpl);
    }
    for (const tpl of (jsonData.locationTemplates || [])) {
        await locations.setTemplate(tpl.locationName, tpl);
    }

    // 匯入存檔
    for (const save of (jsonData.gameSaves || [])) {
        await putOne('game_saves', { ...save, profileId });
    }

    // 匯入物品
    for (const item of (jsonData.inventory || [])) {
        await putOne('inventory', { ...item, profileId });
    }

    // 匯入技能
    for (const skill of (jsonData.skills || [])) {
        await putOne('skills', { ...skill, profileId });
    }

    // 匯入 NPC 狀態
    for (const npc of (jsonData.npcStates || [])) {
        await putOne('npc_states', { ...npc, profileId });
    }

    // 匯入地點狀態
    for (const loc of (jsonData.locationStates || [])) {
        await putOne('location_states', { ...loc, profileId });
    }

    // 匯入懸賞
    for (const b of (jsonData.bounties || [])) {
        await putOne('bounties', { ...b, profileId });
    }

    // 匯入小說
    for (const ch of (jsonData.novelChapters || [])) {
        await putOne('novel_chapters', { ...ch, profileId });
    }

    // 匯入遊戲狀態
    for (const [key, data] of Object.entries(jsonData.gameState || {})) {
        await state.set(profileId, key, data);
    }

    return profileId;
}

// ── 完整重置（刪除單一玩家所有資料）────────────────

export async function resetProfile(profileId) {
    await Promise.all([
        saves.deleteAll(profileId),
        inventory.deleteAll(profileId),
        skills.deleteAll(profileId),
        npcs.deleteAllStates(profileId),
        locations.deleteAllStates(profileId),
        bounties.deleteAll(profileId),
        novel.deleteAll(profileId),
        state.deleteAll(profileId)
    ]);
    // 重置檔案到初始值
    const existing = await profiles.get(profileId);
    if (existing) {
        await profiles.update(profileId, {
            internalPower: 5, externalPower: 5, lightness: 5,
            morality: 0, stamina: 100, bulkScore: 0,
            isDeceased: false,
            shortActionCounter: 0,
            customSkillsCreated: { internal: 0, external: 0, lightness: 0, none: 0 }
        });
    }
}

// ── 預設匯出 ────────────────────────────────────────

const clientDB = {
    init,
    profiles,
    saves,
    inventory,
    skills,
    npcs,
    locations,
    templates,
    bounties,
    novel,
    state,
    exportAll,
    importAll,
    resetProfile
};

export default clientDB;
