// api/npcHelpers.js
const admin = require('firebase-admin');
const { getAIPerNpcSummary, getRomanceEventPrompt, callAI, aiConfig } = require('../services/aiService');
const { createNewNpc } = require('../services/npcCreationService');
const { getKnownNpcTemplate } = require('./cacheManager');

const db = admin.firestore();

async function updateNpcMemoryAfterInteraction(userId, npcName, interactionData) {
    if (!userId || !npcName || !interactionData) {
        console.warn(`[NPC記憶系統] 因缺少必要參數，跳過為 ${npcName || '未知NPC'} 的記憶更新。`);
        return;
    }
    try {
        const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);
        const doc = await npcStateRef.get();
        
        if (!doc.exists) {
            console.warn(`[NPC記憶系統] 找不到 ${npcName} 的個人狀態檔案，無法更新記憶。`);
            return;
        }

        const oldSummary = doc.data().interactionSummary || `你與${npcName}的交往尚淺。`;
        
        const newSummary = await getAIPerNpcSummary('default', npcName, oldSummary, interactionData);

        await npcStateRef.update({ interactionSummary: newSummary });
        console.log(`[NPC記憶系統] 已成功更新NPC「${npcName}」的個人記憶。`);

    } catch (error) {
        console.error(`[NPC記憶系統] 在更新NPC「${npcName}」的記憶時發生錯誤:`, error);
    }
}


function getFriendlinessLevel(value) {
    if (value >= 100) return 'devoted';
    if (value >= 70) return 'trusted';
    if (value >= 30) return 'friendly';
    if (value <= -100) return 'sworn_enemy';
    if (value <= -50) return 'hostile';
    if (value <= -10) return 'wary';
    return 'neutral';
}


// 【核心修改】移除函式中的即時創建邏輯，讓其職責單一化
async function getMergedNpcProfile(userId, npcName) {
    if (!userId || !npcName) {
        console.error('[NPC助手] getMergedNpcProfile缺少userId或npcName參數');
        return null;
    }

    try {
        const baseProfile = await getKnownNpcTemplate(npcName);

        if (!baseProfile) {
            console.log(`[NPC助手] 找不到NPC「${npcName}」的通用模板。`);
            return null;
        }
        
        const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);
        const npcStateDoc = await npcStateRef.get();

        if (npcStateDoc.exists) {
            const userSpecificState = npcStateDoc.data();
            return { ...baseProfile, ...userSpecificState, name: baseProfile.name || npcName };
        } else {
            // 即使玩家還沒有與該NPC的個人互動紀錄，只要通用模板存在，就回傳基礎資料
            return { ...baseProfile, name: baseProfile.name || npcName };
        }

    } catch (error) {
        console.error(`[NPC助手] 在獲取「${npcName}」的合併資料時發生錯誤:`, error);
        return null;
    }
}


async function updateFriendlinessValues(userId, username, npcChanges, roundData, playerProfile, batch) {
    if (!npcChanges || npcChanges.length === 0) return;

    const playerNpcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    const existingNpcIdsSnapshot = await playerNpcStatesRef.get();
    const existingNpcIds = new Set(existingNpcIdsSnapshot.docs.map(doc => doc.id));

    for (const change of npcChanges) {
        if (!change || !change.name) {
            console.warn(`[NPC助手] 偵測到一個無效的NPC物件 (缺少名字)，已略過。`, change);
            continue; 
        }

        const isTrulyNew = !existingNpcIds.has(change.name);
        
        if (change.isNew && isTrulyNew) {
            await createNewNpc(userId, username, change, roundData, playerProfile, batch);
        } else {
            const npcStateDocRef = playerNpcStatesRef.doc(change.name);
            const updatePayload = {};

            if (typeof change.friendlinessChange === 'number' && change.friendlinessChange !== 0) {
                try {
                    await db.runTransaction(async (transaction) => {
                        const npcStateDoc = await transaction.get(npcStateDocRef);
                        const currentFriendliness = npcStateDoc.data()?.friendlinessValue || 0;
                        const newFriendliness = currentFriendliness + change.friendlinessChange;
                        updatePayload.friendlinessValue = Math.max(-100, Math.min(100, newFriendliness));
                        transaction.set(npcStateDocRef, updatePayload, { merge: true });
                    });
                     console.log(`[友好度系統] 更新舊識「${change.name}」的友好度，新數值為: ${updatePayload.friendlinessValue}`);
                } catch (e) {
                     console.error(`[友好度系統] Transaction for ${change.name} failed: `, e);
                }
            }
        }
    }
}

async function updateRomanceValues(userId, romanceChanges) {
    if (!romanceChanges || romanceChanges.length === 0) return;
    const playerNpcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    
    for (const { npcName, valueChange } of romanceChanges) {
        if (!npcName || typeof valueChange !== 'number' || valueChange === 0) continue;
        
        const npcStateDocRef = playerNpcStatesRef.doc(npcName);
        try {
            await db.runTransaction(async (transaction) => {
                const npcStateDoc = await transaction.get(npcStateDocRef);
                const currentRomance = npcStateDoc.data()?.romanceValue || 0;
                const newRomance = currentRomance + valueChange;
                const finalRomance = Math.min(100, newRomance);
                transaction.set(npcStateDocRef, { romanceValue: finalRomance }, { merge: true });
                console.log(`[戀愛系統] 更新「${npcName}」心動值，新數值為: ${finalRomance}`);
            });
        } catch (error) {
            console.error(`[戀愛系統] 更新與NPC "${npcName}" 的心動值時出錯:`, error);
        }
    }
}

async function checkAndTriggerRomanceEvent(userId, playerProfile) {
    const playerNpcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    const statesSnapshot = await playerNpcStatesRef.where('romanceValue', '>=', 50).get();
    if (statesSnapshot.empty) return null;

    for (const stateDoc of statesSnapshot.docs) {
        const npcName = stateDoc.id;
        const npcState = stateDoc.data();
        const fullNpcProfile = await getMergedNpcProfile(userId, npcName);
        if (!fullNpcProfile) continue;

        const { romanceValue = 0, triggeredRomanceEvents = [] } = npcState;
        const eventTriggers = [{ level: 'level_2_confession', threshold: 150 }];

        for (const trigger of eventTriggers) {
            if (romanceValue >= trigger.threshold && !triggeredRomanceEvents.includes(trigger.level)) {
                console.log(`[戀愛系統] 偵測到與 ${npcName} 的 ${trigger.level} 事件觸發條件！`);
                const prompt = getRomanceEventPrompt(playerProfile, fullNpcProfile, trigger.level);
                try {
                    const romanceEventResultText = await callAI(aiConfig.romanceEvent, prompt, true);
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
        
        if (fieldToUpdate === 'isDeceased' && newValue === true) {
            console.log(`[生死簿系統] 偵測到NPC「${npcName}」的死亡指令，已加入批次處理佇列。`);
        } else {
            console.log(`[NPC檔案更新] 已將玩家 ${userId} 的NPC「${npcName}」欄位「${fieldToUpdate}」更新為：`, newValue);
        }
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
    updateFriendlinessValues,
    updateRomanceValues,
    checkAndTriggerRomanceEvent,
    processNpcUpdates,
    updateNpcMemoryAfterInteraction
};
