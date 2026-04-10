// client/utils/gameUtils.js
// 純遊戲邏輯工具函式 — 從後端直接搬移，不依賴任何 I/O

export const MAX_POWER = 999;
export const TIME_SEQUENCE = ['上午', '午後', '黃昏', '深夜'];

export const BULK_TO_SCORE_MAP = { '輕': 2, '中': 5, '重': 10, '極重': 20 };

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

// ── 負重計算 ────────────────────────────────────────

export function calculateBulkScore(inventory) {
    if (!Array.isArray(inventory)) return 0;
    return inventory.reduce((sum, item) => {
        const quantity = toSafeNumber(item.quantity, 1);
        const bulkValue = BULK_TO_SCORE_MAP[item.bulk] || 0;
        return sum + bulkValue * quantity;
    }, 0);
}

export function isCurrencyLikeItem(item) {
    if (!item) return false;
    const name = String(item.itemName || item.templateId || '').toLowerCase();
    const type = String(item.itemType || '').toLowerCase();
    return type === '財寶' || type === '貨幣' ||
        ['銀兩', '碎銀', '銀幣', '銀票', '金幣', '金條', '黃金', '銅錢', '銅幣'].some(c => name.includes(c));
}

// ── 體力計算 ────────────────────────────────────────

export function calculateNewStamina(currentStamina, actionText) {
    const text = String(actionText || '').toLowerCase();
    const has = (...keys) => keys.some(k => text.includes(k));

    let delta = -5;
    if (has('休息', '打坐', '睡', '調息')) delta = 18;
    else if (has('修練', '練功', '吐納', '內功')) delta = -10;
    else if (has('出拳', '外功', '刀', '劍', '搏鬥')) delta = -9;
    else if (has('輕功', '趕路', '探查', '追')) delta = -8;

    return clamp(toSafeNumber(currentStamina, 100) + delta, 0, 100);
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
        if (month > 12) {
            month = 1;
            year++;
        }
    }
    return { yearName: yearName || '元祐', year, month, day };
}

export function nextTimeOfDay(current) {
    const currentIndex = TIME_SEQUENCE.indexOf(current);
    const nextIndex = (currentIndex + 1) % TIME_SEQUENCE.length;
    return {
        timeOfDay: TIME_SEQUENCE[nextIndex < 0 ? 0 : nextIndex],
        wrappedDay: currentIndex >= 0 && nextIndex === 0
    };
}

// ── 戰鬥相關 ────────────────────────────────────────

export function inferNpcTagType(skillName) {
    const name = String(skillName || '');
    if (/攻|拳|掌|劍|刀|槍|斬|破|碎|殺/.test(name)) return 'attack';
    if (/守|盾|擋|護|壁|甲/.test(name)) return 'defense';
    if (/閃|避|飄|輕|影|步|遁/.test(name)) return 'evasion';
    if (/援|助|陣|旗|鼓|吹/.test(name)) return 'support';
    if (/醫|療|丹|藥|救|治|補|氣/.test(name)) return 'healing';
    return 'attack';
}

export function getNpcTags(skills) {
    if (!Array.isArray(skills)) return ['attack'];
    const tags = new Set(skills.map(s => inferNpcTagType(typeof s === 'string' ? s : s.skillName)));
    return tags.size ? Array.from(tags) : ['attack'];
}

export function getFriendlinessLevel(value) {
    const v = toSafeNumber(value, 0);
    if (v >= 80) return 'devoted';
    if (v >= 50) return 'trusted';
    if (v >= 20) return 'friendly';
    if (v >= -20) return 'neutral';
    if (v >= -50) return 'wary';
    if (v >= -80) return 'hostile';
    return 'sworn_enemy';
}

// ── 地點相關 ────────────────────────────────────────

export function normalizeLocationHierarchy(loc) {
    if (Array.isArray(loc)) return loc.map(s => String(s || '').trim()).filter(Boolean);
    if (typeof loc === 'string') return loc.split(/[>,→]/).map(s => s.trim()).filter(Boolean);
    return [];
}

export function hasLocationOverlap(loc1, loc2) {
    const a = normalizeLocationHierarchy(loc1);
    const b = normalizeLocationHierarchy(loc2);
    return a.some(x => b.includes(x));
}

export function getAddressPath(address) {
    if (!address || typeof address !== 'object') return '';
    return ['country', 'region', 'city', 'district', 'town', 'street']
        .map(k => address[k]).filter(Boolean).join(' > ');
}

export function buildLocationSummary(locationData) {
    if (!locationData) return null;
    return {
        locationName: locationData.locationName || locationData.name || '未知',
        description: locationData.description || '',
        ruler: locationData.governance?.ruler || '不明',
        addressPath: getAddressPath(locationData.address),
        locationType: locationData.locationType || 'unknown'
    };
}

// ── 功力變動規範化 ──────────────────────────────────

export function normalizePowerChange(change) {
    if (!change || typeof change !== 'object') return { internal: 0, external: 0, lightness: 0 };
    return {
        internal: toFiniteNumber(change.internal),
        external: toFiniteNumber(change.external),
        lightness: toFiniteNumber(change.lightness)
    };
}

// ── 修煉公式（完整搬移自 cultivationFormulas.js）────

export const CULTIVATION_CHANCES = {
    GREAT_SUCCESS: 0.50,
    SUCCESS: 0.35,
    NO_PROGRESS: 0.10,
    DISASTER: 0.05
};

export const DAILY_BASE_EXP = {
    GREAT_SUCCESS: 200,
    SUCCESS: 100,
    NO_PROGRESS: 0,
    DISASTER: -50
};

export const DAILY_BASE_POWER_GAIN = {
    GREAT_SUCCESS: 50,
    SUCCESS: 20,
    NO_PROGRESS: 0,
    DISASTER: -30
};

function getStaminaModifier(stamina) {
    if (stamina >= 95) return { success: 1.1, disaster: 0.5 };
    if (stamina >= 90) return { success: 1.0, disaster: 1.0 };
    if (stamina >= 80) return { success: 0.9, disaster: 1.2 };
    return { success: 0.5, disaster: 2.0 };
}

function getDiminishingReturnsMultiplier(days) {
    if (days <= 0) return 0;
    return Math.log1p(days) * 2.5 + (days / 10);
}

export function calculateCultivationOutcome(days, playerProfile, skillToPractice) {
    const stamina = toSafeNumber(playerProfile.stamina, 80);
    const modifier = getStaminaModifier(stamina);

    const adjustedChances = {
        GREAT_SUCCESS: CULTIVATION_CHANCES.GREAT_SUCCESS * modifier.success,
        SUCCESS: CULTIVATION_CHANCES.SUCCESS * modifier.success,
        NO_PROGRESS: CULTIVATION_CHANCES.NO_PROGRESS,
        DISASTER: CULTIVATION_CHANCES.DISASTER * modifier.disaster
    };

    const rand = Math.random();
    let cumulativeChance = 0;
    let outcome = 'NO_PROGRESS';

    for (const [key, chance] of Object.entries(adjustedChances)) {
        cumulativeChance += chance;
        if (rand < cumulativeChance) {
            outcome = key;
            break;
        }
    }

    const multiplier = getDiminishingReturnsMultiplier(days);
    const expChange = Math.round((DAILY_BASE_EXP[outcome] || 0) * multiplier);
    const powerGain = Math.round((DAILY_BASE_POWER_GAIN[outcome] || 0) * multiplier);

    const powerChange = { internal: 0, external: 0, lightness: 0 };
    const powerType = skillToPractice?.power_type || 'external';

    if (['internal', 'external', 'lightness'].includes(powerType)) {
        powerChange[powerType] = powerGain;
    }

    const skillName = skillToPractice?.skillName || '武學';
    const storyHints = {
        GREAT_SUCCESS: `主角天賦異稟，在為期${days}天的閉關中，不僅完全領悟了「${skillName}」的精髓，更感到一股強大的力量在體內覺醒，功力大增。`,
        SUCCESS: `經過${days}天的潛心修練，主角對「${skillName}」的理解又深了一層，招式更加純熟，感覺有所精進。`,
        NO_PROGRESS: `這${days}天裡，主角心浮氣躁，始終無法進入物我兩忘的境界，對「${skillName}」的修練似乎沒有任何進展。`,
        DISASTER: `在修練「${skillName}」的緊要關頭，主角突然感到一陣心悸，氣血翻湧，真氣逆行，顯然是走火入魔的徵兆！功力不進反退。`
    };

    return { outcome, expChange, powerChange, storyHint: storyHints[outcome] };
}

// ── 動作預處理 ──────────────────────────────────────

const FACILITY_KEYWORDS = {
    '鐵匠': '鐵匠鋪', '打鐵': '鐵匠鋪',
    '客棧': '客棧', '住宿': '客棧', '歇腳': '客棧',
    '藥鋪': '藥鋪', '買藥': '藥鋪',
    '酒館': '酒館', '喝酒': '酒館',
    '茶棚': '茶棚', '喝茶': '茶棚'
};

export function preprocessPlayerAction(action) {
    const text = String(action || '').trim();
    for (const [keyword, facility] of Object.entries(FACILITY_KEYWORDS)) {
        if (text.includes(keyword)) {
            return { action: text, targetFacility: facility };
        }
    }
    return { action: text, targetFacility: null };
}
