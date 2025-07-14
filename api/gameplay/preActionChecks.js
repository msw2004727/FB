// /api/gameplay/preActionChecks.js
const { getRawInventory, getPlayerSkills, calculateBulkScore, getInventoryState } = require('../playerStateHelpers');
const { checkAndHandleStaminaDepletion } = require('./staminaManager'); 
const beggarService = require('../../services/beggarService');
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 處理呼叫丐幫的指令
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<boolean>} - 如果事件被觸發並處理，返回 true
 */
async function handleBeggarSummon(req, res) {
    const { id: userId } = req.user;
    const { action: playerAction } = req.body;
    const beggarKeywords = ['丐幫', '乞丐', '打聽', '消息', '情報'];
    
    if (!beggarKeywords.some(keyword => playerAction.includes(keyword))) {
        return false;
    }

    console.log('[丐幫系統] 偵測到呼叫關鍵字，啟動丐幫互動。');
    
    const summonResult = await beggarService.handleBeggarSummon(userId);
    const [lastSaveSnapshot, inventoryState, fullInventory] = await Promise.all([
        db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get(),
        getInventoryState(userId),
        getRawInventory(userId)
    ]);

    if (lastSaveSnapshot.empty) {
        res.status(404).json({ message: '找不到存檔紀錄，無法呼叫丐幫。' });
        return true;
    }

    const lastRoundData = lastSaveSnapshot.docs[0].data();
    const tempRoundData = {
        ...lastRoundData,
        money: inventoryState.money || 0,
        ITM: inventoryState.itemsString,
        inventory: fullInventory,
        bulkScore: calculateBulkScore(fullInventory),
        story: summonResult.appearanceStory,
        PC: '你發出的暗號得到了回應，一個丐幫弟子出現在你面前。',
        EVT: '丐幫弟子現身',
        suggestion: `要向「${summonResult.beggarName}」打聽些什麼嗎？`,
        NPC: [ ...lastRoundData.NPC.filter(npc => !npc.isDeceased), { name: summonResult.beggarName, status: "一個衣衫襤褸、渾身散發酸臭味的乞丐悄悄湊到你身邊。", status_title: "丐幫弟子", friendliness: 'neutral', isTemp: true } ]
    };

    res.json({ story: tempRoundData.story, roundData: tempRoundData, suggestion: tempRoundData.suggestion, locationData: await require('../worldStateHelpers').getMergedLocationData(userId, tempRoundData.LOC) });

    return true; // 事件已處理
}


/**
 * 執行所有行動前的預先檢查
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {object} player - 玩家數據
 * @param {number} newRoundNumber - 新的回合數
 * @returns {Promise<boolean>} - 如果有任何預先檢查處理了請求，返回 true，否則返回 false
 */
async function handlePreActionChecks(req, res, player, newRoundNumber) {
    // 檢查精力耗盡的情況
    if (await checkAndHandleStaminaDepletion(req, res, player, newRoundNumber)) {
        return true;
    }

    // 【核心修改】將丐幫召喚功能關閉
    // if (await handleBeggarSummon(req, res)) {
    //     return true;
    // }
    
    return false;
}

module.exports = { handlePreActionChecks };
