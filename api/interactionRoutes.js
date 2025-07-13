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
const { processItemChanges } = require('../itemManager');

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
        
        // ================= 【精力為零時的強制昏迷事件】 =================
        const isTryingToRestOrHeal = ['睡覺', '休息', '歇息', '進食', '喝水', '打坐', '療傷', '丹藥', '求救'].some(kw => playerAction.includes(kw));
        
        const playerStateBeforeAction = (await userDocRef.get()).data();
        if (!playerStateBeforeAction) {
             return res.status(404).json({ message: '找不到玩家資料。' });
        }

        if ((playerStateBeforeAction.stamina || 0) <= 0 && !isTryingToRestOrHeal) {
            console.log(`[精力系統] 玩家精力為零 (${playerStateBeforeAction.stamina}) 且行動 (${playerAction}) 並非求生，強制觸發昏迷事件。`);
            const lastSaveSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
            const lastRoundData = lastSaveSnapshot.empty ? {} : lastSaveSnapshot.docs[0].data();
            
            const newRoundNumber = (lastRoundData.R || 0) + 1;
            
            await db.runTransaction(async (transaction) => {
                const playerDoc = await transaction.get(userDocRef);
                if (!playerDoc.exists) { throw "Document does not exist!"; }
                const playerData = playerDoc.data();

                const currentTimeIndex = TIME_SEQUENCE.indexOf(playerData.timeOfDay);
                const nextTimeIndex = (currentTimeIndex + 1) % TIME_SEQUENCE.length;
                let newTimeOfDay = TIME_SEQUENCE[nextTimeIndex];
                let newDate = { year: playerData.year, month: playerData.month, day: playerData.day, yearName: playerData.yearName };
                if (nextTimeIndex === 0) {
                    newDate = advanceDate(newDate);
                }

                const comaStory = `你試圖繼續行動，但眼前猛地一黑，身體再也支撐不住，直挺挺地倒了下去，徹底失去了意識。不知過了多久，你才悠悠轉醒，發現時間已經悄然流逝。`;
                const finalSaveData = {
                    ...lastRoundData,
                    ...playerData,
                    story: comaStory,
                    PC: "你因體力不支而昏倒，醒來後體力已完全恢復。",
                    EVT: "體力耗盡而昏迷",
                    R: newRoundNumber,
                    timeOfDay: newTimeOfDay,
                    ...newDate,
                    stamina: 100
                };
                
                transaction.update(userDocRef, { stamina: 100, timeOfDay: newTimeOfDay, ...newDate, R: newRoundNumber });
                transaction.set(userDocRef.collection('game_saves').doc(`R${newRoundNumber}`), finalSaveData);
            });
            
            const latestData = await api.getLatestGame({ user: { id: userId, username }});
            return res.json(latestData);
        }

        // ================= 【丐幫呼叫特殊處理】 =================
        const beggarKeywords = ['丐幫', '乞丐', '打聽', '消息', '情報'];
        if (beggarKeywords.some(keyword => playerAction.includes(keyword))) {
            const summonResult = await beggarService.handleBeggarSummon(userId);
            const lastSaveSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
            if (lastSaveSnapshot.empty) return res.status(404).json({ message: '找不到存檔紀錄。' });

            const lastRoundData = lastSaveSnapshot.docs[0].data();
            const fullInventory = await getRawInventory(userId);
            const tempRoundData = {
                ...lastRoundData,
                inventory: fullInventory,
                bulkScore: calculateBulkScore(fullInventory),
                story: summonResult.appearanceStory,
                PC: '你發出的暗號得到了回應，一個丐幫弟子出現在你面前。',
                EVT: '丐幫弟子現身',
                suggestion: `要向「${summonResult.beggarName}」打聽些什麼嗎？`,
                NPC: [...(lastRoundData.NPC || []).filter(npc => !npc.isDeceased), { name: summonResult.beggarName, status: "一個衣衫襤褸的乞丐湊到你身邊。", status_title: "丐幫弟子", friendliness: 'neutral', isTemp: true }]
            };
            return res.json({ story: tempRoundData.story, roundData: tempRoundData, suggestion: tempRoundData.suggestion, locationData: await getMergedLocationData(userId, tempRoundData.LOC) });
        }

        // ================= 【常規遊戲流程】 =================
        const context = await buildContext(userId, username);
        if (!context || context.isNewGame) throw new Error("無法建立遊戲狀態或找不到存檔。");
        
        playerAction = preprocessPlayerAction(playerAction, context.locationContext);
        
        const { longTermSummary, recentHistory, locationContext, npcContext, bulkScore } = context;

        const aiResponse = await getAIStory(playerModelChoice, longTermSummary, JSON.stringify(recentHistory), playerAction, context.player, username, context.player.currentTimeOfDay, context.player.power, context.player.morality, [], null, null, locationContext, npcContext, bulkScore, []);

        if (!aiResponse || !aiResponse.roundData) throw new Error("主AI未能生成有效回應。");

        // --- 核心修正：為所有來自AI的數據提供安全的預設值 ---
        const {
            playerState = 'alive', powerChange = {}, moralityChange = 0, moneyChange = 0,
            itemChanges = [], skillChanges = [], romanceChanges = [], npcUpdates = [], locationUpdates = [],
            ATM = [''], EVT = playerAction.substring(0, 10), LOC = context.player.currentLocation || ['未知之地'],
            PSY = '心如止水', PC = '安然無恙', NPC = [], QST = '', WRD = '晴朗', LOR = '', CLS = '', IMP = '一切如常。',
            timeOfDay: aiNextTimeOfDay, daysToAdvance = 0, staminaChange = 0
        } = aiResponse.roundData;

        // --- 技能與物品更新 ---
        const { levelUpEvents, customSkillCreationResult } = await updateSkills(userId, skillChanges, context.player);
        if (customSkillCreationResult && !customSkillCreationResult.success) {
            aiResponse.story = customSkillCreationResult.reason;
            if (skillChanges.some(s => s.isNewlyAcquired)) skillChanges.length = 0;
        }
        if (levelUpEvents.length > 0) {
            aiResponse.story += `\n\n(你感覺到自己的${levelUpEvents.map(e => `「${e.skillName}」`).join('、')}境界似乎有所精進。)`;
        }

        // --- 時間與體力結算 ---
        let currentStamina = context.player.stamina ?? 100;
        let shortActionCounter = context.player.shortActionCounter || 0;
        let finalTimeOfDay = aiNextTimeOfDay || context.player.currentTimeOfDay;
        let finalDate = { ...context.player.currentDate };
        
        const isResting = ['睡覺', '休息', '歇息'].some(kw => playerAction.includes(kw));
        const timeDidAdvance = daysToAdvance > 0 || finalTimeOfDay !== context.player.currentTimeOfDay;

        if (isResting && timeDidAdvance) currentStamina = 100;
        else currentStamina += (staminaChange || 0);
        
        if (!timeDidAdvance && !isResting) shortActionCounter++;
        else shortActionCounter = 0;

        let daysToAdd = daysToAdvance;
        if (shortActionCounter >= 3) {
            const currentTimeIndex = TIME_SEQUENCE.indexOf(finalTimeOfDay);
            const nextTimeIndex = (currentTimeIndex + 1) % TIME_SEQUENCE.length;
            finalTimeOfDay = TIME_SEQUENCE[nextTimeIndex];
            if (nextTimeIndex === 0) daysToAdd++;
            shortActionCounter = 0;
        }
        for (let i = 0; i < daysToAdd; i++) finalDate = advanceDate(finalDate);

        // --- 核心修正：使用 Transaction 更新玩家核心數據，確保原子性 ---
        let finalPlayerProfile;
        await db.runTransaction(async (transaction) => {
            const playerDoc = await transaction.get(userDocRef);
            if (!playerDoc.exists) throw "找不到玩家檔案！";
            const currentData = playerDoc.data();
            
            const playerUpdates = {
                timeOfDay: finalTimeOfDay,
                ...finalDate,
                stamina: Math.max(0, Math.min(100, currentStamina)),
                shortActionCounter,
                currentLocation: LOC,
                internalPower: Math.max(0, (currentData.internalPower || 0) + (powerChange?.internal || 0)),
                externalPower: Math.max(0, (currentData.externalPower || 0) + (powerChange?.external || 0)),
                lightness: Math.max(0, (currentData.lightness || 0) + (powerChange?.lightness || 0)),
                morality: (currentData.morality || 0) + moralityChange,
                money: (currentData.money || 0) + moneyChange,
                R: admin.firestore.FieldValue.increment(1)
            };
            transaction.update(userDocRef, playerUpdates);
            finalPlayerProfile = { ...currentData, ...playerUpdates };
        });

        const newRoundNumber = finalPlayerProfile.R;

        // --- 批次處理其他非核心數據的寫入 ---
        const batch = db.batch();
        const summaryDocRef = userDocRef.collection('game_state').doc('summary');

        await processItemChanges(userId, itemChanges, batch, { R: newRoundNumber, ...finalDate, timeOfDay: finalTimeOfDay, LOC });
        await updateFriendlinessValues(userId, username, NPC, { R: newRoundNumber, LOC }, context.player, batch);
        await updateRomanceValues(userId, romanceChanges);
        await processNpcUpdates(userId, npcUpdates);
        if (locationUpdates && locationContext) await processLocationUpdates(userId, locationContext.locationName, locationUpdates);

        const finalSaveData = { 
            story: aiResponse.story, R: newRoundNumber, timeOfDay: finalTimeOfDay, ...finalDate, stamina: finalPlayerProfile.stamina, playerState, 
            powerChange, moralityChange, moneyChange, itemChanges, skillChanges, romanceChanges, npcUpdates, locationUpdates, 
            ATM, EVT, LOC, PSY, PC, NPC, QST, WRD, LOR, CLS, IMP, 
            internalPower: finalPlayerProfile.internalPower, externalPower: finalPlayerProfile.externalPower, 
            lightness: finalPlayerProfile.lightness, morality: finalPlayerProfile.morality
        };
        batch.set(userDocRef.collection('game_saves').doc(`R${newRoundNumber}`), finalSaveData);

        const newSummary = await getAISummary(longTermSummary, finalSaveData);
        batch.set(summaryDocRef, { text: newSummary, lastUpdated: newRoundNumber }, { merge: true });

        await batch.commit();

        // --- 準備回傳給前端的最終數據 ---
        const [fullInventory, updatedSkills, suggestion, finalLocationData] = await Promise.all([
            getRawInventory(userId), getPlayerSkills(userId),
            getAISuggestion(finalSaveData), getMergedLocationData(userId, finalSaveData.LOC)
        ]);
        
        // 重新從資料庫讀取最新的 inventory 狀態，以包含貨幣變化
        const finalInventoryState = await getInventoryState(userId);
        
        const finalRoundDataForClient = {
             ...finalSaveData, ...finalPlayerProfile, 
             skills: updatedSkills, inventory: fullInventory, 
             bulkScore: calculateBulkScore(fullInventory),
             suggestion: suggestion,
             // 確保回傳給前端的 money 是正確的
             money: finalPlayerProfile.money, // 文錢
             silver: finalInventoryState.money // 銀兩
        };
        
        res.json({
            story: finalSaveData.story,
            roundData: finalRoundDataForClient,
            suggestion: suggestion,
            locationData: finalLocationData
        });

        // --- 非同步背景任務 ---
        if (NPC && Array.isArray(NPC)) {
            NPC.filter(npc => npc.status).forEach(npc => {
                updateNpcMemoryAfterInteraction(userId, npc.name, `事件：「${EVT}」。\n經過：${aiResponse.story}\n我在事件中的狀態是：「${npc.status}」。`).catch(err => console.error(`[背景任務] 更新NPC ${npc.name} 記憶時出錯:`, err));
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
