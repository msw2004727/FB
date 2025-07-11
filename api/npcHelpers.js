// api/npcHelpers.js
const admin = require('firebase-admin');
const { getAIPerNpcSummary, getRomanceEventPrompt } = require('../services/aiService');
const { createNewNpc } = require('../services/npcCreationService');
const { getIdentityForNewNpc } = require('./identityManager');

const db = admin.firestore();

/**
 * 更新指定NPC的個人記憶摘要
 * @param {string} userId - 玩家ID
 * @param {string} npcName - 要更新記憶的NPC名稱
 * @param {string} interactionData - 本次互動的文字摘要
 */
async function updateNpcMemoryAfterInteraction(userId, npcName, interactionData) {
    if (!userId || !npcName || !interactionData) {
        console.warn(`[NPC記憶系統] 因缺少必要參數，跳過為 ${npcName} 的記憶更新。`);
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
        
        // 注意：此處的'default'可以替換為玩家選擇的模型
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

/**
 * 獲取合併後的NPC資料 (基礎資料 + 玩家特定狀態)
 * v2.0: 新增邏輯 - 如果NPC基礎檔案不存在，則即時創建一個。
 * @param {string} userId - 玩家ID
 * @param {string} npcName - NPC姓名
 * @returns {Promise<Object|null>} - 合併後的NPC資料物件，或在找不到時返回null
 */
async function getMergedNpcProfile(userId, npcName) {
    if (!userId || !npcName) {
        console.error('[NPC助手] getMergedNpcProfile缺少userId或npcName參數');
        return null;
    }

    try {
        const npcRef = db.collection('npcs').doc(npcName);
        let npcDoc = await npcRef.get();
        let baseProfile;

        if (!npcDoc.exists) {
            console.log(`[NPC助手] 基礎檔案 for "${npcName}" 不存在，開始即時創建...`);
            
            const { identity, location } = await getIdentityForNewNpc(npcName);

            const newProfile = {
                name: npcName,
                status_title: identity,
                friendlinessValue: 50,
                romanceValue: 0,
                isDeceased: false,
                status: '安好',
                currentLocation: location || '未知',
                inventory: {},
                equipment: [],
                skills: [],
                personality: ["性格生成中..."],
                appearance: "外貌生成中...",
                age: "年齡不詳",
                background: `關於${npcName}的過去，江湖上流傳著許多版本，但無人知曉真相。`
            };

            await npcRef.set(newProfile);
            console.log(`[NPC助手] 已為 "${npcName}" 成功創建基礎檔案，身份為: ${identity}`);
            
            npcDoc = await npcRef.get();
            baseProfile = npcDoc.data();

        } else {
            baseProfile = npcDoc.data();
        }

        const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);
        const npcStateDoc = await npcStateRef.get();

        if (npcStateDoc.exists) {
            const userSpecificState = npcStateDoc.data();
            return { ...baseProfile, ...userSpecificState, name: baseProfile.name || npcName };
        } else {
            return { ...baseProfile, name: baseProfile.name || npcName };
        }

    } catch (error) {
        console.error(`[NPC助手] 在獲取 "${npcName}" 的資料時發生錯誤:`, error);
        return null;
    }
}


/**
 * 【核心重構】統一處理所有NPC友好度更新和檔案創建的函式
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 * @param {Array<object>} npcChanges - 從AI主函式傳來的NPC變化陣列
 * @param {object} roundData - 當前回合數據
 * @param {object} playerProfile - 玩家的完整檔案
 */
async function updateFriendlinessValues(userId, username, npcChanges, roundData, playerProfile) {
    if (!npcChanges || npcChanges.length === 0) return;

    const playerNpcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    const playerLocation = roundData.LOC && roundData.LOC.length > 0 ? roundData.LOC[roundData.LOC.length - 1] : '未知之地';
    const existingNpcIds = new Set((await playerNpcStatesRef.get()).docs.map(doc => doc.id));

    const batch = db.batch();

    for (const change of npcChanges) {
        if (!change.name) continue;

        const isTrulyNew = !existingNpcIds.has(change.name);
        if (isTrulyNew) {
            await createNewNpc(userId, username, change, roundData, playerProfile, batch, Array.from(existingNpcIds));
        } else {
            const npcStateDocRef = playerNpcStatesRef.doc(change.name);
            const updatePayload = { currentLocation: playerLocation };

            if (typeof change.friendlinessChange === 'number' && change.friendlinessChange !== 0) {
                try {
                    await db.runTransaction(async (transaction) => {
                        const npcStateDoc = await transaction.get(npcStateDocRef);
                        const currentFriendliness = npcStateDoc.data()?.friendlinessValue || 0;
                        const newFriendliness = currentFriendliness + change.friendlinessChange;
                        
                        // 確保友好度最高為100
                        updatePayload.friendlinessValue = Math.min(100, newFriendliness);
                        
                        transaction.set(npcStateDocRef, updatePayload, { merge: true });
                    });
                     console.log(`[友好度系統] 更新舊識「${change.name}」的友好度，新數值為: ${updatePayload.friendlinessValue}`);
                } catch (e) {
                     console.error(`[友好度系統] Transaction for ${change.name} failed: `, e);
                }
            } else {
                 batch.set(npcStateDocRef, updatePayload, { merge: true });
            }
        }
    }

    try {
        await batch.commit(); // 注意：Transaction外的操作仍需commit
        console.log(`[友好度系統] 批次更新NPC關係與位置完畢。`);
    } catch (error) {
        console.error(`[友好度系統] 批次更新NPC關係時出錯:`, error);
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

                // 確保心動值最高為100
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
        const npcProfile = await getMergedNpcProfile(userId, npcName);
        if (!npcProfile) continue;

        const { romanceValue = 0, triggeredRomanceEvents = [] } = npcState;
        const eventTriggers = [{ level: 'level_2_confession', threshold: 150 }];

        for (const trigger of eventTriggers) {
            if (romanceValue >= trigger.threshold && !triggeredRomanceEvents.includes(trigger.level)) {
                console.log(`[戀愛系統] 偵測到與 ${npcName} 的 ${trigger.level} 事件觸發條件！`);
                const romanceEventResultText = await getRomanceEventPrompt(playerProfile, npcProfile, trigger.level);
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
