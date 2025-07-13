// /api/gameplay/stateUpdaters.js
const admin = require('firebase-admin');
const { getAISummary } = require('../../services/aiService');
const { updateFriendlinessValues, updateRomanceValues, processNpcUpdates, updateNpcMemoryAfterInteraction } = require('../npcHelpers');
const { updateSkills, getRawInventory, calculateBulkScore, getPlayerSkills } = require('../playerStateHelpers');
const { TIME_SEQUENCE, advanceDate, invalidateNovelCache, updateLibraryNovel } = require('../worldStateHelpers');
const { processLocationUpdates } = require('../locationManager');
const { processItemChanges } = require('../itemManager');

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

    const safeRoundData = aiResponse.roundData;
    const playerState = safeRoundData.playerState || 'alive';
    const powerChange = safeRoundData.powerChange || { internal: 0, external: 0, lightness: 0 };
    const moralityChange = safeRoundData.moralityChange || 0;
    const moneyChange = safeRoundData.moneyChange || 0;
    const itemChanges = safeRoundData.itemChanges || [];
    const skillChanges = safeRoundData.skillChanges || [];
    const romanceChanges = safeRoundData.romanceChanges || [];
    const npcUpdates = safeRoundData.npcUpdates || [];
    const locationUpdates = safeRoundData.locationUpdates || [];
    const ATM = safeRoundData.ATM || [''];
    const EVT = safeRoundData.EVT || '江湖軼事';
    const LOC = safeRoundData.LOC || player.currentLocation || ['未知之地'];
    const PSY = safeRoundData.PSY || '心如止水';
    const PC = safeRoundData.PC || '安然無恙';
    const NPC = safeRoundData.NPC || [];
    const QST = safeRoundData.QST || '';
    const WRD = safeRoundData.WRD || '晴朗';
    const LOR = safeRoundData.LOR || '';
    const CLS = safeRoundData.CLS || '';
    const IMP = safeRoundData.IMP || '你的行動似乎沒有產生什麼特別的影響。';
    const aiNextTimeOfDay = safeRoundData.timeOfDay;
    const daysToAdvance = safeRoundData.daysToAdvance || 0;
    const staminaChange = safeRoundData.staminaChange || 0; // AI給的精力變化，現在只在消耗時參考

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
    
    const timeDidAdvance = (daysToAdvance > 0) || (aiNextTimeOfDay && aiNextTimeOfDay !== player.currentTimeOfDay);

    // --- 【核心修正】三階調息心法 ---
    const recoveryKeywords = ['睡覺', '休息', '歇息', '打坐', '進食', '喝水', '療傷', '丹藥', '求救', '小歇', '歇會', '躺一下', '坐一下'];
    const isRecoveryAction = recoveryKeywords.some(kw => playerAction.includes(kw));
    
    let newStamina = player.stamina ?? 100;

    if (isRecoveryAction) {
        if (daysToAdvance > 0) {
            // 規則 3: 跨日大睡，恢復75%
            newStamina += 75;
            console.log('[精力系統] 進行了跨日大睡，恢復 75 點精力。');
        } else if (timeDidAdvance) {
            // 規則 1: 時辰小憩，恢復25%
            newStamina += 25;
            console.log('[精力系統] 進行了時辰小憩，恢復 25 點精力。');
        } else {
            // 規則 2: 回合調息，恢復10%
            newStamina += 10;
            console.log('[精力系統] 進行了回合調息，恢復 10 點精力。');
        }
    } else {
        // 非恢復性活動：應用AI的精力變化，並扣除基礎消耗
        newStamina += (staminaChange || 0);
        newStamina -= (Math.floor(Math.random() * 5) + 1);
    }

    newStamina = Math.max(0, Math.min(100, newStamina)); // 確保精力在 0-100 之間
    // --- 核心修正結束 ---

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
    await processItemChanges(userId, itemChanges, batch, finalSaveData);
    await updateFriendlinessValues(userId, username, NPC, finalSaveData, player, batch);
    await updateRomanceValues(userId, romanceChanges);
    await processNpcUpdates(userId, npcUpdates);
    if (locationUpdates && finalSaveData.LOC[0]) {
        await processLocationUpdates(userId, finalSaveData.LOC[0], locationUpdates);
    }

    const playerUpdatesForDb = {
        timeOfDay: finalTimeOfDay,
        stamina: newStamina,
        shortActionCounter,
        ...finalDate,
        currentLocation: LOC,
        internalPower: admin.firestore.FieldValue.increment(Number(powerChange?.internal || 0)),
        externalPower: admin.firestore.FieldValue.increment(Number(powerChange?.external || 0)),
        lightness: admin.firestore.FieldValue.increment(Number(powerChange?.lightness || 0)),
        morality: admin.firestore.FieldValue.increment(Number(moralityChange || 0)),
        money: admin.firestore.FieldValue.increment(Number(moneyChange || 0)),
        R: newRoundNumber
    };
    batch.update(userDocRef, playerUpdatesForDb);

    const longTermSummary = (await summaryDocRef.get()).data()?.text || '遊戲剛剛開始...';
    const newSummary = await getAISummary(longTermSummary, finalSaveData);
    batch.set(summaryDocRef, { text: newSummary, lastUpdated: newRoundNumber }, { merge: true });

    await batch.commit();
    console.log(`[數據同步] 玩家主檔案與長期記憶已同步至 R${newRoundNumber}。`);

    // 背景任務
    if (NPC && Array.isArray(NPC)) {
        NPC.filter(npc => npc.status).forEach(npc => {
            const interactionContext = `事件：「${EVT}」。\n經過：${aiResponse.story}\n我在事件中的狀態是：「${npc.status}」。`;
            updateNpcMemoryAfterInteraction(userId, npc.name, interactionContext).catch(err => console.error(`[背景任務] 更新NPC ${npc.name} 記憶時出錯:`, err));
        });
    }
    invalidateNovelCache(userId).catch(e => console.error("背景任務失敗: 無效化小說快取", e));
    updateLibraryNovel(userId, username).catch(e => console.error("背景任務失敗: 更新圖書館", e));

    // 準備回傳給前端的最終數據
    const [fullInventory, updatedSkills, finalPlayerProfile] = await Promise.all([
        getRawInventory(userId),
        getPlayerSkills(userId),
        userDocRef.get().then(doc => doc.data()),
    ]);

    return {
         ...finalSaveData, 
         ...finalPlayerProfile, 
         skills: updatedSkills, 
         inventory: fullInventory, 
         bulkScore: calculateBulkScore(fullInventory)
    };
}

module.exports = { updateGameState };
