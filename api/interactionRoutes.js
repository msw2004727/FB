// /api/interactionRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIStory, getAISummary, getAISuggestion } = require('../services/aiService');
const beggarService = require('../services/beggarService'); 

const {
    updateFriendlinessValues,
    updateRomanceValues,
    checkAndTriggerRomanceEvent,
    processNpcUpdates,
    updateNpcMemoryAfterInteraction
} = require('./npcHelpers');
const {
    updateSkills,
    getRawInventory,
    calculateBulkScore,
    getPlayerSkills,
    getInventoryState
} = require('./playerStateHelpers');
const {
    TIME_SEQUENCE,
    advanceDate,
    invalidateNovelCache,
    updateLibraryNovel,
    getMergedLocationData,
} = require('./worldStateHelpers');
const { triggerBountyGeneration } = require('./worldEngine');
const { processLocationUpdates } = require('./locationManager');
const { buildContext } = require('./contextBuilder');
const { processItemChanges } = require('./itemManager');

const db = admin.firestore();

// 指令預處理函式 (第二層保險)
const preprocessPlayerAction = (playerAction, locationContext) => {
    const facilityKeywords = {
        '鐵匠鋪': '鐵匠鋪', '打鐵鋪': '鐵匠鋪',
        '藥鋪': '藥鋪', '藥房': '藥鋪', '醫館': '藥鋪',
        '客棧': '客棧', '酒館': '客棧', '酒樓': '客棧',
        '雜貨鋪': '雜貨鋪',
        '村長家': '村長家',
    };

    for (const [keyword, type] of Object.entries(facilityKeywords)) {
        if (playerAction.includes(keyword)) {
            const facilities = locationContext?.facilities || [];
            const targetFacility = facilities.find(f => f.type === type);
            if (targetFacility) {
                const newAction = `前往${targetFacility.name}`;
                console.log(`[指令預處理] 偵測到通用指令，已將 "${playerAction}" 修正為 "${newAction}"`);
                return newAction;
            }
        }
    }
    return playerAction;
};


const interactRouteHandler = async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const userDocRef = db.collection('users').doc(userId);

    try {
        let { action: playerAction, model: playerModelChoice } = req.body;
        
        const playerStateSnapshot = await userDocRef.get();
        if (!playerStateSnapshot.exists) {
            return res.status(404).json({ message: '找不到玩家資料。' });
        }
        let player = playerStateSnapshot.data();

        // ================= 【精力為零時的強制昏迷事件】 =================
        const isTryingToRestOrHeal = ['睡覺', '休息', '歇息', '進食', '喝水', '打坐', '療傷', '丹藥', '求救'].some(kw => playerAction.includes(kw));

        if ((player.stamina || 0) <= 0 && !isTryingToRestOrHeal) {
            console.log(`[精力系統] 玩家精力為零 (${player.stamina}) 且行動 (${playerAction}) 並非求生，強制觸發昏迷事件。`);

            const currentTimeIndex = TIME_SEQUENCE.indexOf(player.timeOfDay);
            const nextTimeIndex = (currentTimeIndex + 1) % TIME_SEQUENCE.length;
            const newTimeOfDay = TIME_SEQUENCE[nextTimeIndex];
            let newDate = { year: player.year, month: player.month, day: player.day, yearName: player.yearName };
            if (nextTimeIndex === 0) {
                newDate = advanceDate(newDate);
            }

            const comaStory = `你試圖繼續行動，但眼前猛地一黑，身體再也支撐不住，直挺挺地倒了下去，徹底失去了意識。不知過了多久，你才悠悠轉醒，發現時間已經悄然流逝。`;
            const newRoundNumber = (player.R || 0) + 1;

            const finalSaveData = {
                ...player,
                story: comaStory,
                PC: "你因體力不支而昏倒，醒來後體力已完全恢復。",
                EVT: "體力耗盡而昏迷",
                R: newRoundNumber,
                timeOfDay: newTimeOfDay,
                ...newDate,
                stamina: 100,
                moneyChange: 0,
                powerChange: {},
                itemChanges: [],
                skillChanges: [],
                romanceChanges: [],
                npcUpdates: [],
                locationUpdates: [],
                LOC: player.currentLocation || ['未知之地'],
                NPC: player.NPC || [],
            };

            const newSaveRef = userDocRef.collection('game_saves').doc(`R${newRoundNumber}`);
            await newSaveRef.set(finalSaveData);

            await userDocRef.update({
                stamina: 100,
                timeOfDay: newTimeOfDay,
                ...newDate,
                R: newRoundNumber,
            });

            const suggestion = "你大病初癒，最好先查看一下自身狀態。";
            
            invalidateNovelCache(userId).catch(e => console.error("背景任務失敗(昏迷): 無效化小說快取", e));
            updateLibraryNovel(userId, username).catch(e => console.error("背景任務失敗(昏迷): 更新圖書館", e));
            
            const [fullInventory, updatedSkills] = await Promise.all([ getRawInventory(userId), getPlayerSkills(userId) ]);
            
            const finalRoundDataForClient = { 
                ...finalSaveData, 
                skills: updatedSkills, 
                inventory: fullInventory,
                money: player.money || 0,
                bulkScore: calculateBulkScore(fullInventory), 
                suggestion: suggestion
            };

            return res.json({
                story: comaStory,
                roundData: finalRoundDataForClient,
                suggestion: suggestion,
                locationData: await getMergedLocationData(userId, player.currentLocation)
            });
        }
        // =======================================================================

        const beggarKeywords = ['丐幫', '乞丐', '打聽', '消息', '情報'];
        const isSummoningBeggar = beggarKeywords.some(keyword => playerAction.includes(keyword));

        if (isSummoningBeggar) {
            const summonResult = await beggarService.handleBeggarSummon(userId);
            const [lastSaveSnapshot, inventoryState, fullInventory] = await Promise.all([
                db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get(),
                getInventoryState(userId),
                getRawInventory(userId)
            ]);
            if (lastSaveSnapshot.empty) return res.status(404).json({ message: '找不到存檔紀錄，無法呼叫丐幫。' });
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
            return res.json({ story: tempRoundData.story, roundData: tempRoundData, suggestion: tempRoundData.suggestion, locationData: await getMergedLocationData(userId, tempRoundData.LOC) });
        }

        const context = await buildContext(userId, username);
        if (!context) throw new Error("無法建立當前的遊戲狀態，請稍後再試。");
        
        playerAction = preprocessPlayerAction(playerAction, context.locationContext);
        
        const { longTermSummary, recentHistory, locationContext, npcContext, bulkScore, isNewGame } = context;
        if (isNewGame) return res.status(404).json({ message: '找不到存檔紀錄。' });
        if (player.isDeceased) return res.status(403).json({ message: '逝者已矣，無法再有任何動作。' });

        const romanceEventData = await checkAndTriggerRomanceEvent(userId, player);
        const aiResponse = await getAIStory(playerModelChoice, longTermSummary, JSON.stringify(recentHistory), playerAction, player, username, player.timeOfDay, player.power, player.morality, [], romanceEventData ? romanceEventData.eventStory : null, null, locationContext, npcContext, bulkScore, []);

        if (!aiResponse || !aiResponse.roundData) throw new Error("主AI未能生成有效回應。");
        
        // --- 核心修改：建立「金鐘罩」，為所有從AI收到的資料提供預設值，杜絕 `undefined` ---
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
        const EVT = safeRoundData.EVT || playerAction.substring(0, 10);
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
        const staminaChange = safeRoundData.staminaChange || 0;
        // --- 修改結束 ---

        const newRoundNumber = (player.R || 0) + 1;

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

        let newStamina = (player.stamina ?? 100) + (staminaChange || 0) - (Math.floor(Math.random() * 5) + 1);
        const isSleeping = ['睡覺'].some(kw => playerAction.includes(kw));
        const timeDidAdvance = (daysToAdvance > 0) || (aiNextTimeOfDay && aiNextTimeOfDay !== player.currentTimeOfDay);
        if (isSleeping && timeDidAdvance) newStamina = 100;
        newStamina = Math.max(0, Math.min(100, newStamina));
        
        let shortActionCounter = player.shortActionCounter || 0;
        if (!timeDidAdvance && !isSleeping) shortActionCounter++; else shortActionCounter = 0;
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

        // --- 核心修改：將存檔操作提前 ---
        const finalSaveData = { 
            story: aiResponse.story || "江湖靜好，歲月無聲。", 
            R: Number(newRoundNumber), 
            timeOfDay: finalTimeOfDay, 
            year: Number(finalDate.year),
            month: Number(finalDate.month),
            day: Number(finalDate.day),
            yearName: finalDate.yearName,
            stamina: Number(newStamina),
            playerState, powerChange, moralityChange: Number(moralityChange), moneyChange: Number(moneyChange),
            itemChanges, skillChanges, romanceChanges, npcUpdates, locationUpdates,
            ATM, EVT, LOC, PSY, PC, NPC, QST, WRD, LOR, CLS, IMP
        };

        console.log('--- [存檔檢查點] ---');
        console.log('準備寫入存檔的最終數據:', JSON.stringify(finalSaveData, null, 2));
        
        const newSaveRef = userDocRef.collection('game_saves').doc(`R${newRoundNumber}`);
        await newSaveRef.set(finalSaveData);
        console.log(`[強制寫入機制] R${newRoundNumber} 存檔成功！`);

        const batch = db.batch();
        const summaryDocRef = userDocRef.collection('game_state').doc('summary');

        await processItemChanges(userId, itemChanges, batch, { R: newRoundNumber, ...finalDate, timeOfDay: finalTimeOfDay, LOC });
        await updateFriendlinessValues(userId, username, NPC, { R: newRoundNumber, LOC }, player, batch);
        await updateRomanceValues(userId, romanceChanges);
        await processNpcUpdates(userId, npcUpdates);
        if (locationUpdates && locationContext) {
            await processLocationUpdates(userId, locationContext.locationName, locationUpdates);
        }
        if (romanceEventData && romanceEventData.npcUpdates) await processNpcUpdates(userId, romanceEventData.npcUpdates);
        
        const playerUpdatesForDb = {
            timeOfDay: finalTimeOfDay,
            stamina: Number(newStamina),
            shortActionCounter: Number(shortActionCounter),
            year: Number(finalDate.year),
            month: Number(finalDate.month),
            day: Number(finalDate.day),
            currentLocation: LOC,
            internalPower: admin.firestore.FieldValue.increment(Number(powerChange?.internal || 0)),
            externalPower: admin.firestore.FieldValue.increment(Number(powerChange?.external || 0)),
            lightness: admin.firestore.FieldValue.increment(Number(powerChange?.lightness || 0)),
            morality: admin.firestore.FieldValue.increment(Number(moralityChange || 0)),
            money: admin.firestore.FieldValue.increment(Number(moneyChange || 0)),
            R: Number(newRoundNumber)
        };
        batch.update(userDocRef, playerUpdatesForDb);

        const newSummary = await getAISummary(longTermSummary, finalSaveData);
        batch.set(summaryDocRef, { text: newSummary, lastUpdated: newRoundNumber }, { merge: true });
        
        await batch.commit();
        console.log(`[數據同步] R${newRoundNumber} 的其餘數據已成功同步至資料庫。`);
        
        const [fullInventory, updatedSkills, finalPlayerProfile, suggestion, finalLocationData] = await Promise.all([
            getRawInventory(userId),
            getPlayerSkills(userId),
            userDocRef.get().then(doc => doc.data()),
            getAISuggestion(finalSaveData),
            getMergedLocationData(userId, finalSaveData.LOC)
        ]);

        const finalRoundDataForClient = {
             ...finalSaveData, 
             ...finalPlayerProfile, 
             skills: updatedSkills, 
             inventory: fullInventory, 
             bulkScore: calculateBulkScore(fullInventory),
             suggestion: suggestion 
        };
        
        res.json({
            story: finalSaveData.story,
            roundData: finalRoundDataForClient,
            suggestion: suggestion,
            locationData: finalLocationData
        });
        
        if (NPC && Array.isArray(NPC)) {
            NPC.filter(npc => npc.status).forEach(npc => {
                const interactionContext = `事件：「${EVT}」。\n經過：${aiResponse.story}\n我在事件中的狀態是：「${npc.status}」。`;
                updateNpcMemoryAfterInteraction(userId, npc.name, interactionContext).catch(err => console.error(`[背景任務] 更新NPC ${npc.name} 記憶時出錯:`, err));
            });
        }
        invalidateNovelCache(userId).catch(e => console.error("背景任務失敗: 無效化小說快取", e));
        updateLibraryNovel(userId, username).catch(e => console.error("背景任務失敗: 更新圖書館", e));

    } catch (error) {
        console.error(`[互動路由] /interact 錯誤:`, error);
        res.status(500).json({ message: error.message || "處理您的動作時發生了未知的伺服器錯誤。" });
    }
};

router.post('/interact', interactRouteHandler);
module.exports = router;
