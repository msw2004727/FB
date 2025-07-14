// api/config/cultivationFormulas.js

/**
 * 閉關修練系統 - 核心數值與公式設定檔
 * =================================================================
 * 此檔案定義了閉關修練的所有遊戲平衡相關參數。
 * 調整此處的數值，即可直接影響閉關的收益與風險。
 * =================================================================
 */

// 1. 閉關結果的基礎機率 (總和應為 1.0)
const CULTIVATION_CHANCES = {
    GREAT_SUCCESS: 0.15, // 15% 機率大功告成
    SUCCESS: 0.60,       // 60% 機率略有小成
    NO_PROGRESS: 0.20,   // 20% 機率毫無進展
    DISASTER: 0.05       // 5% 機率走火入魔
};

// 2. 閉關每日基礎經驗值 (會再乘上閉關天數)
const DAILY_BASE_EXP = {
    GREAT_SUCCESS: 100,
    SUCCESS: 40,
    NO_PROGRESS: 0,
    DISASTER: -50 // 走火入魔會倒扣經驗
};

// 3. 閉關每日基礎功力值獎勵 (會再乘上閉關天數)
// 這裡的數值代表「潛力」，實際增加哪個功力值，取決於玩家修練的武學類型。
const DAILY_BASE_POWER_GAIN = {
    GREAT_SUCCESS: 5,
    SUCCESS: 2,
    NO_PROGRESS: 0,
    DISASTER: -3 // 走火入魔會倒扣功力
};

// 4. 精力值修正係數
// 閉關前的精力值會影響成功機率。
// 例如：精力95時，走火入魔機率會降低 (0.05 * 0.5 = 0.025)
// 精力80時，走火入魔機率會增加 (0.05 * 1.2 = 0.06)
function getStaminaModifier(stamina) {
    if (stamina >= 95) return { success: 1.1, disaster: 0.5 }; // 精力充沛
    if (stamina >= 90) return { success: 1.0, disaster: 1.0 };  // 狀態良好
    if (stamina >= 80) return { success: 0.9, disaster: 1.2 };  // 勉強合格
    return { success: 0.5, disaster: 2.0 }; // 狀態極差 (理論上不會觸發)
}

/**
 * 主計算函式：根據閉關天數和玩家狀態，預先計算出本次閉關的最終結果。
 * @param {number} days - 閉關天數
 * @param {object} playerProfile - 玩家的完整檔案
 * @param {object} skillToPractice - 玩家選擇修練的武學檔案
 * @returns {{outcome: string, expChange: number, powerChange: object, storyHint: string}}
 */
function calculateCultivationOutcome(days, playerProfile, skillToPractice) {
    const stamina = playerProfile.stamina || 80;
    const modifier = getStaminaModifier(stamina);

    // 根據精力修正機率
    const adjustedChances = {
        GREAT_SUCCESS: CULTIVATION_CHANCES.GREAT_SUCCESS * modifier.success,
        SUCCESS: CULTIVATION_CHANCES.SUCCESS * modifier.success,
        NO_PROGRESS: CULTIVATION_CHANCES.NO_PROGRESS,
        DISASTER: CULTIVATION_CHANCES.DISASTER * modifier.disaster
    };

    // 隨機判定結果
    const rand = Math.random();
    let cumulativeChance = 0;
    let outcome = 'NO_PROGRESS'; // 預設結果

    for (const [key, chance] of Object.entries(adjustedChances)) {
        cumulativeChance += chance;
        if (rand < cumulativeChance) {
            outcome = key;
            break;
        }
    }
    
    // 計算最終經驗與功力變化
    const expChange = (DAILY_BASE_EXP[outcome] || 0) * days;
    const powerGain = (DAILY_BASE_POWER_GAIN[outcome] || 0) * days;

    const powerChange = { internal: 0, external: 0, lightness: 0 };
    const powerType = skillToPractice?.power_type || 'external'; // 若無指定，預設為外功
    
    if (['internal', 'external', 'lightness'].includes(powerType)) {
        powerChange[powerType] = powerGain;
    }
    
    // 提供給 AI 的故事提示
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
    // 導出基礎設定，以備不時之需
    CULTIVATION_CHANCES,
    DAILY_BASE_EXP,
    DAILY_BASE_POWER_GAIN
};
