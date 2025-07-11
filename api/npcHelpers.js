// api/npcHelpers.js
const admin = require('firebase-admin');
const { callAI, aiConfig } = require('../services/aiService');
const { getNpcCreatorPrompt } = require('../prompts/npcCreatorPrompt.js');
const { getAIRomanceEvent } = require('../prompts/romanceEventPrompt.js');
const { processNpcRelationships } = require('./relationshipManager');

const db = admin.firestore();

function getFriendlinessLevel(value) {
    if (value >= 100) return 'devoted';
    if (value >= 70) return 'trusted';
    if (value >= 30) return 'friendly';
    if (value <= -100) return 'sworn_enemy';
    if (value <= -50) return 'hostile';
    if (value <= -10) return 'wary';
    return 'neutral';
}

async function getMergedNpcProfile(userId, npcName) {
    if (!userId || !npcName) return null;
    try {
        const npcTemplateRef = db.collection('npcs').doc(npcName);
        const playerNpcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);

        const [templateDoc, stateDoc] = await Promise.all([
            npcTemplateRef.get(),
            playerNpcStateRef.get()
        ]);

        if (!templateDoc.exists) {
            if (stateDoc.exists) return { name: npcName, ...stateDoc.data() };
            console.warn(`[NPC系統] 找不到名為「${npcName}」的通用模板和玩家狀態。`);
            return null;
        }

        const templateData = templateDoc.data();
        const stateData = stateDoc.exists ? stateDoc.data() : {};
        return { ...templateData, ...stateData, name: templateData.name || npcName };
    } catch (error) {
        console.error(`[NPC系統] 合併NPC「${npcName}」的資料時出錯:`, error);
        return null;
    }
}

async function createNpcProfileInBackground(userId, username, npcData, roundData, playerProfile) {
    const npcName = npcData.name;
    console.log(`[NPC系統] UserId: ${userId}。偵測到新NPC: "${npcName}"，已啟動背景建檔程序...`);
    try {
        const npcTemplateRef = db.collection('npcs').doc(npcName);
        let templateDoc = await npcTemplateRef.get();

        if (!templateDoc.exists) {
            const prompt = getNpcCreatorPrompt(username, npcName, roundData, playerProfile);
            const npcJsonString = await callAI(aiConfig.npcProfile, prompt, true);
            const newTemplateData = JSON.parse(npcJsonString.replace(/^```json\s*|```\s*$/g, ''));

            const rand = Math.random();
            newTemplateData.romanceOrientation = rand < 0.7 ? "異性戀" : rand < 0.85 ? "雙性戀" : rand < 0.95 ? "同性戀" : "無性戀";
            newTemplateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
            await npcTemplateRef.set(newTemplateData);
            console.log(`[NPC系統] 成功為「${npcName}」建立並儲存了通用模板。`);
            if (newTemplateData.relationships) {
                await processNpcRelationships(userId, npcName, newTemplateData.relationships);
            }
        }

        const playerNpcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);
        const stateDoc = await playerNpcStateRef.get();
        if (!stateDoc.exists) {
            const templateData = (await npcTemplateRef.get()).data();
            const initialState = {
                friendlinessValue: npcData.friendlinessChange || 0,
                romanceValue: 0,
                interactionSummary: `你與${npcName}的交往尚淺。`,
                currentLocation: templateData.currentLocation || roundData.LOC[0],
                firstMet: { round: roundData.R, time: `${roundData.yearName}${roundData.year}-${roundData.month}-${roundData.day} ${roundData.timeOfDay}`, location: roundData.LOC[0], event: roundData.EVT },
                isDeceased: false,
                inventory: {}
            };
            await playerNpcStateRef.set(initialState);
            console.log(`[NPC系統] 成功為玩家 ${userId} 初始化了與「${npcName}」的關係檔案。`);
        }
    } catch (error) {
        console.error(`[NPC系統] 為 "${npcName}" 進行背景建檔時發生錯誤:`, error);
    }
}

async function updateFriendlinessValues(userId, npcChanges) {
    if (!npcChanges || npcChanges.length === 0) return;
    const playerNpcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    const promises = npcChanges.map(async (change) => {
        if (!change.name || typeof change.friendlinessChange !== 'number' || change.friendlinessChange === 0) return;
        const npcStateDocRef = playerNpcStatesRef.doc(change.name);
        try {
            await npcStateDocRef.set({ friendlinessValue: admin.firestore.FieldValue.increment(change.friendlinessChange) }, { merge: true });
        } catch (error) {
            console.error(`[友好度系統] 更新與NPC "${change.name}" 的關係時出錯:`, error);
        }
    });
    await Promise.all(promises);
}

async function updateRomanceValues(userId, romanceChanges) {
    if (!romanceChanges || romanceChanges.length === 0) return;
    const playerNpcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    const promises = romanceChanges.map(async ({ npcName, valueChange }) => {
        if (!npcName || typeof valueChange !== 'number' || valueChange === 0) return;
        const npcStateDocRef = playerNpcStatesRef.doc(npcName);
        try {
            await npcStateDocRef.set({ romanceValue: admin.firestore.FieldValue.increment(valueChange) }, { merge: true });
        } catch (error) {
            console.error(`[戀愛系統] 更新與NPC "${npcName}" 的心動值時出錯:`, error);
        }
    });
    await Promise.all(promises);
}

async function checkAndTriggerRomanceEvent(userId, playerProfile) {
    const playerNpcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    const statesSnapshot = await playerNpcStatesRef.where('romanceValue', '>=', 50).get();
    if (statesSnapshot.empty) return null;

    for (const stateDoc of statesSnapshot.docs) {
        const npcName = stateDoc.id;
        const npcState = stateDoc.data();
        const npcProfile = await getMergedNpcProfile(userId, npcName);
        if (!npcProfile) continue;

        const { romanceValue = 0, triggeredRomanceEvents = [] } = npcState;
        const eventTriggers = [{ level: 'level_2_confession', threshold: 150 }];

        for (const trigger of eventTriggers) {
            if (romanceValue >= trigger.threshold && !triggeredRomanceEvents.includes(trigger.level)) {
                console.log(`[戀愛系統] 偵測到與 ${npcName} 的 ${trigger.level} 事件觸發條件！`);
                const romanceEventResultText = await getAIRomanceEvent(playerProfile, npcProfile, trigger.level);
                try {
                    const romanceEventResult = JSON.parse(romanceEventResultText);
                    if (romanceEventResult && romanceEventResult.story) {
                        await stateDoc.ref.update({ triggeredRomanceEvents: admin.firestore.FieldValue.arrayUnion(trigger.level) });
                        return { eventStory: romanceEventResult.story, npcUpdates: romanceEventResult.npcUpdates || [] };
                    }
                } catch (e) {
                    console.error('[戀愛系統] 解析AI回傳的戀愛事件JSON時出錯:', e);
                    return null;
                }
            }
        }
    }
    return null;
}

async function processNpcUpdates(userId, updates) {
    if (!updates || !Array.isArray(updates) || updates.length === 0) return;
    const batch = db.batch();
    const playerNpcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    for (const update of updates) {
        const { npcName, fieldToUpdate, newValue, updateType } = update;
        if (!npcName || !fieldToUpdate || newValue === undefined) continue;
        const npcStateDocRef = playerNpcStatesRef.doc(npcName);
        let updatePayload = {};
        if (updateType === 'arrayUnion') {
            updatePayload[fieldToUpdate] = admin.firestore.FieldValue.arrayUnion(newValue);
        } else if (updateType === 'arrayRemove') {
            updatePayload[fieldToUpdate] = admin.firestore.FieldValue.arrayRemove(newValue);
        } else {
            updatePayload[fieldToUpdate] = newValue;
        }
        batch.set(npcStateDocRef, updatePayload, { merge: true });
        console.log(`[NPC檔案更新] 已將玩家 ${userId} 的NPC「${npcName}」欄位「${fieldToUpdate}」更新為：`, newValue);
    }
    try {
        await batch.commit();
        console.log(`[NPC檔案更新] 玩家與NPC的檔案狀態已批次更新。`);
    } catch (error) {
        console.error(`[NPC檔案更新] 為玩家 ${userId} 更新NPC檔案時發生錯誤:`, error);
    }
}

module.exports = {
    getFriendlinessLevel,
    getMergedNpcProfile,
    createNpcProfileInBackground,
    updateFriendlinessValues,
    updateRomanceValues,
    checkAndTriggerRomanceEvent,
    processNpcUpdates
};
