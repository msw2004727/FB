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
    year = toSafeNumber(year, 1);
    month = toSafeNumber(month, 1);
    day = toSafeNumber(day, 1);

    const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    day += daysToAdvance;
    while (day > (daysInMonth[month - 1] || 30)) {
        day -= (daysInMonth[month - 1] || 30);
        month++;
        if (month > 12) { month = 1; year++; }
    }
    return { yearName: yearName || '元祐', year, month, day };
}

// ── 地點相關 ────────────────────────────────────────

export function normalizeLocationHierarchy(loc) {
    if (Array.isArray(loc)) return loc.map(s => String(s || '').trim()).filter(Boolean);
    if (typeof loc === 'string') return loc.split(/[>,→]/).map(s => s.trim()).filter(Boolean);
    return [];
}
