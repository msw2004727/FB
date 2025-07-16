// api/config/cultivationFormulas.js

/**
 * 閉關修練系統 - 核心數值與公式設定檔 v2.0
 * =================================================================
 * 【核心修改】引入邊際效應遞減，閉關時間越長，每日平均收益越低。
 * =================================================================
 */

// 1. 閉關結果的基礎機率 (保持不變)
const CULTIVATION_CHANCES = {
    GREAT_SUCCESS: 0.50, // 15% 機率大功告成
    SUCCESS: 0.35,       // 60% 機率略有小成
    NO_PROGRESS: 0.10,   // 20% 機率毫無進展
    DISASTER: 0.05       // 5% 機率走火入魔
};

// 2. 閉關每日基礎經驗值 (保持不變)
const DAILY_BASE_EXP = {
    GREAT_SUCCESS: 200,
    SUCCESS: 100,
    NO_PROGRESS: 0,
    DISASTER: -50 // 走火入魔會倒扣經驗
};

// 3. 閉關每日基礎功力值獎勵 (保持不變)
const DAILY_BASE_POWER_GAIN = {
    GREAT_SUCCESS: 50,
    SUCCESS: 20,
    NO_PROGRESS: 0,
    DISASTER: -30 // 走火入魔會倒扣功力
};

// 4. 精力值修正係數 (保持不變)
function getStaminaModifier(stamina) {
    if (stamina >= 95) return { success: 1.1, disaster: 0.5 }; // 精力充沛
    if (stamina >= 90) return { success: 1.0, disaster: 1.0 };  // 狀態良好
    if (stamina >= 80) return { success: 0.9, disaster: 1.2 };  // 勉強合格
    return { success: 0.5, disaster: 2.0 }; // 狀態極差 (理論上不會觸發)
}

/**
 * 【核心修改】引入邊際效應遞減函式
 * 使用對數函式來模擬收益遞減，避免長時間閉關收益過於線性。
 * @param {number} days - 閉關天數
 * @returns {number} - 總天數的效益乘數
 */
function getDiminishingReturnsMultiplier(days) {
    // 這個公式確保前幾天的收益接近100%，之後慢慢降低
    // 例如：1天≈1, 7天≈4.5, 30天≈12, 60天≈18
    if (days <= 0) return 0;
    // 使用 Math.log1p(days) = Math.log(1 + days) 來確保 days 為 0 時結果正確
    // 乘數 2.5 是一個可調整的平衡係數
    return Math.log1p(days) * 2.5 + (days / 10);
}


/**
 * 主計算函式 v2.0：根據閉關天數和玩家狀態，預先計算出本次閉關的最終結果。
 * @param {number} days - 閉關天數
 * @param {object} playerProfile - 玩家的完整檔案
 * @param {object} skillToPractice - 玩家選擇修練的武學檔案
 * @returns {{outcome: string, expChange: number, powerChange: object, storyHint: string}}
 */
function calculateCultivationOutcome(days, playerProfile, skillToPractice) {
    const stamina = playerProfile.stamina || 80;
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
    
    // 【核心修改】使用新的邊際效應乘數來計算總收益
    const multiplier = getDiminishingReturnsMultiplier(days);
    const expChange = Math.round((DAILY_BASE_EXP[outcome] || 0) * multiplier);
    const powerGain = Math.round((DAILY_BASE_POWER_GAIN[outcome] || 0) * multiplier);

    const powerChange = { internal: 0, external: 0, lightness: 0 };
    const powerType = skillToPractice?.power_type || 'external';
    
    if (['internal', 'external', 'lightness'].includes(powerType)) {
        powerChange[powerType] = powerGain;
    }
    
    const storyHints = {
        GREAT_SUCCESS: `主角天賦異稟，在為期${days}天的閉關中，不僅完全領悟了「${skillToPractice.skillName}」的精髓，更感到一股強大的力量在體內覺醒，功力大增。`,
        SUCCESS: `經過${days}天的潛心修練，主角對「${skillToPractice.skillName}」的理解又深了一層，招式更加純熟，感覺有所精進。`,
        NO_PROGRESS: `這${days}天裡，主角心浮氣躁，始終無法進入物我兩忘的境界，對「${skillToPractice.skillName}」的修練似乎沒有任何進展。`,
        DISASTER: `在修練「${skillToPractice.skillName}」的緊要關頭，主角突然感到一陣心悸，氣血翻湧，真氣逆行，顯然是走火入魔的徵兆！功力不進反退。`
    };

    return {
        outcome,
        expChange,
        powerChange,
        storyHint: storyHints[outcome]
    };
}

module.exports = {
    calculateCultivationOutcome,
    CULTIVATION_CHANCES,
    DAILY_BASE_EXP,
    DAILY_BASE_POWER_GAIN
};
