// api/gameplay/cultivationManager.js

const { getPlayerSkills, getRawInventory, updateInventory } = require('../playerStateHelpers');
const { getMergedLocationData } = require('../worldStateHelpers');
const { calculateCultivationOutcome } = require('../config/cultivationFormulas');
const { getAICultivationResult } = require('../../services/aiService'); // 注意：這個函式我們稍後才會在aiService.js中建立

/**
 * 【核心】處理閉關修練請求的總控制器
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 * @param {object} playerProfile - 當前的玩家完整檔案
 * @param {number} days - 閉關天數
 * @param {string} skillName - 預計修練的武學名稱
 * @returns {Promise<{success: boolean, message: string, data: object|null}>}
 */
async function handleCultivation(userId, username, playerProfile, days, skillName) {
    console.log(`[閉關系統] 玩家 ${username} 請求閉關 ${days} 天，修練「${skillName}」。`);

    // --- 1. 前置條件檢查 ---
    const locationContext = await getMergedLocationData(userId, playerProfile.currentLocation);

    // 1a. 地點檢查
    if (!locationContext || !locationContext.isPrivate) {
        return { success: false, message: "此地人多嘴雜，非是靜修的絕佳之所，還是換個地方吧。", data: null };
    }

    // 1b. 精力檢查
    if ((playerProfile.stamina || 0) < 80) {
        return { success: false, message: "你現在身心俱疲，強行閉關恐有不測，還是先歇息一番吧。", data: null };
    }

    // 1c. 資源檢查
    const inventory = await getRawInventory(userId);
    const foodItems = inventory.filter(item => item.category === '食物');
    const drinkItems = inventory.filter(item => item.category === '飲品');
    const totalFood = foodItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
    const totalDrinks = drinkItems.reduce((sum, item) => sum + (item.quantity || 0), 0);

    if (totalFood < days || totalDrinks < days) {
        return { success: false, message: `糧食飲水不足，無法支撐長達 ${days} 天的閉關。`, data: null };
    }
    
    // 1d. 武學檢查
    const playerSkills = await getPlayerSkills(userId);
    const skillToPractice = playerSkills.find(s => s.skillName === skillName);
    if (!skillToPractice) {
        return { success: false, message: `你尚未習得「${skillName}」，無法進行修練。`, data: null };
    }

    // --- 2. 扣除資源 ---
    // 這裡我們只準備好要扣除的物品列表，實際的資料庫操作會在最後統一處理
    const itemsToRemove = [];
    let foodRemoved = 0;
    for (const item of foodItems) {
        const needed = days - foodRemoved;
        const toRemove = Math.min(item.quantity, needed);
        itemsToRemove.push({ action: 'remove', itemName: item.itemName, quantity: toRemove });
        foodRemoved += toRemove;
        if (foodRemoved >= days) break;
    }
    let drinksRemoved = 0;
    for (const item of drinkItems) {
        const needed = days - drinksRemoved;
        const toRemove = Math.min(item.quantity, needed);
        itemsToRemove.push({ action: 'remove', itemName: item.itemName, quantity: toRemove });
        drinksRemoved += toRemove;
        if (drinksRemoved >= days) break;
    }

    // --- 3. 預計算閉關結果 ---
    const { outcome, expChange, powerChange, storyHint } = calculateCultivationOutcome(days, playerProfile, skillToPractice);
    console.log(`[閉關系統] 預計算結果: ${outcome}, 經驗變化: ${expChange}, 功力變化:`, powerChange);
    
    // --- 4. AI生成故事 ---
    // 我們將後端預計算的結果和提示，一同交給AI，讓它圍繞這個「劇本」來創作
    const cultivationStory = await getAICultivationResult(playerProfile, skillToPractice, days, outcome, storyHint);

    // --- 5. 構造新回合數據 ---
    const roundData = {
        story: cultivationStory,
        playerState: 'alive',
        daysToAdvance: days, // 直接告訴主流程要推進幾天
        itemChanges: itemsToRemove,
        skillChanges: [{
            isNewlyAcquired: false,
            skillName: skillToPractice.skillName,
            expChange: expChange
        }],
        powerChange: powerChange,
        EVT: `閉關修練「${skillToPractice.skillName}」`,
        PC: `經過${days}日苦修，你對「${skillToPractice.skillName}」的領悟更深一層。`,
        // 將其他必要欄位設置為預設值
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
