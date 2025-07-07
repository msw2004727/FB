// /api/gameplayRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIStory, getAISummary, getAISuggestion, getAICombatAction } = require('../services/aiService');
const {
    TIME_SEQUENCE,
    advanceDate,
    updateInventory,
    updateRomanceValues,
    checkAndTriggerRomanceEvent,
    getInventoryState,
    createNpcProfileInBackground,
    invalidateNovelCache,
    updateLibraryNovel
} = require('./gameHelpers');

const db = admin.firestore();

const interactRouteHandler = async (req, res) => {
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

        const summaryDocRef = userDocRef.collection('game_state').doc('summary');
        const [summaryDoc, savesSnapshot] = await Promise.all([
            summaryDocRef.get(),
            userDocRef.collection('game_saves').orderBy('R', 'desc').limit(3).get()
        ]);

        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";
        let recentHistoryRounds = [];
        if (currentRound > 0) {
            savesSnapshot.forEach(doc => recentHistoryRounds.push(doc.data()));
            recentHistoryRounds.sort((a, b) => a.R - b.R);
        }

        const playerPower = { internal: userProfile.internalPower || 5, external: userProfile.externalPower || 5, lightness: userProfile.lightness || 5 };
        const playerMorality = userProfile.morality === undefined ? 0 : userProfile.morality;
        let currentDate = { yearName: userProfile.yearName || '元祐', year: userProfile.year || 1, month: userProfile.month || 1, day: userProfile.day || 1 };
        const currentTimeOfDay = userProfile.timeOfDay || '上午';

        const aiResponse = await getAIStory(modelName, longTermSummary, JSON.stringify(recentHistoryRounds), playerAction, { ...userProfile, ...currentDate }, username, currentTimeOfDay, playerPower, playerMorality);
        if (!aiResponse || !aiResponse.roundData) throw new Error("主AI未能生成有效回應。");

        const newRoundNumber = (currentRound || 0) + 1;
        aiResponse.roundData.R = newRoundNumber;

        aiResponse.story = aiResponse.story || "江湖靜悄悄，似乎什麼也沒發生。";

        await updateInventory(userId, aiResponse.roundData.itemChanges);
        await updateRomanceValues(userId, aiResponse.roundData.romanceChanges);

        const romanceEventNarrative = await checkAndTriggerRomanceEvent(userId, username, aiResponse.roundData.romanceChanges, aiResponse.roundData, modelName);

        if (romanceEventNarrative) {
            aiResponse.story = romanceEventNarrative + aiResponse.story;
        }
        aiResponse.roundData.story = aiResponse.story;


        const [newSummary, suggestion] = await Promise.all([
            getAISummary(modelName, longTermSummary, aiResponse.roundData),
            getAISuggestion(modelName, aiResponse.roundData)
        ]);

        aiResponse.suggestion = suggestion;

        const inventoryState = await getInventoryState(userId);
        aiResponse.roundData.ITM = inventoryState.itemsString;
        aiResponse.roundData.money = inventoryState.money;

        if (aiResponse.roundData.NPC && Array.isArray(aiResponse.roundData.NPC)) {
            const npcUpdatePromises = aiResponse.roundData.NPC.map(npc => {
                const npcDocRef = userDocRef.collection('npcs').doc(npc.name);
                if (npc.isNew) {
                    delete npc.isNew;
                    return createNpcProfileInBackground(userId, username, npc, aiResponse.roundData);
                } else {
                    const newSceneLocation = aiResponse.roundData.LOC[0];
                    if (newSceneLocation) {
                        return npcDocRef.set({ currentLocation: newSceneLocation }, { merge: true });
                    }
                }
                return Promise.resolve();
            });
            await Promise.all(npcUpdatePromises);
        }

        if (aiResponse.roundData.enterCombat) {
            const initialLog = aiResponse.roundData.combatIntro || '戰鬥開始了！';
            const combatState = { turn: 1, player: { username: username }, enemies: aiResponse.roundData.combatants, log: [initialLog] };
            await userDocRef.collection('game_state').doc('current_combat').set(combatState);
            aiResponse.combatInfo = { status: 'COMBAT_START', initialState: combatState };
        }

        const { powerChange = {}, moralityChange = 0, timeOfDay: nextTimeOfDay, daysToAdvance } = aiResponse.roundData;

        if (daysToAdvance > 0) {
            for (let i = 0; i < daysToAdvance; i++) { currentDate = advanceDate(currentDate); }
        } else {
            const oldTimeIndex = TIME_SEQUENCE.indexOf(currentTimeOfDay);
            const newTimeIndex = TIME_SEQUENCE.indexOf(nextTimeOfDay || currentTimeOfDay);
            if (newTimeIndex < oldTimeIndex) { currentDate = advanceDate(currentDate); }
        }

        const newInternalPower = Math.max(0, Math.min(999, playerPower.internal + (powerChange.internal || 0)));
        const newExternalPower = Math.max(0, Math.min(999, playerPower.external + (powerChange.external || 0)));
        const newLightness = Math.max(0, Math.min(999, playerPower.lightness + (powerChange.lightness || 0)));
        let newMorality = Math.max(-100, Math.min(100, playerMorality + moralityChange));

        Object.assign(aiResponse.roundData, { internalPower: newInternalPower, externalPower: newExternalPower, lightness: newLightness, morality: newMorality, timeOfDay: nextTimeOfDay, ...currentDate });

        // 【核心修改】處理死亡判斷
        if (aiResponse.roundData.playerState === 'dead') {
             // 如果AI提供了具體的死因，就用它；否則，使用一個通用的描述
             aiResponse.roundData.PC = aiResponse.roundData.causeOfDeath || '你在這次事件中不幸殞命。';
             await userDocRef.update({ isDeceased: true });
        }

        await Promise.all([
             userDocRef.update({
                timeOfDay: nextTimeOfDay || currentTimeOfDay,
                internalPower: newInternalPower,
                externalPower: newExternalPower,
                lightness: newLightness,
                morality: newMorality,
                preferredModel: modelName,
                ...currentDate
            }),
            summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber }),
            userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData)
        ]);

        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗:", err));

        res.json(aiResponse);

    } catch (error) {
        console.error(`[UserID: ${userId}] /interact 錯誤:`, error);
        if (!res.headersSent) {
            res.status(500).json({ message: error.message || "互動時發生未知錯誤" });
        }
    }
};

const combatActionRouteHandler = async (req, res) => {
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
            await combatDocRef.delete();

            const postCombatAction = `戰鬥剛剛結束。結局：${combatResult.outcome?.summary || '戰鬥結束'}。`;
            // Re-use the interact handler for post-combat story generation
            const mockedReq = {
                user: { id: userId, username: playerProfile.username },
                body: { action: postCombatAction, round: combatState.R, model: modelName }
            };
            // This is a simplified call; in a real scenario you might need to adjust more state
            // For now, let's just create a new round based on the outcome
             const lastRoundSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
             const lastRoundData = lastRoundSnapshot.docs[0].data();
             const newRoundData = {
                 ...lastRoundData,
                 R: lastRoundData.R + 1,
                 story: combatResult.narrative,
                 PC: combatResult.outcome.playerChanges.PC || lastRoundData.PC,
                 EVT: "戰鬥結束"
             }
             await userDocRef.collection('game_saves').doc(`R${newRoundData.R}`).set(newRoundData);
             await invalidateNovelCache(userId);
             updateLibraryNovel(userId, playerProfile.username).catch(err => console.error("背景更新圖書館失敗:", err));

            res.json({
                status: 'COMBAT_END',
                newRound: {
                    story: newRoundData.story,
                    roundData: newRoundData,
                    suggestion: "戰鬥結束了，你接下來打算怎麼辦？"
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
};

router.post('/interact', interactRouteHandler);
router.post('/combat-action', combatActionRouteHandler);
router.post('/end-chat', async (req, res) => {
    // This route is now a proxy to the interactRouteHandler
    const { getAIChatSummary } = require('../services/aiService');
    const userId = req.user.id;
    const username = req.user.username;
    const { npcName, fullChatHistory, model } = req.body;

    if (!fullChatHistory || fullChatHistory.length === 0) {
        return res.json({ message: '對話已結束，江湖故事繼續。' });
    }

    try {
        const chatSummary = await getAIChatSummary(model, username, npcName, fullChatHistory);
        if (!chatSummary) throw new Error('AI未能成功總結對話內容。');

        const savesSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const currentRound = savesSnapshot.empty ? 0 : savesSnapshot.docs[0].data().R;

        req.body.action = chatSummary;
        req.body.round = currentRound;

        interactRouteHandler(req, res);

    } catch (error) {
        console.error(`[密談系統] 結束與NPC(${npcName})的對話時出錯:`, error);
        res.status(500).json({ message: '結束對話並更新世界時發生錯誤。' });
    }
});

module.exports = router;
