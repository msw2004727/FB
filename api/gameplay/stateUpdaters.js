// /api/gameplay/stateUpdaters.js
const admin = require('firebase-admin');
const { getAISummary } = require('../../services/aiService');
const { updateFriendlinessValues, updateRomanceValues, processNpcUpdates, updateNpcMemoryAfterInteraction } = require('../npcHelpers');
const { updateSkills, getRawInventory, calculateBulkScore, getPlayerSkills } = require('../playerStateHelpers');
const { TIME_SEQUENCE, advanceDate, invalidateNovelCache, updateLibraryNovel } = require('../worldStateHelpers');
const { processLocationUpdates } = require('../locationManager');
const { processItemChanges } = require('../itemManager');
const { calculateNewStamina } = require('./staminaManager');
const { addCurrency } = require('../economyManager');

const db = admin.firestore();

/**
 * 更新遊戲狀態並將所有更改寫入資料庫
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 * @param {object} player - 當前回合開始前的玩家數據
 * @param {string} playerAction - 玩家的原始行動指令
 * @param {object} aiResponse - AI生成的回應
 * @param {number} newRoundNumber - 新的回合數
 * @returns {Promise<object>} - 返回處理後、準備發送給前端的完整回合數據
 */
async function updateGameState(userId, username, player, playerAction, aiResponse, newRoundNumber) {
    const userDocRef = db.collection('users').doc(userId);
    const summaryDocRef = userDocRef.collection('game_state').doc('summary');

    // 【核心新增】黑影人出現日誌提醒
    if (aiResponse.story && (aiResponse.story.includes('黑影') || aiResponse.story.includes('影子'))) {
        console.log(`[!!!] 系統警示：神秘黑影人已在玩家 [${username}] 的第 ${newRoundNumber} 回合劇情中出現！`);
    }

    const safeRoundData = aiResponse.roundData;
    const { playerState = 'alive', powerChange = {}, moralityChange = 0, moneyChange = 0, itemChanges = [], skillChanges = [], romanceChanges = [], npcUpdates = [], locationUpdates = [], ATM = [''], EVT = '江湖軼事', LOC = player.currentLocation || ['未知之地'], PSY = '心如止水', PC = '安然無恙', NPC = [], QST = '', WRD = '晴朗', LOR = '', CLS = '', IMP = '你的行動似乎沒有產生什麼特別的影響。', timeOfDay: aiNextTimeOfDay, daysToAdvance = 0 } = safeRoundData;

    const { levelUpEvents, customSkillCreationResult } = await updateSkills(userId, skillChanges, player);
    if (customSkillCreationResult && !customSkillCreationResult.success) {
        aiResponse.story = customSkillCreationResult.reason;
        if(skillChanges.some(s => s.isNewlyAcquired)) {
             skillChanges.length = 0;
        }
    }
    if (levelUpEvents.length > 0) {
        aiResponse.story += `\n\n(你感覺到自己的${levelUpEvents.map(e => `「${e.skillName}」`).join('、')}境界似乎有所精進。)`;
    }
    
    const newStamina = calculateNewStamina(player, playerAction, safeRoundData);

    const timeDidAdvance = (daysToAdvance > 0) || (aiNextTimeOfDay && aiNextTimeOfDay !== player.currentTimeOfDay);
    const isRecoveryAction = ['睡覺', '休息', '歇息', '打坐', '進食', '喝水', '療傷', '丹藥', '求救', '小歇', '歇會', '躺一下', '坐一下'].some(kw => playerAction.includes(kw));
    let shortActionCounter = player.shortActionCounter || 0;
    if (!timeDidAdvance && !isRecoveryAction) shortActionCounter++; else shortActionCounter = 0;
    
    let finalTimeOfDay = aiNextTimeOfDay || player.currentTimeOfDay;
    let finalDate = { year: player.year, month: player.month, day: player.day, yearName: player.yearName };
    let daysToAdd = daysToAdvance;
    if (shortActionCounter >= 3) {
        const currentTimeIndex = TIME_SEQUENCE.indexOf(finalTimeOfDay);
        const nextTimeIndex = (currentTimeIndex + 1) % TIME_SEQUENCE.length;
        finalTimeOfDay = TIME_SEQUENCE[nextTimeIndex];
        if (nextTimeIndex === 0) daysToAdd++;
        shortActionCounter = 0;
    }
    for (let i = 0; i < daysToAdd; i++) finalDate = advanceDate(finalDate);

    const finalSaveData = { 
        story: aiResponse.story, R: newRoundNumber, timeOfDay: finalTimeOfDay, ...finalDate, stamina: newStamina,
        playerState, powerChange, moralityChange, moneyChange, itemChanges, skillChanges, romanceChanges, npcUpdates, locationUpdates,
        ATM, EVT, LOC, PSY, PC, NPC, QST, WRD, LOR, CLS, IMP
    };

    const newSaveRef = userDocRef.collection('game_saves').doc(`R${newRoundNumber}`);
    await newSaveRef.set(finalSaveData);
    console.log(`[存檔系統] 已成功寫入 R${newRoundNumber} 的存檔。`);

    const batch = db.batch();

    if (moneyChange > 0) {
        await addCurrency(userId, moneyChange, batch);
    } else if (moneyChange < 0) {
        console.warn(`[經濟系統] 偵測到一個負數的moneyChange (${moneyChange})，已被忽略。`);
    }

    await processItemChanges(userId, itemChanges, batch, finalSaveData);
    await updateFriendlinessValues(userId, username, NPC, finalSaveData, player, batch);
    await updateRomanceValues(userId, romanceChanges);
    await processNpcUpdates(userId, npcUpdates);
    if (locationUpdates && finalSaveData.LOC[0]) {
        await processLocationUpdates(userId, finalSaveData.LOC[0], locationUpdates);
    }

    const newInternalPower = (player.internalPower || 0) + (powerChange?.internal || 0);
    const newExternalPower = (player.externalPower || 0) + (powerChange?.external || 0);
    const newLightnessPower = (player.lightness || 0) + (powerChange?.lightness || 0);

    const playerUpdatesForDb = {
        timeOfDay: finalTimeOfDay,
        stamina: newStamina,
        shortActionCounter,
        ...finalDate,
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
    batch.update(userDocRef, playerUpdatesForDb);

    const longTermSummary = (await summaryDocRef.get()).data()?.text || '遊戲剛剛開始...';
    const newSummary = await getAISummary(longTermSummary, finalSaveData);
    batch.set(summaryDocRef, { text: newSummary, lastUpdated: newRoundNumber }, { merge: true });

    await batch.commit();
    console.log(`[數據同步] 玩家主檔案與長期記憶已同步至 R${newRoundNumber}。`);

    if (NPC && Array.isArray(NPC)) {
        NPC.filter(npc => npc.status).forEach(npc => {
            const interactionContext = `事件：「${EVT}」。\n經過：${aiResponse.story}\n我在事件中的狀態是：「${npc.status}」。`;
            updateNpcMemoryAfterInteraction(userId, npc.name, interactionContext).catch(err => console.error(`[背景任務] 更新NPC ${npc.name} 記憶時出錯:`, err));
        });
    }
    invalidateNovelCache(userId).catch(e => console.error("背景任務失敗: 無效化小說快取", e));
    updateLibraryNovel(userId, username).catch(e => console.error("背景任務失敗: 更新圖書館", e));

    const [fullInventory, updatedSkills, finalPlayerProfile] = await Promise.all([
        getRawInventory(userId),
        getPlayerSkills(userId),
        userDocRef.get().then(doc => doc.data()),
    ]);
    
    // 【核心修正】調整物件合併順序，確保 finalSaveData 中的最新時間戳不會被 finalPlayerProfile 的舊資料覆蓋。
    // 將 finalSaveData 放在後面，這樣它的屬性（如 year, month, day, timeOfDay）會覆蓋掉 finalPlayerProfile 中可能存在的舊值。
    return {
         ...finalPlayerProfile, 
         ...finalSaveData, 
         skills: updatedSkills, 
         inventory: fullInventory, 
         bulkScore: calculateBulkScore(fullInventory)
    };
}

module.exports = { updateGameState };
