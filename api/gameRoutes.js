const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth');

const { 
    getAIStory, 
    getAISummary, 
    getNarrative, 
    getAIPrequel, 
    getAISuggestion, 
    getAIEncyclopedia, 
    getAIRandomEvent,
    getAICombatAction 
} = require('../services/aiService');

const db = admin.firestore();

const TIME_SEQUENCE = ['清晨', '上午', '中午', '下午', '黃昏', '夜晚', '深夜'];
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // 索引0不用

function advanceDate(currentDate) {
    let { year, month, day, yearName } = currentDate;
    day++;
    if (day > DAYS_IN_MONTH[month]) {
        day = 1;
        month++;
        if (month > 12) {
            month = 1;
            year++;
        }
    }
    return { year, month, day, yearName };
}

function applyItemChanges(currentItems, itemChangeString) {
    let items = currentItems ? currentItems.split('、').filter(i => i) : [];
    if (!itemChangeString) return items.join('、');

    const changes = itemChangeString.split('、');
    changes.forEach(change => {
        change = change.trim();
        if (change.startsWith('+')) {
            const newItem = change.substring(1).trim();
            items.push(newItem);
        } else if (change.startsWith('-')) {
            const itemToRemove = change.substring(1).trim();
            const index = items.indexOf(itemToRemove);
            if (index > -1) {
                items.splice(index, 1);
            }
        }
    });
    return items.filter(Boolean).join('、');
}

router.use(authMiddleware);

router.get('/get-encyclopedia', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        const summaryDoc = await summaryDocRef.get();

        if (!summaryDoc.exists || !summaryDoc.data().text) {
            return res.json({ encyclopediaHtml: '<p class="loading">你的江湖經歷尚淺，還沒有可供編撰的百科內容。</p>' });
        }

        const longTermSummary = summaryDoc.data().text;
        
        const encyclopediaHtml = await getAIEncyclopedia('deepseek', longTermSummary, username);
        
        res.json({ encyclopediaHtml });

    } catch (error) {
        console.error(`[UserID: ${userId}] /get-encyclopedia 錯誤:`, error);
        res.status(500).json({ message: "編撰百科時發生未知錯誤。" });
    }
});


router.post('/interact', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;

    try {
        const { action: playerAction, round: currentRound, model: modelName = 'gemini' } = req.body;

        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        const userProfile = userDoc.exists ? userDoc.data() : {};
        
        if (userProfile.isDeceased) {
            return res.status(403).json({ message: '逝者已矣，無法再有任何動作。' });
        }

        const currentTimeOfDay = userProfile.timeOfDay || '上午';
        let currentDate = {
            yearName: userProfile.yearName || '元祐',
            year: userProfile.year || 1,
            month: userProfile.month || 1,
            day: userProfile.day || 1
        };
        let turnsSinceEvent = userProfile.turnsSinceEvent || 0;

        const playerPower = {
            internal: userProfile.internalPower || 5,
            external: userProfile.externalPower || 5,
            lightness: userProfile.lightness || 5
        };
        const playerMorality = userProfile.morality === undefined ? 0 : userProfile.morality;

        const summaryDocRef = userDocRef.collection('game_state').doc('summary');
        const summaryDoc = await summaryDocRef.get();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";

        let recentHistoryRounds = [];
        const memoryDepth = 3;
        if (currentRound > 0) {
            const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(memoryDepth).get();
            savesSnapshot.forEach(doc => recentHistoryRounds.push(doc.data()));
            recentHistoryRounds.sort((a, b) => a.R - b.R);
        }
        
        const aiResponse = await getAIStory(modelName, longTermSummary, JSON.stringify(recentHistoryRounds), playerAction, { ...userProfile, ...currentDate }, username, currentTimeOfDay, playerPower, playerMorality);
        if (!aiResponse) throw new Error("主AI未能生成有效回應。");

        const newRoundNumber = (currentRound || 0) + 1;
        aiResponse.roundData.R = newRoundNumber;
        
        const nextTimeOfDay = aiResponse.roundData.timeOfDay || currentTimeOfDay;

        const daysToAdvance = aiResponse.roundData.daysToAdvance;
        if (daysToAdvance && typeof daysToAdvance === 'number' && daysToAdvance > 0) {
            for (let i = 0; i < daysToAdvance; i++) {
                currentDate = advanceDate(currentDate);
            }
        } else {
            const oldTimeIndex = TIME_SEQUENCE.indexOf(currentTimeOfDay);
            const newTimeIndex = TIME_SEQUENCE.indexOf(nextTimeOfDay);
            if (newTimeIndex < oldTimeIndex) {
                currentDate = advanceDate(currentDate);
            }
        }
        
        turnsSinceEvent++;
        
        let powerChange = aiResponse.roundData.powerChange || { internal: 0, external: 0, lightness: 0 };
        let moralityChange = aiResponse.roundData.moralityChange || 0;
        let newPlayerStateDescription = aiResponse.roundData.PC;
        let newItemChange = aiResponse.roundData.ITM;

        if (aiResponse.roundData.enterCombat) {
            console.log(`[戰鬥系統] 玩家 ${username} 進入戰鬥！`);
            
            const combatState = {
                turn: 1,
                player: { username: username },
                enemies: aiResponse.roundData.combatants,
                log: [`戰鬥開始：你遭遇了 ${aiResponse.roundData.combatants.map(c => c.name).join('、')}！`]
            };

            await userDocRef.collection('game_state').doc('current_combat').set(combatState);

            aiResponse.combatInfo = {
                status: 'COMBAT_START',
                initialState: combatState
            };
            
            turnsSinceEvent = 0; 
        } 
        else if (turnsSinceEvent >= 3) {
            if (Math.random() < 0.6) {
                const r = Math.random();
                let eventType;
                if (r < 0.4) eventType = '一個小小的正面事件';
                else if (r < 0.6) eventType = '一個中等的正面事件';
                else if (r < 0.9) eventType = '一個小小的負面事件';
                else eventType = '一個中等的負面事件';
                
                console.log(`[事件系統] 玩家 ${username} 觸發隨機事件: ${eventType}`);

                const eventData = await getAIRandomEvent('deepseek', eventType, {
                    username: username,
                    location: aiResponse.roundData.LOC[0],
                    playerState: newPlayerStateDescription,
                    morality: playerMorality + moralityChange 
                });

                if (eventData && eventData.effects) {
                    console.log('[事件系統] 事件效果:', eventData.effects);
                    if(eventData.effects.powerChange) {
                        powerChange.internal += (eventData.effects.powerChange.internal || 0);
                        powerChange.external += (eventData.effects.powerChange.external || 0);
                        powerChange.lightness += (eventData.effects.powerChange.lightness || 0);
                    }
                    if(eventData.effects.moralityChange) {
                        moralityChange += eventData.effects.moralityChange;
                    }
                    if(eventData.effects.PC) {
                        newPlayerStateDescription += ` ${eventData.effects.PC}`;
                    }
                    if(eventData.effects.ITM) {
                        newItemChange = applyItemChanges(newItemChange, eventData.effects.ITM);
                    }
                    aiResponse.randomEvent = { description: eventData.description };
                }
            } else {
                console.log(`[事件系統] 玩家 ${username} 本回合無事發生。`);
            }
            turnsSinceEvent = 0;
        }

        const newInternalPower = Math.max(0, Math.min(999, playerPower.internal + (powerChange.internal || 0)));
        const newExternalPower = Math.max(0, Math.min(999, playerPower.external + (powerChange.external || 0)));
        const newLightness = Math.max(0, Math.min(999, playerPower.lightness + (powerChange.lightness || 0)));
        let newMorality = playerMorality + moralityChange;
        newMorality = Math.max(-100, Math.min(100, newMorality));

        aiResponse.roundData.PC = newPlayerStateDescription;
        aiResponse.roundData.ITM = newItemChange;
        
        Object.assign(aiResponse.roundData, {
            internalPower: newInternalPower,
            externalPower: newExternalPower,
            lightness: newLightness,
            morality: newMorality,
            timeOfDay: nextTimeOfDay,
            ...currentDate
        });

        await userDocRef.update({ 
            timeOfDay: nextTimeOfDay,
            internalPower: newInternalPower,
            externalPower: newExternalPower,
            lightness: newLightness,
            morality: newMorality,
            turnsSinceEvent: turnsSinceEvent,
            ...currentDate
        });
        
        const novelCacheRef = userDocRef.collection('game_state').doc('novel_cache');

        if (aiResponse.roundData.playerState === 'dead') {
            await userDocRef.update({ isDeceased: true });
            aiResponse.suggestion = "你的江湖路已到盡頭...";
            aiResponse.roundData.timeOfDay = currentTimeOfDay;
            const deathNarrative = await getNarrative(modelName, aiResponse.roundData);
            await novelCacheRef.set({ paragraphs: admin.firestore.FieldValue.arrayUnion({ text: deathNarrative, npcs: aiResponse.roundData.NPC || [] }) }, { merge: true });
        } else {
            const suggestion = await getAISuggestion(modelName, aiResponse.roundData);
            aiResponse.suggestion = suggestion;
            const newSummary = await getAISummary(modelName, longTermSummary, aiResponse.roundData);
            await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });
            
            const narrativeText = await getNarrative(modelName, aiResponse.roundData);
            await novelCacheRef.set({ paragraphs: admin.firestore.FieldValue.arrayUnion({ text: narrativeText, npcs: aiResponse.roundData.NPC || [] }) }, { merge: true });
        }
        
        await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData);
        res.json(aiResponse);

    } catch (error) {
        console.error(`[UserID: ${userId}] /interact 錯誤:`, error);
        res.status(500).json({ message: error.message || "互動時發生未知錯誤" });
    }
});

router.post('/combat-action', async (req, res) => {
    const userId = req.user.id;
    const { action } = req.body;
    const modelName = 'deepseek';

    try {
        const userDocRef = db.collection('users').doc(userId);
        const combatDocRef = userDocRef.collection('game_state').doc('current_combat');
        
        const combatDoc = await combatDocRef.get();
        if (!combatDoc.exists) {
            return res.status(404).json({ message: "戰鬥不存在或已結束。" });
        }

        let combatState = combatDoc.data();
        combatState.log.push(`> ${action}`);

        const userDoc = await userDocRef.get();
        let playerProfile = userDoc.exists ? userDoc.data() : {};

        const combatResult = await getAICombatAction(modelName, playerProfile, combatState, action);

        if (!combatResult) throw new Error("戰鬥裁判AI未能生成有效回應。");

        combatState.log.push(combatResult.narrative);
        combatState.turn++;

        if (combatResult.combatOver) {
            console.log(`[戰鬥系統] 玩家 ${playerProfile.username} 的戰鬥已結束。`);
            await combatDocRef.delete();

            // --- 【修改】穩健的結算流程開始 ---

            // 1. 安全地獲取戰鬥結果，並設定預設值
            const outcome = combatResult.outcome || {};
            const changes = outcome.playerChanges || {};
            const powerChange = changes.powerChange || {};
            const pcChange = changes.PC || "";
            const itmChange = changes.ITM || "";
            const moralityChange = changes.moralityChange || 0;
            const internalPowerChange = powerChange.internal || 0;
            const externalPowerChange = powerChange.external || 0;
            const lightnessPowerChange = powerChange.lightness || 0;

            // 2. 計算更新後的玩家數值
            const updatedProfile = {
                internalPower: (playerProfile.internalPower || 0) + internalPowerChange,
                externalPower: (playerProfile.externalPower || 0) + externalPowerChange,
                lightness: (playerProfile.lightness || 0) + lightnessPowerChange,
                morality: (playerProfile.morality || 0) + moralityChange
            };
            playerProfile = { ...playerProfile, ...updatedProfile };
            
            // 3. 準備生成戰後回合的材料
            const lastRoundSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
            const lastRound = lastRoundSnapshot.empty ? { R: 0 } : lastRoundSnapshot.docs[0].data();
            
            const summaryDocRef = userDocRef.collection('game_state').doc('summary');
            const summaryDoc = await summaryDocRef.get();
            const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";

            const recentHistorySnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(2).get();
            const recentHistoryRounds = recentHistorySnapshot.docs.map(doc => doc.data()).reverse();

            // 4. 使用更清晰的指令呼叫AI生成新回合
            const postCombatAction = `戰鬥剛剛結束。結局：${outcome.summary || '戰鬥結束'}。我的狀態變化：${pcChange || '無'}。`;
            const aiResponse = await getAIStory(modelName, longTermSummary, JSON.stringify(recentHistoryRounds), postCombatAction, playerProfile, playerProfile.username, playerProfile.timeOfDay, updatedProfile, updatedProfile.morality);

            if (!aiResponse) throw new Error("戰鬥後AI未能生成有效回應。");

            // 5. 整合與儲存新回合數據
            const newRoundNumber = (lastRound.R || 0) + 1;
            aiResponse.roundData.R = newRoundNumber;
            aiResponse.roundData.ITM = applyItemChanges(aiResponse.roundData.ITM, itmChange); // 合併物品變化
            
            const finalInternalPower = Math.max(0, Math.min(999, updatedProfile.internalPower + (aiResponse.roundData.powerChange?.internal || 0)));
            const finalExternalPower = Math.max(0, Math.min(999, updatedProfile.externalPower + (aiResponse.roundData.powerChange?.external || 0)));
            const finalLightness = Math.max(0, Math.min(999, updatedProfile.lightness + (aiResponse.roundData.powerChange?.lightness || 0)));
            const finalMorality = Math.max(-100, Math.min(100, updatedProfile.morality + (aiResponse.roundData.moralityChange || 0)));

            Object.assign(aiResponse.roundData, {
                internalPower: finalInternalPower,
                externalPower: finalExternalPower,
                lightness: finalLightness,
                morality: finalMorality
            });

            // 一次性更新所有資料庫欄位
            await userDocRef.update({ 
                internalPower: finalInternalPower,
                externalPower: finalExternalPower,
                lightness: finalLightness,
                morality: finalMorality,
                timeOfDay: aiResponse.roundData.timeOfDay || playerProfile.timeOfDay,
            });

            const newSummary = await getAISummary(modelName, longTermSummary, aiResponse.roundData);
            await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });

            const narrativeText = await getNarrative(modelName, aiResponse.roundData);
            const suggestion = await getAISuggestion(modelName, aiResponse.roundData);

            await userDocRef.collection('game_state').doc('novel_cache').set({ paragraphs: admin.firestore.FieldValue.arrayUnion({ text: narrativeText, npcs: aiResponse.roundData.NPC || [] }) }, { merge: true });
            await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData);

            // 6. 回傳包含完整新回合資訊的物件
            res.json({
                status: 'COMBAT_END',
                finalLog: combatResult.narrative,
                newRound: {
                    story: narrativeText,
                    roundData: aiResponse.roundData,
                    suggestion: suggestion
                }
            });

        } else {
            await combatDocRef.set(combatState);
            res.json({
                status: 'COMBAT_ONGOING',
                narrative: combatResult.narrative
            });
        }

    } catch (error) {
        console.error(`[UserID: ${userId}] /combat-action 錯誤:`, error);
        res.status(500).json({ message: error.message || "戰鬥中發生未知錯誤" });
    }
});


router.get('/latest-game', async (req, res) => {
    const userId = req.user.id;
    try {
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data() || {};

        if (userData && userData.isDeceased) {
            return res.json({ gameState: 'deceased' });
        }
        
        const snapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(7).get();
        if (snapshot.empty) {
            return res.status(404).json({ message: '找不到存檔紀錄。' });
        }
        
        const recentHistory = snapshot.docs.map(doc => doc.data());
        const latestGameData = recentHistory[0];

        Object.assign(latestGameData, {
            timeOfDay: latestGameData.timeOfDay || userData.timeOfDay || '上午',
            internalPower: userData.internalPower || 5,
            externalPower: userData.externalPower || 5,
            lightness: userData.lightness || 5,
            morality: userData.morality === undefined ? 0 : userData.morality,
            yearName: userData.yearName || '元祐',
            year: userData.year || 1,
            month: userData.month || 1,
            day: userData.day || 1
        });

        let prequel = null;
        if (recentHistory.length > 1) {
            const historyForPrequel = [...recentHistory].reverse();
            prequel = await getAIPrequel('deepseek', historyForPrequel);
        }
        
        const suggestion = await getAISuggestion('deepseek', latestGameData);

        res.json({
            prequel: prequel,
            story: `[進度已讀取] 你回到了 ${latestGameData.LOC[0]}，繼續你的冒險...`,
            roundData: latestGameData,
            suggestion: suggestion
        });

    } catch (error) {
        console.error(`[UserID: ${userId}] /latest-game 錯誤:`, error);
        res.status(500).json({ message: "讀取最新進度失敗。" });
    }
});

router.get('/get-novel', async (req, res) => {
    const userId = req.user.id;
    try {
        const novelCacheRef = db.collection('users').doc(userId).collection('game_state').doc('novel_cache');
        const novelCacheDoc = await novelCacheRef.get();

        if (novelCacheDoc.exists && novelCacheDoc.data().paragraphs) {
            return res.json({ novel: novelCacheDoc.data().paragraphs });
        } 
        
        const snapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
        if (snapshot.empty) {
            return res.json({ novel: [] });
        }
        
        let isCacheable = true;
        const fallbackText = "在那一刻，時間的長河似乎出現了斷層...";

        const narrativePromises = snapshot.docs.map(async (doc) => {
            const roundData = doc.data();
            const narrativeText = await getNarrative('deepseek', roundData);
            
            if (narrativeText.includes(fallbackText)) {
                isCacheable = false;
            }

            return {
                text: narrativeText,
                npcs: roundData.NPC || [] 
            };
        });

        const novelParagraphs = await Promise.all(narrativePromises);
        
        if (isCacheable) {
            await novelCacheRef.set({ paragraphs: novelParagraphs });
        }
        
        res.json({ novel: novelParagraphs });
        
    } catch (error) {
        console.error(`[UserID: ${userId}] /get-novel 錯誤:`, error);
        res.status(500).json({ message: "生成小說時出錯。" });
    }
});

router.post('/restart', async (req, res) => {
    const userId = req.user.id;
    try {
        const userDocRef = db.collection('users').doc(userId);
        
        const savesCollectionRef = userDocRef.collection('game_saves');
        const savesSnapshot = await savesCollectionRef.get();
        const batch = db.batch();
        savesSnapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        await userDocRef.collection('game_state').doc('summary').delete().catch(() => {});
        await userDocRef.collection('game_state').doc('suggestion').delete().catch(() => {});
        
        await userDocRef.collection('game_state').doc('novel_cache').delete().catch(() => {});
        
        await userDocRef.update({
            isDeceased: admin.firestore.FieldValue.delete(),
            timeOfDay: admin.firestore.FieldValue.delete(),
            internalPower: admin.firestore.FieldValue.delete(),
            externalPower: admin.firestore.FieldValue.delete(),
            lightness: admin.firestore.FieldValue.delete(),
            morality: admin.firestore.FieldValue.delete(),
            year: admin.firestore.FieldValue.delete(),
            month: admin.firestore.FieldValue.delete(),
            day: admin.firestore.FieldValue.delete(),
            yearName: admin.firestore.FieldValue.delete(),
            turnsSinceEvent: admin.firestore.FieldValue.delete()
        });
        
        res.status(200).json({ message: '新的輪迴已開啟，願你這次走得更遠。' });

    } catch (error) {
        console.error(`[UserID: ${userId}] /restart 錯誤:`, error);
        res.status(500).json({ message: '開啟新的輪迴時發生錯誤。' });
    }
});

router.post('/force-suicide', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        const userProfile = userDoc.exists ? userDoc.data() : {};

        await userDocRef.update({ isDeceased: true });

        const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const lastRound = savesSnapshot.empty ? { R: 0 } : savesSnapshot.docs[0].data();
        
        const newRoundNumber = (lastRound.R || 0) + 1;
        
        const finalRoundData = {
            R: newRoundNumber,
            playerState: 'dead',
            timeOfDay: userProfile.timeOfDay || '上午',
            internalPower: userProfile.internalPower || 5,
            externalPower: userProfile.externalPower || 5,
            lightness: userProfile.lightness || 5,
            morality: userProfile.morality === undefined ? 0 : userProfile.morality,
            yearName: userProfile.yearName || '元祐',
            year: userProfile.year || 1,
            month: userProfile.month || 1,
            day: userProfile.day || 1,
            ATM: ['決絕', '悲壯'],
            EVT: '英雄末路',
            LOC: ['原地', {}],
            PSY: '江湖路遠，就此終焉。',
            PC: `${username}引動內力，逆轉經脈，在一陣刺目的光芒中...化為塵土。`,
            NPC: [],
            ITM: '隨身物品盡數焚毀。',
            QST: '所有恩怨情仇，煙消雲散。',
            WRD: '一聲巨響傳遍數里，驚動了遠方的勢力。',
            LOR: '',
            CLS: '',
            IMP: '你選擇了以最壯烈的方式結束這段江湖行。'
        };

        const finalNarrative = await getNarrative('deepseek', finalRoundData);
        const novelCacheRef = userDocRef.collection('game_state').doc('novel_cache');
        await novelCacheRef.set({ 
            paragraphs: admin.firestore.FieldValue.arrayUnion({ text: finalNarrative, npcs: [] }) 
        }, { merge: true });
        
        await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(finalRoundData);
        
        res.json({
            story: finalNarrative,
            roundData: finalRoundData,
            suggestion: '你的江湖路已到盡頭...'
        });

    } catch (error) {
        console.error(`[UserID: ${userId}] /force-suicide 錯誤:`, error);
        res.status(500).json({ message: '了此殘生時發生未知錯誤...' });
    }
});


module.exports = router;
