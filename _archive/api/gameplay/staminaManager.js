// /api/gameplay/staminaManager.js
const admin = require('firebase-admin');
const { TIME_SEQUENCE, advanceDate, invalidateNovelCache, updateLibraryNovel, getMergedLocationData } = require('../worldStateHelpers');
const { getRawInventory, getPlayerSkills, calculateBulkScore } = require('../playerStateHelpers');

const db = admin.firestore();

/**
 * 計算玩家行動後的新精力值
 * @param {object} player - 當前回合開始前的玩家數據
 * @param {string} playerAction - 玩家的原始行動指令
 * @param {object} roundData - 從AI獲取的回合數據
 * @returns {number} - 返回計算後的新精力值
 */
function calculateNewStamina(player, playerAction, roundData) {
    const { staminaChange = 0, daysToAdvance = 0, timeOfDay: aiNextTimeOfDay } = roundData;
    const timeDidAdvance = (daysToAdvance > 0) || (aiNextTimeOfDay && aiNextTimeOfDay !== player.currentTimeOfDay);
    
    const recoveryKeywords = ['睡覺', '休息', '歇息', '打坐', '進食', '喝水', '療傷', '丹藥', '求救', '小歇', '歇會', '躺一下', '坐一下'];
    const isRecoveryAction = recoveryKeywords.some(kw => playerAction.includes(kw));

    let newStamina = player.stamina ?? 100;

    if (isRecoveryAction) {
        // 【核心修正 v2.0】修改精力恢復的計算方式
        if (daysToAdvance > 0) {
            // 規則 3: 跨日長眠，精力完全恢復
            newStamina = 100;
            console.log(`[精力系統 v2.0] 進行了跨日長眠，精力完全恢復。`);
        } else if (timeDidAdvance) {
            // 規則 2: 時段小憩，恢復 40 點精力
            newStamina += 40;
            console.log(`[精力系統 v2.0] 進行了時辰小憩，恢復40點精力。`);
        } else {
            // 規則 1: 回合調息，恢復 15 點精力
            newStamina += 15;
            console.log(`[精力系統 v2.0] 進行了回合調息，恢復15點精力。`);
        }
    } else {
        // 非恢復性活動：應用AI的精力變化，並扣除基礎消耗
        newStamina += (staminaChange || 0);
        newStamina -= (Math.floor(Math.random() * 5) + 1); // 基礎消耗1-5點
    }

    return Math.max(0, Math.min(100, newStamina)); // 確保精力在 0-100 之間
}


/**
 * 檢查並處理玩家精力耗盡的情況
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {object} player - 玩家數據
 * @param {number} newRoundNumber - 新的回合數
 * @returns {Promise<boolean>} - 如果事件被觸發並處理，返回 true
 */
async function checkAndHandleStaminaDepletion(req, res, player, newRoundNumber) {
    const { id: userId, username } = req.user;
    const { action: playerAction } = req.body;
    
    const recoveryKeywords = ['睡覺', '休息', '歇息', '進食', '喝水', '打坐', '療傷', '丹藥', '求救', '小歇', '歇會', '躺一下', '坐一下'];
    const isTryingToRecover = recoveryKeywords.some(kw => playerAction.includes(kw));

    if ((player.stamina || 0) > 0 || isTryingToRecover) {
        return false;
    }

    console.log(`[精力總管] 玩家精力為零 (${player.stamina})，強制觸發昏迷事件。`);
    
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

module.exports = {
    calculateNewStamina,
    checkAndHandleStaminaDepletion
};
