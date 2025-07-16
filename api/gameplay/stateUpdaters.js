// /api/gameplay/stateUpdaters.js
const admin = require('firebase-admin');
const { getAISummary, getAIRandomEvent } = require('../../services/aiService');
const { updateFriendlinessValues, updateRomanceValues, processNpcUpdates, updateNpcMemoryAfterInteraction } = require('../npcHelpers');
const { updateSkills, getRawInventory, calculateBulkScore, getPlayerSkills } = require('../playerStateHelpers');
const { TIME_SEQUENCE, advanceDate, invalidateNovelCache, updateLibraryNovel } = require('../worldStateHelpers');
const { processLocationUpdates } = require('../locationManager');
const { processItemChanges } = require('../itemManager');
const { calculateNewStamina } = require('./staminaManager');

const db = admin.firestore();

/**
 * 【核心重構 v4.0 - 原子化與精簡化】
 * 使用單一 Firestore 事務來更新所有遊戲狀態，並返回精簡後的數據給前端。
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 * @param {object} player - 當前回合開始前的玩家數據
 * @param {string} playerAction - 玩家的原始行動指令
 * @param {object} aiResponse - AI生成的回應
 * @param {number} newRoundNumber - 新的回合數
 * @returns {Promise<object>} - 返回處理後、準備發送給前端的精簡回合數據
 */
async function updateGameState(userId, username, player, playerAction, aiResponse, newRoundNumber) {
    const userDocRef = db.collection('users').doc(userId);
    const summaryDocRef = userDocRef.collection('game_state').doc('summary');
    const newSaveRef = userDocRef.collection('game_saves').doc(`R${newRoundNumber}`);

    const safeRoundData = aiResponse.roundData || {};
    const { 
        story = aiResponse.story || '時間悄然流逝...',
        playerState = 'alive', powerChange = {}, moralityChange = 0, itemChanges = [], 
        skillChanges = [], romanceChanges = [], npcUpdates = [], locationUpdates = [],
        ATM = [''], EVT = '江湖軼事', LOC = player.currentLocation || ['未知之地'], 
        PSY = '心如止水', PC = '安然無恙', NPC = [], QST = '', WRD = '晴朗', LOR = '', 
        CLS = '', IMP = '你的行動似乎沒有產生什麼特別的影響。',
        timeOfDay: aiNextTimeOfDay, daysToAdvance = 0
    } = safeRoundData;
    
    // 1. 執行所有不會寫入資料庫的純計算和AI呼叫
    const { levelUpEvents, customSkillCreationResult } = await updateSkills(userId, skillChanges, player);
    let finalStory = story;
    if (customSkillCreationResult && !customSkillCreationResult.success) {
        finalStory = customSkillCreationResult.reason;
        if(skillChanges.some(s => s.isNewlyAcquired)) skillChanges.length = 0;
    }
    if (levelUpEvents.length > 0) {
        finalStory += `\n\n(你感覺到自己的${levelUpEvents.map(e => `「${e.skillName}」`).join('、')}境界似乎有所精進。)`;
    }

    const newStamina = calculateNewStamina(player, playerAction, safeRoundData);
    const timeDidAdvance = (daysToAdvance > 0) || (aiNextTimeOfDay && aiNextTimeOfDay !== player.currentTimeOfDay);
    const isRecoveryAction = ['睡覺', '休息', '歇息', '打坐', '進食', '喝水', '療傷', '丹藥', '求救', '小歇', '歇會', '躺一下', '坐一下'].some(kw => playerAction.includes(kw));
    let shortActionCounter = player.shortActionCounter || 0;
    if (!timeDidAdvance && !isRecoveryAction) shortActionCounter++; else shortActionCounter = 0;
    
    let finalTimeOfDay = aiNextTimeOfDay || player.currentTimeOfDay || '上午';
    let finalDate = { year: player.year || 1, month: player.month || 1, day: player.day || 1, yearName: player.yearName || '元祐' };
    let daysToAdd = daysToAdvance;
    if (shortActionCounter >= 3) {
        const currentTimeIndex = TIME_SEQUENCE.indexOf(finalTimeOfDay);
        const nextTimeIndex = (currentTimeIndex + 1) % TIME_SEQUENCE.length;
        finalTimeOfDay = TIME_SEQUENCE[nextTimeIndex];
        if (nextTimeIndex === 0) daysToAdd++;
        shortActionCounter = 0;
    }
    for (let i = 0; i < daysToAdd; i++) finalDate = advanceDate(finalDate);

    // 【存檔精簡化】只儲存最核心的指針和變化量
    const finalSaveData = { 
        story: finalStory, R: newRoundNumber, timeOfDay: finalTimeOfDay, ...finalDate,
        playerState, powerChange, moralityChange, itemChanges, skillChanges, romanceChanges, 
        npcUpdates, locationUpdates, ATM, EVT, LOC, PSY, PC, NPC, QST, WRD, LOR, CLS, IMP, stamina: newStamina
    };

    // 2. 獲取更新後的長期記憶 (這也需要在事務之外完成)
    const longTermSummary = (await summaryDocRef.get()).data()?.text || '遊戲剛剛開始...';
    const newSummary = await getAISummary(longTermSummary, finalSaveData);

    // 3. 【原子化操作】執行單一的Firestore事務
    await db.runTransaction(async (transaction) => {
        // --- 開始寫入 ---
        // a. 寫入新的、精簡後的回合存檔
        transaction.set(newSaveRef, finalSaveData);
        
        // b. 更新玩家核心屬性
        const newInternalPower = (player.internalPower || 0) + (powerChange?.internal || 0);
        const newExternalPower = (player.externalPower || 0) + (powerChange?.external || 0);
        const newLightnessPower = (player.lightness || 0) + (powerChange?.lightness || 0);
        const playerUpdates = {
            timeOfDay: finalTimeOfDay, stamina: newStamina, shortActionCounter, ...finalDate,
            currentLocation: LOC,
            internalPower: newInternalPower,
            externalPower: newExternalPower,
            lightness: newLightnessPower,
            maxInternalPowerAchieved: Math.max(player.maxInternalPowerAchieved || 0, newInternalPower),
            maxExternalPowerAchieved: Math.max(player.maxExternalPowerAchieved || 0, newExternalPower),
            maxLightnessAchieved: Math.max(player.maxLightnessAchieved || 0, newLightnessPower),
            morality: admin.firestore.FieldValue.increment(Number(moralityChange || 0)),
            R: newRoundNumber
        };
        transaction.update(userDocRef, playerUpdates);

        // c. 更新長期記憶
        transaction.set(summaryDocRef, { text: newSummary, lastUpdated: newRoundNumber }, { merge: true });

        // d. 處理物品變化 (processItemChanges現在應接受transaction)
        await processItemChanges(userId, itemChanges, transaction, finalSaveData);
        
        // e. 處理NPC友好度、狀態更新等 (這些函式也需修改以接受transaction)
        await updateFriendlinessValues(userId, username, NPC, finalSaveData, player, transaction);
        await updateRomanceValues(userId, romanceChanges, transaction);
        await processNpcUpdates(userId, npcUpdates, transaction);
        if (locationUpdates && finalSaveData.LOC[0]) {
            await processLocationUpdates(userId, finalSaveData.LOC[0], locationUpdates, transaction);
        }
    });
    console.log(`[核心事務] R${newRoundNumber} 的所有數據已在單一事務中成功提交。`);

    // 4. 處理非關鍵性的背景任務
    if (NPC && Array.isArray(NPC)) {
        NPC.filter(npc => npc.status).forEach(npc => {
            const interactionContext = `事件：「${EVT}」。\n經過：${story}\n我在事件中的狀態是：「${npc.status}」。`;
            updateNpcMemoryAfterInteraction(userId, npc.name, interactionContext).catch(err => console.error(`[背景任務] 更新NPC ${npc.name} 記憶時出錯:`, err));
        });
    }
    invalidateNovelCache(userId).catch(e => console.error("背景任務失敗: 無效化小說快取", e));
    updateLibraryNovel(userId, username).catch(e => console.error("背景任務失敗: 更新圖書館", e));

    // 5. 【前端水合】準備回傳給前端的精簡數據包
    const finalRoundDataForClient = {
        ...finalSaveData, // 回傳精簡後的存檔
    };

    return finalRoundDataForClient;
}

module.exports = { updateGameState };
