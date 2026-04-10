// tests/unit/gameUtils.test.js
// gameUtils.js 純函式單元測試
// 注意：gameUtils 使用 ES Module，此處用動態 import

import { describe, it, expect, beforeAll } from 'vitest';

let utils;

beforeAll(async () => {
    utils = await import('../../../client/utils/gameUtils.js');
});

// ── clamp ──────────────────────────────────────────

describe('clamp', () => {
    it('should return value when within range', () => {
        expect(utils.clamp(5, 0, 10)).toBe(5);
    });

    it('should return min when value is below', () => {
        expect(utils.clamp(-5, 0, 10)).toBe(0);
    });

    it('should return max when value is above', () => {
        expect(utils.clamp(15, 0, 10)).toBe(10);
    });

    it('should handle negative ranges', () => {
        expect(utils.clamp(-50, -100, -10)).toBe(-50);
        expect(utils.clamp(-200, -100, -10)).toBe(-100);
    });

    it('should handle equal min and max', () => {
        expect(utils.clamp(5, 3, 3)).toBe(3);
    });

    it('should handle boundary values', () => {
        expect(utils.clamp(0, 0, 10)).toBe(0);
        expect(utils.clamp(10, 0, 10)).toBe(10);
    });
});

// ── toSafeNumber / toFiniteNumber ──────────────────

describe('toSafeNumber', () => {
    it('should return valid numbers', () => {
        expect(utils.toSafeNumber(42)).toBe(42);
        expect(utils.toSafeNumber(3.14)).toBe(3.14);
        expect(utils.toSafeNumber(-7)).toBe(-7);
    });

    it('should parse numeric strings', () => {
        expect(utils.toSafeNumber('123')).toBe(123);
        expect(utils.toSafeNumber('12.5')).toBe(12.5);
    });

    it('should return fallback for NaN', () => {
        expect(utils.toSafeNumber('abc')).toBe(0);
        expect(utils.toSafeNumber('abc', 99)).toBe(99);
    });

    it('should return fallback for null/undefined', () => {
        expect(utils.toSafeNumber(null)).toBe(0);
        expect(utils.toSafeNumber(undefined)).toBe(0);
    });

    it('should return fallback for Infinity', () => {
        expect(utils.toSafeNumber(Infinity)).toBe(0);
        expect(utils.toSafeNumber(-Infinity)).toBe(0);
    });

    it('should handle zero correctly', () => {
        expect(utils.toSafeNumber(0)).toBe(0);
        expect(utils.toSafeNumber('0')).toBe(0);
    });
});

describe('toFiniteNumber', () => {
    it('should behave identically to toSafeNumber', () => {
        expect(utils.toFiniteNumber(42)).toBe(42);
        expect(utils.toFiniteNumber('abc')).toBe(0);
        expect(utils.toFiniteNumber(Infinity)).toBe(0);
        // toFiniteNumber(null) → Number(null) = 0, 0 is finite, returns 0
        expect(utils.toFiniteNumber(null)).toBe(0);
    });
});

// ── deepClone ──────────────────────────────────────

describe('deepClone', () => {
    it('should clone objects', () => {
        const obj = { a: 1, b: { c: 2 } };
        const clone = utils.deepClone(obj);
        expect(clone).toEqual(obj);
        expect(clone).not.toBe(obj);
        expect(clone.b).not.toBe(obj.b);
    });

    it('should clone arrays', () => {
        const arr = [1, [2, 3], { a: 4 }];
        const clone = utils.deepClone(arr);
        expect(clone).toEqual(arr);
        expect(clone).not.toBe(arr);
    });

    it('should return null/undefined as-is', () => {
        expect(utils.deepClone(null)).toBe(null);
        expect(utils.deepClone(undefined)).toBe(undefined);
    });

    it('should handle primitives', () => {
        expect(utils.deepClone(42)).toBe(42);
        expect(utils.deepClone('str')).toBe('str');
        expect(utils.deepClone(true)).toBe(true);
    });
});

// ── isPlainObject ──────────────────────────────────

describe('isPlainObject', () => {
    it('should return true for plain objects', () => {
        expect(utils.isPlainObject({})).toBe(true);
        expect(utils.isPlainObject({ a: 1 })).toBe(true);
    });

    it('should return false for arrays', () => {
        expect(utils.isPlainObject([])).toBe(false);
    });

    it('should return false for null', () => {
        expect(utils.isPlainObject(null)).toBe(false);
    });

    it('should return false for primitives', () => {
        expect(utils.isPlainObject(42)).toBe(false);
        expect(utils.isPlainObject('str')).toBe(false);
        expect(utils.isPlainObject(true)).toBe(false);
    });
});

// ── deepMergeObjects ───────────────────────────────

describe('deepMergeObjects', () => {
    it('should merge flat objects', () => {
        const result = utils.deepMergeObjects({ a: 1 }, { b: 2 });
        expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should override values', () => {
        const result = utils.deepMergeObjects({ a: 1 }, { a: 2 });
        expect(result).toEqual({ a: 2 });
    });

    it('should deeply merge nested objects', () => {
        const target = { a: { b: 1, c: 2 } };
        const source = { a: { c: 3, d: 4 } };
        const result = utils.deepMergeObjects(target, source);
        expect(result).toEqual({ a: { b: 1, c: 3, d: 4 } });
    });

    it('should not mutate original objects', () => {
        const target = { a: 1 };
        const source = { b: 2 };
        utils.deepMergeObjects(target, source);
        expect(target).toEqual({ a: 1 });
    });

    it('should replace arrays (not concatenate)', () => {
        const result = utils.deepMergeObjects({ a: [1, 2] }, { a: [3, 4] });
        expect(result.a).toEqual([3, 4]);
    });
});

// ── isLeapYear ─────────────────────────────────────

describe('isLeapYear', () => {
    it('should identify leap years', () => {
        expect(utils.isLeapYear(2000)).toBe(true);
        expect(utils.isLeapYear(2020)).toBe(true);
        expect(utils.isLeapYear(2024)).toBe(true);
    });

    it('should identify non-leap years', () => {
        expect(utils.isLeapYear(1900)).toBe(false);
        expect(utils.isLeapYear(2021)).toBe(false);
        expect(utils.isLeapYear(2023)).toBe(false);
    });

    it('should handle century years', () => {
        expect(utils.isLeapYear(1600)).toBe(true);  // divisible by 400
        expect(utils.isLeapYear(1700)).toBe(false);  // divisible by 100 but not 400
    });
});

// ── advanceDate ────────────────────────────────────

describe('advanceDate', () => {
    it('should not change date when advancing 0 days', () => {
        const result = utils.advanceDate({ yearName: '元祐', year: 1, month: 1, day: 1 }, 0);
        expect(result).toEqual({ yearName: '元祐', year: 1, month: 1, day: 1 });
    });

    it('should advance within a month', () => {
        const result = utils.advanceDate({ yearName: '元祐', year: 1, month: 1, day: 1 }, 5);
        expect(result.day).toBe(6);
        expect(result.month).toBe(1);
    });

    it('should cross month boundary', () => {
        const result = utils.advanceDate({ yearName: '元祐', year: 1, month: 1, day: 30 }, 5);
        expect(result.month).toBe(2);
    });

    it('should cross year boundary', () => {
        const result = utils.advanceDate({ yearName: '元祐', year: 1, month: 12, day: 30 }, 5);
        expect(result.year).toBe(2);
        expect(result.month).toBe(1);
    });

    it('should handle leap year February', () => {
        const result = utils.advanceDate({ yearName: '元祐', year: 2000, month: 2, day: 28 }, 1);
        expect(result.day).toBe(29);
        expect(result.month).toBe(2);
    });

    it('should handle non-leap year February', () => {
        const result = utils.advanceDate({ yearName: '元祐', year: 2001, month: 2, day: 28 }, 1);
        expect(result.day).toBe(1);
        expect(result.month).toBe(3);
    });

    it('should handle large jumps', () => {
        const result = utils.advanceDate({ yearName: '元祐', year: 1, month: 1, day: 1 }, 365);
        expect(result.year).toBe(2);
    });

    it('should preserve yearName', () => {
        const result = utils.advanceDate({ yearName: '天寶', year: 5, month: 6, day: 15 }, 10);
        expect(result.yearName).toBe('天寶');
    });

    it('should use defaults for missing fields', () => {
        const result = utils.advanceDate({}, 0);
        expect(result.yearName).toBe('元祐');
        expect(result.year).toBe(1);
        expect(result.month).toBe(1);
        expect(result.day).toBe(1);
    });
});

// ── normalizeLocationHierarchy ─────────────────────

describe('normalizeLocationHierarchy', () => {
    it('should handle array input', () => {
        const result = utils.normalizeLocationHierarchy(['京城', '東市', '酒樓']);
        expect(result).toEqual(['京城', '東市', '酒樓']);
    });

    it('should handle ">" delimited string', () => {
        const result = utils.normalizeLocationHierarchy('京城 > 東市 > 酒樓');
        expect(result).toEqual(['京城', '東市', '酒樓']);
    });

    it('should handle "→" delimited string', () => {
        const result = utils.normalizeLocationHierarchy('京城→東市→酒樓');
        expect(result).toEqual(['京城', '東市', '酒樓']);
    });

    it('should filter empty strings', () => {
        const result = utils.normalizeLocationHierarchy(['', '京城', '', '東市']);
        expect(result).toEqual(['京城', '東市']);
    });

    it('should handle null/undefined', () => {
        expect(utils.normalizeLocationHierarchy(null)).toEqual([]);
        expect(utils.normalizeLocationHierarchy(undefined)).toEqual([]);
    });

    it('should trim whitespace', () => {
        const result = utils.normalizeLocationHierarchy('  京城  >  東市  ');
        expect(result).toEqual(['京城', '東市']);
    });
});

// ── Constants ──────────────────────────────────────

describe('Constants', () => {
    it('MAX_POWER should be 999', () => {
        expect(utils.MAX_POWER).toBe(999);
    });

    it('TIME_SEQUENCE should have 4 entries', () => {
        expect(utils.TIME_SEQUENCE).toHaveLength(4);
        expect(utils.TIME_SEQUENCE).toContain('上午');
        expect(utils.TIME_SEQUENCE).toContain('深夜');
    });
});
