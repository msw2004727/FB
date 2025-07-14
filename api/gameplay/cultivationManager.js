// api/gameplay/cultivationManager.js

const { getPlayerSkills, getRawInventory } = require('../playerStateHelpers');
const { getMergedLocationData } = require('../worldStateHelpers');
const { calculateCultivationOutcome } = require('../config/cultivationFormulas');
const { getAICultivationResult } = require('../../services/aiService');
const { processItemChanges } = require('../itemManager');

/**
 * 【輔助】從玩家指令中解析閉關天數
 * @param {string} playerAction - 玩家的原始指令
 * @returns {number} - 閉關天數，預設為1
 */
function parseCultivationDays(playerAction) {
    const timeUnits = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    const dayKeyword = '日';

    const dayMatch = playerAction.match(new RegExp(`([一二三四五六七八九十]+)${dayKeyword}`));
    if (dayMatch && dayMatch[1] && timeUnits[dayMatch[1]]) {
        return timeUnits[dayMatch[1]];
    }
    // 如果沒有指定天數，預設為閉關一天
    return 1;
}

/**
 * 【輔助】從玩家指令和已學技能中，找出要修練的目標
 * @param {string} playerAction - 玩家的原始指令
 * @param {Array<object>} playerSkills - 玩家已學會的技能列表
 * @returns {object|null} - 找到的技能物件，或null
 */
function findSkillToPractice(playerAction, playerSkills) {
    const foundSkills = playerSkills.filter(skill => playerAction.includes(skill.skillName));

    if (foundSkills.length === 1) {
        // 如果指令中明確提到了玩家已會的一門武學，就返回它
        return foundSkills[0];
    }
    if (foundSkills.length > 1) {
        // 如果同時提到了多門武學，返回一個錯誤標記
        return { error: 'multiple_skills_mentioned', skills: foundSkills };
    }
    // 如果沒有提到任何已會的武學，返回 null
    return null;
}


/**
 * 【核心】處理閉關修練請求的總控制器 v2.3
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 * @param {object} playerProfile - 當前的玩家完整檔案
 * @param {string} playerAction - 玩家的原始指令
 * @returns {Promise<{success: boolean, message: string, data: object|null}>}
 */
async function handleCultivation(userId, username, playerProfile, playerAction) {
    const days = parseCultivationDays(playerAction);
    console.log(`[閉關系統] 玩家 ${username} 請求閉關 ${days} 天，原始指令：「${playerAction}」。`);

    // --- 1. 武學智慧判斷 2.0 ---
    const playerSkills = await getPlayerSkills(userId);
    let skillToPractice = findSkillToPractice(playerAction, playerSkills);

    if (skillToPractice && skillToPractice.error) {
        const skillList = skillToPractice.skills.map(s => `「${s.skillName}」`).join('、');
        return { success: false, message: `你試圖同時修練 ${skillList}，真氣在體內亂竄，無法集中。請一次只專心修練一門武學。`, data: null };
    }

    if (!skillToPractice) {
        if (playerSkills.length === 0) {
            return { success: false, message: "你身無長技，不知從何練起。", data: null };
        }
        if (playerSkills.length === 1) {
            skillToPractice = playerSkills[0];
            console.log(`[閉關系統] 玩家未指定武學，自動選擇其唯一的武學：「${skillToPractice.skillName}」。`);
        } else {
            const skillList = playerSkills.map(s => `「${s.skillName}」`).join('、');
            // 【核心修改】提供帶有範例的錯誤訊息
            const exampleCommand = `例如：「閉關修練${playerSkills[0].skillName}」`;
            return { success: false, message: `你身負數門絕學 (${skillList})，請明確指定要修練哪一門。\n\n${exampleCommand}`, data: null };
        }
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
    const cultivationStory = await getAICultivationResult(playerProfile, skillToPractice, days, outcome, storyHint);

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
