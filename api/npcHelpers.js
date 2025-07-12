// api/npcHelpers.js
const admin = require('firebase-admin');
const { callAI, aiConfig, getAIPerNpcSummary } = require('../services/aiService'); 
const { getNpcCreatorPrompt } = require('../prompts/npcCreatorPrompt.js');
const { getRomanceEventPrompt } = require('../prompts/romanceEventPrompt.js');
const { processNpcRelationships } = require('./relationshipManager');

const db = admin.firestore();

/**
 * 【核心新增】根據NPC的職業和地位，為其生成一個合理的初始金錢。
 * @param {object} npcProfile - NPC的通用模板資料
 * @returns {number} - 應有的金錢數量
 */
function getMoneyForNpc(npcProfile) {
    if (!npcProfile) return 10; // 如果沒有資料，給一個保底值
    const occupation = npcProfile.occupation || '';
    const status = npcProfile.status_title || '';
    let money = Math.floor(Math.random() * 50) + 10; // 基礎平民: 10-60文

    if (['富商', '老闆', '掌櫃', '員外'].some(kw => occupation.includes(kw) || status.includes(kw))) {
        money = Math.floor(Math.random() * 5000) + 1000; // 富裕階層: 1000-6000文
    } else if (['官', '捕頭', '將軍', '知府', '縣令'].some(kw => occupation.includes(kw) || status.includes(kw))) {
        money = Math.floor(Math.random() * 2000) + 500; // 公職人員: 500-2500文
    } else if (['殺手', '遊俠', '鏢頭', '刺客'].some(kw => occupation.includes(kw) || status.includes(kw))) {
        money = Math.floor(Math.random() * 800) + 200; // 江湖人士: 200-1000文
    } else if (['鐵匠', '郎中', '教頭', '工匠', '廚師'].some(kw => occupation.includes(kw) || status.includes(kw))) {
        money = Math.floor(Math.random() * 400) + 100; // 專業人士: 100-500文
    } else if (['乞丐', '難民', '流民'].some(kw => occupation.includes(kw) || status.includes(kw))) {
        money = Math.floor(Math.random() * 10); // 赤貧階層: 0-9文
    }
    
    console.log(`[NPC經濟系統] 根據身份 [${occupation}/${status}]，為NPC生成了 ${money} 文錢。`);
    return money;
}

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


/**
 * 【重構核心】此函式現在僅負責生成公用模板，不再寫入DB
 * @param {string} username - 玩家名稱
 * @param {object} npcData - AI回傳的NPC基礎數據
 * @param {object} roundData - 當前回合數據
 * @param {object} playerProfile - 玩家的完整檔案
 * @returns {Promise<object|null>} - 生成的NPC模板數據或null
 */
async function generateNpcTemplateData(username, npcData, roundData, playerProfile) {
    const npcName = npcData.name;
    try {
        console.log(`[NPC系統] 「${npcName}」的通用模板不存在，啟動背景AI生成...`);
        const prompt = getNpcCreatorPrompt(username, npcName, roundData, playerProfile);
        const npcJsonString = await callAI(aiConfig.npcProfile, prompt, true);
        const newTemplateData = JSON.parse(npcJsonString.replace(/^```json\s*|```\s*$/g, ''));

        const rand = Math.random();
        newTemplateData.romanceOrientation = rand < 0.7 ? "異性戀" : rand < 0.85 ? "雙性戀" : rand < 0.95 ? "同性戀" : "無性戀";
        
        const encounterLocation = roundData.LOC && roundData.LOC.length > 0 ? roundData.LOC[0] : '未知之地';
        if (!newTemplateData.currentLocation) {
             newTemplateData.currentLocation = encounterLocation;
        }
        
        return newTemplateData;

    } catch (error) {
        console.error(`[NPC系統] 為 "${npcName}" 進行背景AI生成時發生錯誤:`, error);
        return null;
    }
}


/**
 * 【重構核心】統一處理所有NPC友好度、關係和檔案創建的函式
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 * @param {Array<object>} npcChanges - 從AI主函式傳來的NPC變化陣列
 * @param {object} roundData - 當前回合數據
 * @param {object} playerProfile - 玩家的完整檔案
 */
async function updateFriendlinessValues(userId, username, npcChanges, roundData, playerProfile) {
    if (!npcChanges || npcChanges.length === 0) return;

    const playerNpcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    const batch = db.batch();
    
    const playerLocation = roundData.LOC && roundData.LOC.length > 0 ? roundData.LOC[0] : '未知之地';

    const existingNpcSnapshot = await playerNpcStatesRef.get();
    const existingNpcIds = new Set(existingNpcSnapshot.docs.map(doc => doc.id));
    console.log('[友好度系統] 已建立玩家的現存NPC名單:', Array.from(existingNpcIds));

    for (const change of npcChanges) {
        if (!change.name) continue;
        
        const npcStateDocRef = playerNpcStatesRef.doc(change.name);
        const isTrulyNew = !existingNpcIds.has(change.name);

        if (isTrulyNew) {
            console.log(`[友好度系統] 偵測到全新NPC「${change.name}」，啟動完整建檔流程...`);
            
            // 步驟 1: 檢查並建立公用模板 (如果不存在)
            const npcTemplateRef = db.collection('npcs').doc(change.name);
            let templateDoc = await npcTemplateRef.get();
            let npcTemplateData;

            if (!templateDoc.exists) {
                npcTemplateData = await generateNpcTemplateData(username, change, roundData, playerProfile);
                if (npcTemplateData) {
                    npcTemplateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
                    batch.set(npcTemplateRef, npcTemplateData);
                    console.log(`[NPC系統] 已將「${change.name}」的通用模板加入批次創建佇列。`);
                    
                    if (npcTemplateData.relationships) {
                        // 注意：關係處理是異步的，但我們不在此阻塞主流程
                        processNpcRelationships(userId, change.name, npcTemplateData.relationships)
                            .catch(err => console.error(`[關係引擎背景錯誤] NPC: ${change.name}, UserID: ${userId}, 錯誤:`, err));
                    }
                }
            } else {
                npcTemplateData = templateDoc.data();
                console.log(`[NPC系統] 「${change.name}」的通用模板已存在，跳過AI生成。`);
            }

            // 步驟 2: 根據模板建立玩家專屬的NPC狀態檔案
            const encounterTime = `${roundData.yearName || '元祐'}${roundData.year || 1}年${roundData.month || 1}月${roundData.day || 1}日 ${roundData.timeOfDay || '未知時辰'}`;
            const initialMoney = getMoneyForNpc(npcTemplateData);
            
            const updatePayload = {
                currentLocation: playerLocation,
                interactionSummary: `你與${change.name}的交往尚淺。`,
                firstMet: {
                    round: roundData.R,
                    time: encounterTime,
                    location: playerLocation,
                    event: roundData.EVT || '初次相遇'
                },
                isDeceased: false,
                inventory: { '銀兩': initialMoney },
                romanceValue: 0,
                friendlinessValue: change.friendlinessChange || 0,
                triggeredRomanceEvents: []
            };
            batch.set(npcStateDocRef, updatePayload);
            console.log(`[友好度系統] 已為新NPC「${change.name}」建立完整的玩家專屬狀態檔案。`);

        } else {
            // 對於舊識，只更新友好度和位置
            const updatePayload = { currentLocation: playerLocation };
            if (typeof change.friendlinessChange === 'number' && change.friendlinessChange !== 0) {
                console.log(`[友好度系統] 更新舊識「${change.name}」的友好度: ${change.friendlinessChange > 0 ? '+' : ''}${change.friendlinessChange}`);
                updatePayload.friendlinessValue = admin.firestore.FieldValue.increment(change.friendlinessChange);
            }
            batch.set(npcStateDocRef, updatePayload, { merge: true });
        }
    }
    
    try {
        await batch.commit();
        console.log(`[友好度系統] 批次更新NPC關係與位置完畢。`);
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
        console.log(`[NPC檔案更新] 已將玩家 ${userId} 的NPC「${npcName}」欄位「${fieldToUpdate}」更新為：`, newValue);
    }
    try {
        await batch.commit();
        console.log(`[NPC檔案更新] 玩家與NPC的檔案狀態已批次更新。`);
    } catch (error) {
        console.error(`[NPC檔案更新] 為玩家 ${userId} 更新NPC檔案時發生錯誤:`, error);
    }
}

// 導出 createNpcProfileInBackground 以便 GM 工具可以繼續使用
module.exports = {
    getMoneyForNpc,
    getFriendlinessLevel,
    getMergedNpcProfile,
    createNpcProfileInBackground: generateNpcTemplateData, // 讓舊的GM工具呼叫指向新的生成函式
    updateFriendlinessValues,
    updateRomanceValues,
    checkAndTriggerRomanceEvent,
    processNpcUpdates,
    updateNpcMemoryAfterInteraction
};
