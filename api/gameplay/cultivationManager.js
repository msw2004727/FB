// api/gameplay/cultivationManager.js

const { getPlayerSkills, getRawInventory } = require('../playerStateHelpers');
const { getMergedLocationData } = require('../worldStateHelpers');
const { calculateCultivationOutcome } = require('../config/cultivationFormulas');
const { getAICultivationResult } = require('../../services/aiService');
const { processItemChanges } = require('../itemManager');

/**
 * 【核心修正】移除舊的、有問題的文字解析函式
 */
/*
function parseCultivationDays(playerAction) {
    // ... old code removed ...
}
*/

/**
 * 【輔助】從玩家指令和已學技能中，找出要修練的目標
 * @param {string} playerAction - 玩家的原始指令
 * @param {Array<object>} playerSkills - 玩家已學會的技能列表
 * @returns {object|null} - 找到的技能物件，或null
 */
function findSkillToPractice(playerAction, playerSkills) {
    const foundSkills = playerSkills.filter(skill => playerAction.includes(skill.skillName));

    if (foundSkills.length === 1) {
        return foundSkills[0];
    }
    if (foundSkills.length > 1) {
        return { error: 'multiple_skills_mentioned', skills: foundSkills };
    }
    return null;
}


/**
 * 【核心】處理閉關修練請求的總控制器 v2.4
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 * @param {object} playerProfile - 當前的玩家完整檔案
 * @param {string} skillToPracticeName - 要修練的武學名稱
 * @param {number} days - 閉關天數
 * @returns {Promise<{success: boolean, message: string, data: object|null}>}
 */
async function handleCultivation(userId, username, playerProfile, skillToPracticeName, days) {
    console.log(`[閉關系統 v2.4] 玩家 ${username} 請求閉關修練「${skillToPracticeName}」，時長 ${days} 天。`);

    // --- 1. 武學有效性判斷 ---
    const playerSkills = await getPlayerSkills(userId);
    const skillToPractice = playerSkills.find(skill => skill.skillName === skillToPracticeName);

    if (!skillToPractice) {
        console.error(`[閉關系統] 錯誤：玩家 ${username} 試圖修練一個他不會的武學「${skillToPracticeName}」。`);
        return { success: false, message: `你尚未學會「${skillToPracticeName}」，無法進行閉關修練。`, data: null };
    }

    // --- 2. 前置條件檢查 ---
    const locationContext = await getMergedLocationData(userId, playerProfile.currentLocation);
    if (!locationContext || !locationContext.isPrivate) {
        return { success: false, message: "此地人多嘴雜，非是靜修的絕佳之所，還是換個地方吧。", data: null };
    }
    if ((playerProfile.stamina || 0) < 80) {
        return { success: false, message: "你現在身心俱疲，強行閉關恐有不測，還是先歇息一番吧。", data: null };
    }

    const inventory = await getRawInventory(userId);
    const foodItems = inventory.filter(item => item.category === '食物');
    const drinkItems = inventory.filter(item => item.category === '飲品');
    const totalFood = foodItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
    const totalDrinks = drinkItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
    if (totalFood < days || totalDrinks < days) {
        return { success: false, message: `糧食飲水不足，無法支撐長達 ${days} 天的閉關。`, data: null };
    }

    // --- 3. 準備資源扣除列表 ---
    const itemsToRemove = [];
    let foodRemoved = 0;
    for (const item of foodItems) {
        if (foodRemoved >= days) break;
        const canRemove = Math.min(item.quantity, days - foodRemoved);
        itemsToRemove.push({ action: 'remove', itemName: item.itemName, quantity: canRemove });
        foodRemoved += canRemove;
    }
    let drinksRemoved = 0;
    for (const item of drinkItems) {
        if (drinksRemoved >= days) break;
        const canRemove = Math.min(item.quantity, days - drinksRemoved);
        itemsToRemove.push({ action: 'remove', itemName: item.itemName, quantity: canRemove });
        drinksRemoved += canRemove;
    }

    // --- 4. 預計算閉關結果 ---
    const { outcome, expChange, powerChange, storyHint } = calculateCultivationOutcome(days, playerProfile, skillToPractice);
    console.log(`[閉關系統] 預計算結果: ${outcome}, 經驗變化: ${expChange}, 功力變化:`, powerChange);
    
    // --- 5. AI生成故事 ---
    const cultivationStory = await getAICultivationResult(username, playerProfile, skillToPractice, days, outcome, storyHint);

    // --- 6. 構造新回合數據 ---
    const roundData = {
        story: cultivationStory,
        playerState: 'alive',
        daysToAdvance: days,
        itemChanges: itemsToRemove,
        skillChanges: [{
            isNewlyAcquired: false,
            skillName: skillToPractice.skillName,
            expChange: expChange
        }],
        powerChange: powerChange,
        stamina: 100, // 閉關後精力充沛
        EVT: `閉關修練「${skillToPractice.skillName}」`,
        PC: `經過${days}日苦修，你對「${skillToPractice.skillName}」的領悟更深一層。`,
        moralityChange: 0,
        romanceChanges: [],
        npcUpdates: [],
        locationUpdates: [],
        ATM: ['寂靜', '潛心修練'],
        LOC: playerProfile.currentLocation,
        PSY: '潛心修練，不問世事。',
        NPC: [], // 閉關期間通常不會遇到NPC
        QST: '',
        WRD: '晴朗', // 閉關期間天氣可簡化
        LOR: '',
        CLS: '',
        IMP: `你花費了${days}天時間進行閉關修練。`
    };

    return { success: true, message: '閉關流程已成功計算完畢。', data: roundData };
}

module.exports = {
    handleCultivation
};
