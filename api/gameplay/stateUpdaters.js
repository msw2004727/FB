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
const ATMOSPHERE_LABEL_MAX_CHARS = 8;

function clampTextByChars(value, maxChars) {
    const normalized = String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    return Array.from(normalized).slice(0, maxChars).join('');
}

function normalizeAtmosphereField(value) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? [value] : ['']);
    const normalized = [...source];

    normalized[0] = clampTextByChars(normalized[0], ATMOSPHERE_LABEL_MAX_CHARS) || '未知';
    if (normalized.length < 2) normalized.push('');

    return normalized;
}

/**
 * 【核心修正 v3.3】更新遊戲狀態並將所有更改寫入資料庫
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
    
    const safeRoundData = aiResponse.roundData || {};
    const { 
        story = aiResponse.story || '時間悄然流逝...',
        playerState = 'alive', 
        powerChange = {}, 
        moralityChange = 0, 
        moneyChange = 0, 
        itemChanges = [], 
        skillChanges = [], 
        romanceChanges = [], 
        npcUpdates = [], 
        locationUpdates = [], 
        ATM: rawATM = [''], 
        EVT = '江湖軼事', 
        LOC = player.currentLocation || ['未知之地'], 
        PSY = '心如止水', 
        PC = '安然無恙', 
        NPC = [], 
        QST = '', 
        WRD = '晴朗', 
        LOR = '', 
        CLS = '', 
        IMP = '你的行動似乎沒有產生什麼特別的影響。', 
        timeOfDay: aiNextTimeOfDay, 
        daysToAdvance = 0 
    } = safeRoundData;

    const ATM = normalizeAtmosphereField(rawATM);

    // --- 【核心修改】移除隨機事件系統 ---
    // let randomEvent = null;
    // let eventEffects = {};
    // if (Math.random() < 0.15) { 
    //     console.log(`[隨機事件系統] 觸發隨機事件！`);
    //     const eventType = Math.random() < 0.6 ? '一個小小的正面事件' : '一個小小的負面事件';
    //     const eventResult = await getAIRandomEvent(eventType, {
    //         username: username,
    //         location: LOC[0],
    //         playerState: PC,
    //         morality: player.morality || 0
    //     });

    //     if (eventResult && eventResult.description) {
    //         randomEvent = eventResult;
    //         eventEffects = eventResult.effects || {};
    //         console.log(`[隨機事件系統] 已成功生成事件: ${eventResult.description}`);
    //         if (eventEffects.itemChanges) {
    //             itemChanges.push(...eventEffects.itemChanges);
    //         }
    //     }
    // }
    // --- 修改結束 ---


    if (story && (story.includes('黑影') || story.includes('影子'))) {
        console.log(`[!!!] 系統警示：神秘黑影人已在玩家 [${username}] 的第 ${newRoundNumber} 回合劇情中出現！`);
    }

    const { levelUpEvents, customSkillCreationResult } = await updateSkills(userId, skillChanges, player);
    let finalStory = story;
    if (customSkillCreationResult && !customSkillCreationResult.success) {
        finalStory = customSkillCreationResult.reason;
        if(skillChanges.some(s => s.isNewlyAcquired)) {
             skillChanges.length = 0;
        }
    }
    
    if (levelUpEvents.length > 0) {
        const uniqueSkillNames = [...new Set(levelUpEvents.map(e => e.skillName))];
        finalStory += `\n\n(你感覺到自己的${uniqueSkillNames.map(name => `「${name}」`).join('、')}境界似乎有所精進。)`;
    }
    
    const newStamina = calculateNewStamina(player, playerAction, safeRoundData);

    const timeDidAdvance = (daysToAdvance > 0) || (aiNextTimeOfDay && aiNextTimeOfDay !== player.currentTimeOfDay);
    const isRecoveryAction = ['睡覺', '休息', '歇息', '打坐', '進食', '喝水', '療傷', '丹藥', '求救', '小歇', '歇會', '躺一下', '坐一下'].some(kw => playerAction.includes(kw));
    let shortActionCounter = player.shortActionCounter || 0;
    if (!timeDidAdvance && !isRecoveryAction) shortActionCounter++; else shortActionCounter = 0;
    
    let finalTimeOfDay = aiNextTimeOfDay || player.currentTimeOfDay || '上午';
    let finalDate = {
        year: player.year || 1,
        month: player.month || 1,
        day: player.day || 1,
        yearName: player.yearName || '元祐'
    };
    
    let daysToAdd = daysToAdvance;
    if (shortActionCounter >= 3) {
        const currentTimeIndex = TIME_SEQUENCE.indexOf(finalTimeOfDay);
        const nextTimeIndex = (currentTimeIndex + 1) % TIME_SEQUENCE.length;
        finalTimeOfDay = TIME_SEQUENCE[nextTimeIndex];
        if (nextTimeIndex === 0) daysToAdd++;
        shortActionCounter = 0;
    }
    for (let i = 0; i < daysToAdd; i++) finalDate = advanceDate(finalDate);
    
    // --- 【核心修改】移除隨機事件對數據的影響 ---
    const finalPC = PC;
    const finalPowerChange = powerChange;
    const finalMoralityChange = moralityChange;
    // --- 修改結束 ---

    const finalSaveData = { 
        story: finalStory, R: newRoundNumber, timeOfDay: finalTimeOfDay, 
        year: finalDate.year, month: finalDate.month, day: finalDate.day, yearName: finalDate.yearName,
        stamina: newStamina, playerState, powerChange: finalPowerChange, moralityChange: finalMoralityChange, moneyChange, 
        itemChanges, skillChanges, romanceChanges, npcUpdates, locationUpdates,
        ATM, EVT, LOC, PSY, PC: finalPC, NPC, QST, WRD, LOR, CLS, IMP
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

    const newInternalPower = (player.internalPower || 0) + (finalPowerChange?.internal || 0);
    const newExternalPower = (player.externalPower || 0) + (finalPowerChange?.external || 0);
    const newLightnessPower = (player.lightness || 0) + (finalPowerChange?.lightness || 0);

    const playerUpdatesForDb = {
        timeOfDay: finalTimeOfDay,
        stamina: newStamina,
        shortActionCounter,
        year: finalDate.year,
        month: finalDate.month,
        day: finalDate.day,
        yearName: finalDate.yearName,
        currentLocation: LOC,
        internalPower: newInternalPower,
        externalPower: newExternalPower,
        lightness: newLightnessPower,
        maxInternalPowerAchieved: Math.max(player.maxInternalPowerAchieved || 0, newInternalPower),
        maxExternalPowerAchieved: Math.max(player.maxExternalPowerAchieved || 0, newExternalPower),
        maxLightnessAchieved: Math.max(player.maxLightnessAchieved || 0, newLightnessPower),
        morality: admin.firestore.FieldValue.increment(Number(finalMoralityChange || 0)),
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
            const interactionContext = `事件：「${EVT}」。\n經過：${story}\n我在事件中的狀態是：「${npc.status}」。`;
            updateNpcMemoryAfterInteraction(userId, npc.name, interactionContext).catch(err => console.error(`[背景任務] 更新NPC ${npc.name} 記憶時出錯:`, err));
        });
    }
    await invalidateNovelCache(userId);
    await updateLibraryNovel(userId, username, finalSaveData);
    
    const [fullInventory, updatedSkills, finalPlayerProfile] = await Promise.all([
        getRawInventory(userId),
        getPlayerSkills(userId),
        userDocRef.get().then(doc => doc.data()),
    ]);
    
    const finalRoundDataForClient = {
        ...finalPlayerProfile, 
        ...finalSaveData, 
        skills: updatedSkills, 
        inventory: fullInventory, 
        bulkScore: calculateBulkScore(fullInventory),
        randomEvent: null // 【核心修改】確保不回傳 randomEvent
    };
    
    return finalRoundDataForClient;
}

module.exports = { updateGameState };
