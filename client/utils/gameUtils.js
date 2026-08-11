// client/utils/gameUtils.js
// 精簡版 — 僅保留使用中的純邏輯工具函式

export const MAX_POWER = 999;
export const TIME_SEQUENCE = ['上午', '午後', '黃昏', '深夜'];

// ── 基礎工具 ────────────────────────────────────────

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function toSafeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export function toFiniteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export function deepClone(value) {
    if (value === null || value === undefined) return value;
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

export function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function deepMergeObjects(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (isPlainObject(result[key]) && isPlainObject(source[key])) {
            result[key] = deepMergeObjects(result[key], source[key]);
        } else {
            result[key] = deepClone(source[key]);
        }
    }
    return result;
}

// ── 日期推進 ────────────────────────────────────────

export function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

export function advanceDate(date, daysToAdvance = 0) {
    let { yearName, year, month, day } = date;
    year = clamp(Math.trunc(toSafeNumber(year, 1)), 1, 9999);
    month = clamp(Math.trunc(toSafeNumber(month, 1)), 1, 12);
    day = clamp(Math.trunc(toSafeNumber(day, 1)), 1, 31);
    const safeDays = typeof daysToAdvance === 'number' && Number.isFinite(daysToAdvance)
        ? clamp(Math.trunc(daysToAdvance), 0, 3650)
        : 0;

    // Native calendar normalization is bounded and cannot be trapped in a
    // model-controlled month-by-month loop.
    const result = new Date(0);
    result.setUTCHours(0, 0, 0, 0);
    result.setUTCFullYear(year, month - 1, day + safeDays);
    return {
        yearName: yearName || '元祐',
        year: result.getUTCFullYear(),
        month: result.getUTCMonth() + 1,
        day: result.getUTCDate(),
    };
}

// ── 地點相關 ────────────────────────────────────────

export function normalizeLocationHierarchy(loc) {
    if (Array.isArray(loc)) return loc.map(s => String(s || '').trim()).filter(Boolean);
    if (typeof loc === 'string') return loc.split(/[>,→]/).map(s => s.trim()).filter(Boolean);
    return [];
}
