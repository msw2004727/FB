// client/utils/exportImport.js
// 存檔匯出/匯入工具

import clientDB from '../db/clientDB.js';

export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;
const MAX_COLLECTION_ITEMS = 5000;
const MAX_NESTING_DEPTH = 24;
const MAX_OBJECT_KEYS = 500;
const MAX_KEY_LENGTH = 256;
const MAX_STRING_LENGTH = 1_000_000;
const MAX_TOTAL_STRING_CHARS = 15_000_000;
const VALID_EXPORT_VERSIONS = new Set([1, 2]);
const VALID_SCENARIOS = new Set(['wuxia', 'school', 'mecha', 'modern', 'animal', 'hero']);
const VALID_GENDERS = new Set(['male', 'female']);
const ALLOWED_GAME_STATE_KEYS = new Set(['summary', 'summary_revision', 'milestones', 'clues_summary', 'epilogue']);
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** 將使用者字串限制為跨平台可安全下載的單一檔名片段。 */
export function sanitizeFilenameSegment(value, fallback = 'player', maxLength = 64) {
    let sanitized = String(value || '')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .trim()
        .replace(/[. ]+$/g, '')
        .slice(0, Math.max(1, maxLength))
        .replace(/[. ]+$/g, '');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sanitized)) {
        sanitized = `_${sanitized}`;
    }
    return sanitized || fallback;
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function validateJsonValue(value, path, depth, counters, ancestors) {
    if (depth > MAX_NESTING_DEPTH) throw new Error(`${path} 巢狀層級過深`);
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error(`${path} 包含無效數字`);
        return;
    }
    if (typeof value === 'string') {
        if (value.length > MAX_STRING_LENGTH) throw new Error(`${path} 文字過長`);
        counters.stringChars += value.length;
        if (counters.stringChars > MAX_TOTAL_STRING_CHARS) throw new Error('存檔文字總量過大');
        return;
    }
    if (typeof value !== 'object') throw new Error(`${path} 包含不支援的資料型態`);
    if (ancestors.has(value)) throw new Error(`${path} 包含循環參照`);

    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            if (value.length > MAX_COLLECTION_ITEMS) throw new Error(`${path} 項目過多`);
            value.forEach((item, index) => validateJsonValue(item, `${path}[${index}]`, depth + 1, counters, ancestors));
            return;
        }
        if (!isPlainObject(value)) throw new Error(`${path} 必須是一般物件`);
        const keys = Object.keys(value);
        if (keys.length > MAX_OBJECT_KEYS) throw new Error(`${path} 欄位過多`);
        for (const key of keys) {
            if (key.length > MAX_KEY_LENGTH) throw new Error(`${path} 包含過長欄位名稱`);
            if (DANGEROUS_OBJECT_KEYS.has(key)) throw new Error(`${path} 包含不安全欄位 ${key}`);
            validateJsonValue(value[key], `${path}.${key}`, depth + 1, counters, ancestors);
        }
    } finally {
        ancestors.delete(value);
    }
}

function isValidRound(value) {
    if (typeof value === 'string' && !/^\d+$/.test(value)) return false;
    const round = Number(value);
    return Number.isSafeInteger(round) && round >= 0 && round <= 10_000_000;
}

function validateNamedCollection(data, key) {
    const collection = data[key];
    if (collection === undefined) return [];
    if (!Array.isArray(collection)) throw new Error(`${key} 必須是陣列`);
    if (collection.length > MAX_COLLECTION_ITEMS) throw new Error(`${key} 項目過多`);
    collection.forEach((item, index) => {
        if (!isPlainObject(item)) throw new Error(`${key}[${index}] 格式不正確`);
    });
    return collection;
}

/**
 * 驗證匯入資料的外型與合理上限；驗證成功時回傳原資料。
 * 此函式不會修改資料，讓呼叫端能在寫入 IndexedDB 前先完整拒絕壞檔。
 */
export function validateImportedSaveData(data, { rawSize = 0 } = {}) {
    if (rawSize > MAX_IMPORT_FILE_BYTES) throw new Error('存檔超過 20 MB 上限');
    if (!isPlainObject(data)) throw new Error('存檔最外層必須是物件');

    validateJsonValue(data, '存檔', 0, { stringChars: 0 }, new WeakSet());

    if (!VALID_EXPORT_VERSIONS.has(data.exportVersion)) {
        throw new Error('存檔格式不正確或版本不相容');
    }
    if (!isPlainObject(data.profile)) throw new Error('存檔缺少角色資料');
    const profileId = data.profile.id;
    if (typeof profileId !== 'string' || profileId.length < 1 || profileId.length > 128) {
        throw new Error('角色識別碼格式不正確');
    }
    if (typeof data.profile.username !== 'string' || data.profile.username.trim().length < 1 || data.profile.username.length > 100) {
        throw new Error('角色名稱格式不正確');
    }
    if (data.profile.scenario !== undefined && !VALID_SCENARIOS.has(data.profile.scenario)) {
        throw new Error('劇本識別碼不受支援');
    }
    if (data.profile.gender !== undefined && !VALID_GENDERS.has(data.profile.gender)) {
        throw new Error('角色性別欄位不受支援');
    }

    if (!Array.isArray(data.gameSaves)) throw new Error('存檔缺少遊戲回合資料');
    if (data.gameSaves.length > MAX_COLLECTION_ITEMS) throw new Error('遊戲回合數量過多');
    const seenRounds = new Set();
    data.gameSaves.forEach((save, index) => {
        if (!isPlainObject(save) || !isValidRound(save.R)) throw new Error(`gameSaves[${index}] 回合格式不正確`);
        const round = Number(save.R);
        if (seenRounds.has(round)) throw new Error(`gameSaves 包含重複回合 ${round}`);
        seenRounds.add(round);
        if (save.story !== undefined && typeof save.story !== 'string') {
            throw new Error(`gameSaves[${index}].story 必須是文字`);
        }
    });

    const locationStates = validateNamedCollection(data, 'locationStates');
    const locationTemplates = validateNamedCollection(data, 'locationTemplates');
    for (const [key, collection] of [['locationStates', locationStates], ['locationTemplates', locationTemplates]]) {
        collection.forEach((item, index) => {
            if (typeof item.locationName !== 'string' || item.locationName.trim().length < 1 || item.locationName.length > 200) {
                throw new Error(`${key}[${index}].locationName 格式不正確`);
            }
        });
    }

    const novelChapters = validateNamedCollection(data, 'novelChapters');
    novelChapters.forEach((chapter, index) => {
        if (!isValidRound(chapter.round)) throw new Error(`novelChapters[${index}].round 格式不正確`);
        if (chapter.story !== undefined && typeof chapter.story !== 'string') {
            throw new Error(`novelChapters[${index}].story 必須是文字`);
        }
    });

    if (data.gameState !== undefined) {
        if (!isPlainObject(data.gameState)) throw new Error('gameState 必須是物件');
        for (const key of Object.keys(data.gameState)) {
            if (!ALLOWED_GAME_STATE_KEYS.has(key)) throw new Error(`gameState 包含不支援欄位 ${key}`);
        }
    }

    return data;
}

/**
 * 匯出存檔為 JSON 檔案下載
 * @param {string} profileId
 */
export async function exportSave(profileId) {
    const data = await clientDB.exportAll(profileId);
    const profile = data.profile;
    const safeUsername = sanitizeFilenameSegment(profile?.username, 'player');
    const filename = `wenjiang_save_${safeUsername}_${new Date().toISOString().slice(0, 10)}.json`;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return filename;
}

/**
 * 從 JSON 檔案匯入存檔
 * @returns {Promise<string>} profileId
 */
export function importSave() {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (event) => {
            const file = event.target.files[0];
            if (!file) return reject(new Error('未選擇檔案'));

            try {
                if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error('存檔超過 20 MB 上限');
                const text = await file.text();
                if (text.length > MAX_IMPORT_FILE_BYTES) throw new Error('存檔內容超過合理上限');
                const data = JSON.parse(text);
                const validatedData = validateImportedSaveData(data, { rawSize: file.size });
                const profileId = await clientDB.importAll(validatedData);
                resolve(profileId);
            } catch (error) {
                reject(new Error(`匯入失敗: ${error.message}`));
            }
        };
        input.click();
    });
}

/**
 * 檢查是否應該提醒玩家備份
 */
export function shouldRemindBackup() {
    const lastRemind = localStorage.getItem('wenjiang_last_backup_remind');
    if (!lastRemind) return true;
    const daysSince = (Date.now() - Number(lastRemind)) / (1000 * 60 * 60 * 24);
    return daysSince >= 3; // 每 3 天提醒一次
}

export function markBackupReminded() {
    localStorage.setItem('wenjiang_last_backup_remind', String(Date.now()));
}

/**
 * 檢測是否為 iOS Safari（高風險平台）
 */
export function isIOSSafari() {
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) && /WebKit/.test(ua) && !/CriOS|FxiOS/.test(ua);
}
