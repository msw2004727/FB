// /api/gameplay/preActionChecks.js
const { TIME_SEQUENCE, advanceDate, invalidateNovelCache, updateLibraryNovel, getMergedLocationData } = require('../worldStateHelpers');
// 【核心修正】從 playerStateHelpers 中，補上對 getInventoryState 的引用
const { getRawInventory, getPlayerSkills, calculateBulkScore, getInventoryState } = require('../playerStateHelpers');
const beggarService = require('../../services/beggarService');
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 處理玩家精力為零時的強制昏迷事件
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {object} player - 玩家數據
 * @param {number} newRoundNumber - 新的回合數
 * @returns {Promise<boolean>} - 如果事件被觸發並處理，返回 true
 */
async function handleStaminaDepletion(req, res, player, newRoundNumber) {
    const { id: userId, username } = req.user;
    const { action: playerAction } = req.body;
    
    const recoveryKeywords = ['睡覺', '休息', '歇息', '進食', '喝水', '打坐', '療傷', '丹藥', '求救', '小歇', '歇會', '躺一下', '坐一下'];
    const isTryingToRecover = recoveryKeywords.some(kw => playerAction.includes(kw));

    if ((player.stamina || 0) > 0 || isTryingToRecover) {
        return false;
    }

    console.log(`[精力系統] 玩家精力為零 (${player.stamina})，強制觸發昏迷事件。`);
    
    const userDocRef = db.collection('users').doc(userId);
    const currentTimeIndex = TIME_SEQUENCE.indexOf(player.timeOfDay);
    const nextTimeIndex = (currentTimeIndex + 1) % TIME_SEQUENCE.length;
    const newTimeOfDay = TIME_SEQUENCE[nextTimeIndex];
    let newDate = { year: player.year, month: player.month, day: player.day, yearName: player.yearName };
    if (nextTimeIndex === 0) {
        newDate = advanceDate(newDate);
    }

    const comaStory = `你試圖繼續行動，但眼前猛地一黑，身體再也支撐不住，直挺挺地倒了下去，徹底失去了意識。不知過了多久，你才悠悠轉醒，發現時間已經悄然流逝。`;

    const finalSaveData = {
        story: comaStory,
        PC: "你因體力不支而昏倒，醒來後體力已完全恢復。",
        EVT: "體力耗盡而昏迷",
        R: newRoundNumber,
        timeOfDay: newTimeOfDay,
        ...newDate,
        stamina: 100,
        moneyChange: 0, powerChange: {}, itemChanges: [], skillChanges: [], romanceChanges: [], npcUpdates: [], locationUpdates: [],
        LOC: player.currentLocation || ['未知之地'],
        NPC: player.NPC || [],
    };

    await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(finalSaveData);
    await userDocRef.update({ stamina: 100, timeOfDay: newTimeOfDay, ...newDate, R: newRoundNumber });

    const [fullInventory, updatedSkills, locationData] = await Promise.all([
        getRawInventory(userId),
        getPlayerSkills(userId),
        getMergedLocationData(userId, finalSaveData.LOC)
    ]);
    
    const finalRoundDataForClient = { ...finalSaveData, skills: updatedSkills, inventory: fullInventory, money: player.money || 0, bulkScore: calculateBulkScore(fullInventory), suggestion: "你大病初癒，最好先查看一下自身狀態。" };

    res.json({ story: comaStory, roundData: finalRoundDataForClient, suggestion: "你大病初癒，最好先查看一下自身狀態。", locationData });
    
    invalidateNovelCache(userId).catch(e => console.error("背景任務失敗(昏迷): 無效化小說快取", e));
    updateLibraryNovel(userId, username).catch(e => console.error("背景任務失敗(昏迷): 更新圖書館", e));

    return true; // 事件已處理
}

/**
 * 處理呼叫丐幫的指令
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<boolean>} - 如果事件被觸發並處理，返回 true
 */
async function handleBeggarSummon(req, res) {
    const { id: userId, username } = req.user;
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

    res.json({ story: tempRoundData.story, roundData: tempRoundData, suggestion: tempRoundData.suggestion, locationData: await getMergedLocationData(userId, tempRoundData.LOC) });

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
    if (await handleStaminaDepletion(req, res, player, newRoundNumber)) {
        return true;
    }
    if (await handleBeggarSummon(req, res)) {
        return true;
    }
    return false;
}

module.exports = { handlePreActionChecks };
