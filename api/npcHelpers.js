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

        if (!templateDoc.exists && !stateDoc.exists) {
            console.warn(`[NPC系統] 找不到名為「${npcName}」的通用模板和玩家狀態。`);
            return null;
        }

        const templateData = templateDoc.exists ? templateDoc.data() : {};
        const stateData = stateDoc.exists ? stateDoc.data() : {};
        
        const mergedProfile = { ...templateData, ...stateData, name: templateData.name || npcName };
        if (!mergedProfile.name) mergedProfile.name = npcName;

        return mergedProfile;
    } catch (error) {
        console.error(`[NPC系統] 合併NPC「${npcName}」的資料時出錯:`, error);
        return null;
    }
}


async function createNpcProfileInBackground(userId, username, npcData, roundData, playerProfile) {
    const npcName = npcData.name;
    try {
        const npcTemplateRef = db.collection('npcs').doc(npcName);
        let templateDoc = await npcTemplateRef.get();
        
        if (!templateDoc.exists) {
            console.log(`[NPC系統] 「${npcName}」的通用模板不存在，啟動背景AI生成...`);
            const prompt = getNpcCreatorPrompt(username, npcName, roundData, playerProfile);
            const npcJsonString = await callAI(aiConfig.npcProfile, prompt, true);
            const newTemplateData = JSON.parse(npcJsonString.replace(/^```json\s*|```\s*$/g, ''));

            const rand = Math.random();
            newTemplateData.romanceOrientation = rand < 0.7 ? "異性戀" : rand < 0.85 ? "雙性戀" : rand < 0.95 ? "同性戀" : "無性戀";
            newTemplateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
            
            const encounterLocation = roundData.LOC && roundData.LOC.length > 0 ? roundData.LOC[0] : '未知之地';
            if (!newTemplateData.currentLocation) {
                 newTemplateData.currentLocation = encounterLocation;
            }

            await npcTemplateRef.set(newTemplateData);
            console.log(`[NPC系統] 成功在背景為「${npcName}」建立並儲存了通用模板。`);

            if (newTemplateData.relationships) {
                await processNpcRelationships(userId, npcName, newTemplateData.relationships);
            }
        } else {
             console.log(`[NPC系統] 「${npcName}」的通用模板已存在，跳過背景生成。`);
        }
    } catch (error) {
        console.error(`[NPC系統] 為 "${npcName}" 進行背景建檔時發生錯誤:`, error);
    }
}


async function updateFriendlinessValues(userId, npcChanges, roundData) {
    if (!npcChanges || npcChanges.length === 0) return;
    const playerNpcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    const batch = db.batch();

    for (const change of npcChanges) {
        if (!change.name) continue;
        
        const npcStateDocRef = playerNpcStatesRef.doc(change.name);

        if (change.isNew) {
            // 【核心修正】如果是新NPC，直接創建完整的初始狀態檔案
            console.log(`[友好度系統] 偵測到新NPC「${change.name}」，正在為其創建完整的初始狀態...`);
            const encounterLocation = roundData.LOC && roundData.LOC.length > 0 ? roundData.LOC[0] : '未知之地';
            const encounterTime = `${roundData.yearName || '元祐'}${roundData.year || 1}年${roundData.month || 1}月${roundData.day || 1}日 ${roundData.timeOfDay || '未知時辰'}`;
            const initialState = {
                interactionSummary: `你與${change.name}的交往尚淺。`,
                currentLocation: encounterLocation,
                firstMet: {
                    round: roundData.R,
                    time: encounterTime,
                    location: encounterLocation,
                    event: roundData.EVT || '初次相遇'
                },
                isDeceased: false,
                inventory: {},
                romanceValue: 0,
                friendlinessValue: change.friendlinessChange || 0,
                triggeredRomanceEvents: []
            };
            batch.set(npcStateDocRef, initialState);

        } else if (typeof change.friendlinessChange === 'number' && change.friendlinessChange !== 0) {
            // 對於舊NPC，只更新友好度
            batch.set(npcStateDocRef, { 
                friendlinessValue: admin.firestore.FieldValue.increment(change.friendlinessChange) 
            }, { merge: true });
        }
    }
    
    try {
        await batch.commit();
        console.log(`[友好度系統] 批次更新了 ${npcChanges.length} 位NPC的友好度狀態。`);
    } catch (error) {
        console.error(`[友好度系統] 批次更新NPC關係時出錯:`, error);
    }
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
