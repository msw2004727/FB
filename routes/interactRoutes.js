// routes/interactRoutes.js

const express = require('express');
const admin = require('firebase-admin');
const { getAIStory, getAISummary, getAISuggestion, getAICombatAction } = require('../services/aiService.js');
const { createNpcProfileInBackground } = require('../services/npcService.js');
const { advanceDate, shouldAdvanceDay, applyItemChanges } = require('../utils/gameLogic.js');

const router = express.Router();
const db = admin.firestore();

// 將主線互動邏輯從路由處理器中分離出來，方便複用
async function handleInteraction(req, res) {
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
        
        if (aiResponse.roundData.NPC && Array.isArray(aiResponse.roundData.NPC)) {
            aiResponse.roundData.NPC.forEach(npc => {
                if (npc.isNew === true) {
                    createNpcProfileInBackground(userId, username, npc, aiResponse.roundData);
                    delete npc.isNew;
                }
            });
        }
        
        const nextTimeOfDay = aiResponse.roundData.timeOfDay || currentTimeOfDay;

        if (aiResponse.roundData.daysToAdvance && typeof aiResponse.roundData.daysToAdvance === 'number' && aiResponse.roundData.daysToAdvance > 0) {
            for (let i = 0; i < aiResponse.roundData.daysToAdvance; i++) {
                currentDate = advanceDate(currentDate);
            }
        } else if (shouldAdvanceDay(currentTimeOfDay, nextTimeOfDay)) {
            currentDate = advanceDate(currentDate);
        }
        
        turnsSinceEvent++;
        
        if (aiResponse.roundData.enterCombat) {
            console.log(`[戰鬥系統] 玩家 ${username} 進入戰鬥！`);
            const initialLog = aiResponse.roundData.combatIntro || '戰鬥開始了！';
            const combatState = {
                turn: 1,
                player: { username },
                enemies: aiResponse.roundData.combatants,
                log: [initialLog]
            };
            await userDocRef.collection('game_state').doc('current_combat').set(combatState);
            aiResponse.combatInfo = { status: 'COMBAT_START', initialState: combatState };
            turnsSinceEvent = 0; 
        } 

        const powerChange = aiResponse.roundData.powerChange || { internal: 0, external: 0, lightness: 0 };
        const moralityChange = aiResponse.roundData.moralityChange || 0;
        
        const latestUserDoc = await userDocRef.get();
        const latestUserData = latestUserDoc.data() || {};
        aiResponse.roundData.ITM = applyItemChanges(latestUserData.ITM, aiResponse.roundData.ITM);

        const newInternalPower = Math.max(0, Math.min(999, playerPower.internal + powerChange.internal));
        const newExternalPower = Math.max(0, Math.min(999, playerPower.external + powerChange.external));
        const newLightness = Math.max(0, Math.min(999, playerPower.lightness + powerChange.lightness));
        let newMorality = Math.max(-100, Math.min(100, playerMorality + moralityChange));

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
            turnsSinceEvent,
            preferredModel: modelName,
            ITM: aiResponse.roundData.ITM,
            ...currentDate
        });
        
        if (aiResponse.roundData.playerState === 'dead') {
            await userDocRef.update({ isDeceased: true });
            aiResponse.suggestion = "你的江湖路已到盡頭...";
        } else {
            const suggestion = await getAISuggestion(modelName, aiResponse.roundData);
            aiResponse.suggestion = suggestion;
            const newSummary = await getAISummary(modelName, longTermSummary, aiResponse.roundData);
            await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });
        }
        
        await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData);
        
        aiResponse.story = aiResponse.roundData.EVT || playerAction;

        res.json(aiResponse);

    } catch (error) {
        console.error(`[UserID: ${userId}] /interact 錯誤:`, error);
        res.status(500).json({ message: error.message || "互動時發生未知錯誤" });
    }
}

router.post('/interact', handleInteraction);

router.post('/combat-action', async (req, res) => {
    const userId = req.user.id;
    const { action, model } = req.body;
    const modelName = model || 'deepseek'; 

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

            // 【修改】將戰鬥結果包裝成一個新的行動，並重新呼叫主互動邏輯
            const postCombatAction = `戰鬥剛剛結束。結局：${combatResult.outcome.summary || '戰鬥結束'}。我的狀態變化：${combatResult.outcome.playerChanges.PC || '無'}。`;
            
            const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
            const currentRound = savesSnapshot.docs.length > 0 ? savesSnapshot.docs[0].data().R : 0;
            const mainModel = userProfile.preferredModel || 'gemini';

            const mockedReq = {
                user: req.user,
                body: {
                    action: postCombatAction,
                    round: currentRound,
                    model: mainModel
                }
            };
            // 將請求交給主互動函式處理，以生成新回合
            return handleInteraction(mockedReq, res);

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

module.exports = router;
