// /api/gameHelpers.js
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const { getAINpcProfile, getAIRomanceEvent, callAI, aiConfig } = require('../services/aiService');
const { getNpcCreatorPrompt } = require('../prompts/npcCreatorPrompt.js');
const { getSkillGeneratorPrompt } = require('../prompts/skillGeneratorPrompt.js');
const { getOrGenerateItemTemplate } = require('./itemManager');
const { generateAndCacheLocation } = require('./worldEngine');
// --- 新增的程式碼 ---
const { processNpcRelationships } = require('./relationshipManager');
// --- 程式碼修改結束 ---

const db = admin.firestore();

const TIME_SEQUENCE = ['清晨', '上午', '中午', '下午', '黃昏', '夜晚', '深夜'];
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];


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
            console.warn(`[NPC系統] 找不到名為「${npcName}」的通用模板。`);
            return null;
        }

        const templateData = templateDoc.data();
        const stateData = stateDoc.exists ? stateDoc.data() : {};

        return { ...templateData, ...stateData };

    } catch (error) {
        console.error(`[NPC系統] 合併NPC「${npcName}」的資料時出錯:`, error);
        return null;
    }
}


async function getOrGenerateSkillTemplate(skillName) {
    if (!skillName) return null;
    const skillTemplateRef = db.collection('skills').doc(skillName);
    try {
        const doc = await skillTemplateRef.get();
        if (doc.exists) {
            return doc.data();
        }
        console.log(`[武學總綱] 武學「${skillName}」的總綱不存在，啟動AI生成...`);
        const prompt = getSkillGeneratorPrompt(skillName);
        const skillJsonString = await callAI(aiConfig.skillTemplate || 'openai', prompt, true);
        const newTemplateData = JSON.parse(skillJsonString);
        if (!newTemplateData.skillName) {
            throw new Error('AI生成的武學模板缺少必要的skillName欄位。');
        }
        newTemplateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        await skillTemplateRef.set(newTemplateData);
        console.log(`[武學總綱] 成功為「${skillName}」建立並儲存了總綱模板。`);
        const newDoc = await skillTemplateRef.get();
        return newDoc.data();
    } catch (error) {
        console.error(`[武學總綱] 在處理武學「${skillName}」的總綱時發生錯誤:`, error);
        return null;
    }
}


const getMergedLocationData = async (userId, locationArray) => {
    if (!locationArray || locationArray.length === 0 || locationArray[0] === '無') {
        return null;
    }
    const mainLocationName = locationArray[0];
    const subLocationName = locationArray.length > 1 ? locationArray[1] : null;
    try {
        const staticDocRef = db.collection('locations').doc(mainLocationName);
        const dynamicDocRef = db.collection('users').doc(userId).collection('location_states').doc(mainLocationName);
        const [staticDoc, dynamicDoc] = await Promise.all([
            staticDocRef.get(),
            dynamicDocRef.get()
        ]);
        if (!staticDoc.exists) {
            console.log(`[讀取系統] 偵測到玩家 ${userId} 的全新地點: ${mainLocationName}，將在背景生成...`);
            generateAndCacheLocation(userId, mainLocationName, '未知', '初次抵達，資訊尚不明朗。')
                .catch(err => console.error(`[世界引擎] 地點 ${mainLocationName} 的背景生成失敗:`, err));
            return { locationId: mainLocationName, locationName: mainLocationName, description: "此地詳情尚在傳聞之中..." };
        }
        if (staticDoc.exists && !dynamicDoc.exists) {
             console.log(`[讀取系統] 模板存在，但玩家 ${userId} 的地點狀態不存在: ${mainLocationName}，將在背景初始化...`);
             generateAndCacheLocation(userId, mainLocationName, '未知', '初次抵達，資訊尚不明朗。')
                .catch(err => console.error(`[世界引擎] 地點 ${mainLocationName} 的背景生成失敗:`, err));
        }
        const staticData = staticDoc.data() || {};
        const dynamicData = dynamicDoc.data() || {};
        let mergedData = { ...staticData, ...dynamicData };
        if (subLocationName && mergedData.facilities && Array.isArray(mergedData.facilities)) {
            const facilityData = mergedData.facilities.find(f => f.facilityName === subLocationName);
            if (facilityData) {
                mergedData.description = facilityData.description || mergedData.description;
                mergedData.currentFacility = facilityData;
            }
        }
        return mergedData;
    } catch (error) {
        console.error(`[讀取系統] 合併地點 ${mainLocationName} 的資料時出錯:`, error);
        return { locationId: mainLocationName, locationName: mainLocationName, description: "讀取此地詳情時發生錯誤..." };
    }
};

const getFriendlinessLevel = (value) => {
    if (value >= 100) return 'devoted';
    if (value >= 70) return 'trusted';
    if (value >= 30) return 'friendly';
    if (value <= -100) return 'sworn_enemy';
    if (value <= -50) return 'hostile';
    if (value <= -10) return 'wary';
    return 'neutral';
};

const advanceDate = (currentDate) => {
    let { year, month, day, yearName } = currentDate;
    day++;
    if (day > DAYS_IN_MONTH[month]) {
        day = 1;
        month++;
        if (month > 12) { month = 1; year++; }
    }
    return { year, month, day, yearName };
};

const invalidateNovelCache = async (userId) => {
    try {
        const novelCacheRef = db.collection('users').doc(userId).collection('game_state').doc('novel_cache');
        await novelCacheRef.delete();
        console.log(`[小說快取系統] 已成功清除玩家 ${userId} 的小說快取。`);
    } catch (error) {
        console.error(`[小說快取系統] 清除玩家 ${userId} 的小說快取時發生錯誤:`, error);
    }
};

const updateLibraryNovel = async (userId, username) => {
    try {
        const userSavesRef = db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
        const snapshot = await userSavesRef;
        if (snapshot.empty) return;
        const storyChapters = snapshot.docs.map(doc => {
            const roundData = doc.data();
            const title = roundData.EVT || `第 ${roundData.R} 回`;
            const content = roundData.story || "這段往事，已淹沒在時間的長河中。";
            return `<div class="chapter"><h2>${title}</h2><p>${content.replace(/\n/g, '<br>')}</p></div>`;
        });
        const fullStoryHTML = storyChapters.join('');
        const lastRoundData = snapshot.docs[snapshot.docs.length - 1].data();
        const isDeceased = lastRoundData.playerState === 'dead';
        const yearName = lastRoundData.yearName || '元祐';
        const year = lastRoundData.year || 1;
        const month = lastRoundData.month || 1;
        const day = lastRoundData.day || 1;
        const latestEvent = lastRoundData.EVT || '初入江湖';
        const novelTitle = `江湖路 - ${yearName}${year}年${month}月${day}日 - ${latestEvent} (${username})`;
        const libraryDocRef = db.collection('library_novels').doc(userId);
        await libraryDocRef.set({
            playerName: username,
            novelTitle: novelTitle,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            storyHTML: fullStoryHTML,
            isDeceased,
            lastChapterTitle: lastRoundData.EVT || `第 ${lastRoundData.R} 回`
        }, { merge: true });
        console.log(`[圖書館系統] 成功更新 ${username} 的小說至圖書館！`);
    } catch (error) {
        console.error(`[圖書館系統] 更新 ${username} 的小說時發生錯誤:`, error);
    }
};

const createNpcProfileInBackground = async (userId, username, npcData, roundData, playerProfile) => {
    const npcName = npcData.name;
    console.log(`[NPC系統] UserId: ${userId}。偵測到新NPC: "${npcName}"，已啟動背景建檔程序...`);
    
    try {
        const npcTemplateRef = db.collection('npcs').doc(npcName);
        const playerNpcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);

        let templateDoc = await npcTemplateRef.get();
        if (!templateDoc.exists) {
            const prompt = getNpcCreatorPrompt(username, npcName, roundData, playerProfile);
            const npcJsonString = await callAI(aiConfig.npcProfile, prompt, true);
            
            const cleanedJsonString = npcJsonString.replace(/^```json\s*|```\s*$/g, '');
            const newTemplateData = JSON.parse(cleanedJsonString);
            
            if (newTemplateData.createdAt === "CURRENT_TIMESTAMP") {
                newTemplateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
            }
            await npcTemplateRef.set(newTemplateData);
            console.log(`[NPC系統] 成功為「${npcName}」建立並儲存了通用模板。`);

            // --- 新增的程式碼 ---
            // 在模板建立成功後，立即觸發關係更新器
            if (newTemplateData.relationships) {
                await processNpcRelationships(userId, npcName, newTemplateData.relationships);
            }
            // --- 程式碼修改結束 ---
        }

        const stateDoc = await playerNpcStateRef.get();
        if (!stateDoc.exists) {
            const initialState = {
                friendlinessValue: 0,
                romanceValue: 0,
                currentLocation: roundData.LOC[0],
                firstMet: {
                    round: roundData.R,
                    time: `${roundData.yearName}${roundData.year}-${roundData.month}-${roundData.day} ${roundData.timeOfDay}`,
                    location: roundData.LOC[0],
                    event: roundData.EVT
                },
                isDeceased: false,
                inventory: {}
            };
            await playerNpcStateRef.set(initialState);
            console.log(`[NPC系統] 成功為玩家 ${userId} 初始化了與「${npcName}」的關係檔案。`);
        }

    } catch (error) {
        console.error(`[NPC系統] 為 "${npcName}" 進行背景建檔時發生錯誤:`, error);
    }
};

const updateInventory = async (userId, itemChanges) => {
    if (!itemChanges || itemChanges.length === 0) return;
    const userInventoryRef = db.collection('users').doc(userId).collection('inventory_items');
    const batch = db.batch();
    for (const change of itemChanges) {
        const { action, itemName, quantity = 1 } = change;
        if (!itemName) continue;
        const template = await getOrGenerateItemTemplate(itemName);
        if (!template) {
            console.error(`[物品系統] 無法為 "${itemName}" 獲取或生成設計圖，跳過此物品。`);
            continue;
        }
        const isStackable = ['材料', '財寶', '道具', '其他'].includes(template.itemType);
        if (action === 'add') {
            if (isStackable) {
                const stackableItemRef = userInventoryRef.doc(itemName);
                batch.set(stackableItemRef, {
                    templateId: itemName,
                    quantity: admin.firestore.FieldValue.increment(quantity),
                    lastAcquiredAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            } else {
                for (let i = 0; i < quantity; i++) {
                    const newItemId = uuidv4();
                    const newItemRef = userInventoryRef.doc(newItemId);
                    batch.set(newItemRef, {
                        instanceId: newItemId,
                        templateId: itemName,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        durability: 100
                    });
                }
            }
        } else if (action === 'remove') {
            if (isStackable) {
                const stackableItemRef = userInventoryRef.doc(itemName);
                const currentItemDoc = await stackableItemRef.get();
                if (currentItemDoc.exists) {
                    const currentQuantity = currentItemDoc.data().quantity || 0;
                    const newQuantity = currentQuantity - quantity;
                    if (newQuantity > 0) {
                        batch.update(stackableItemRef, { quantity: newQuantity });
                    } else {
                        batch.delete(stackableItemRef);
                    }
                }
            }
        } else if (action === 'remove_all' && change.itemType) {
            const itemsToDeleteSnapshot = await userInventoryRef.where('itemType', '==', change.itemType).get();
            itemsToDeleteSnapshot.forEach(doc => batch.delete(doc.ref));
        }
    }
    await batch.commit();
    console.log(`[物品系統] 已為玩家 ${userId} 完成批次庫存更新。`);
};

const updateFriendlinessValues = async (userId, npcChanges) => {
    if (!npcChanges || npcChanges.length === 0) return;
    const playerNpcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    const promises = npcChanges.map(async (change) => {
        if (!change.name || typeof change.friendlinessChange !== 'number' || change.friendlinessChange === 0) {
            return;
        }
        const npcStateDocRef = playerNpcStatesRef.doc(change.name);
        try {
            await db.runTransaction(async (transaction) => {
                const npcStateDoc = await transaction.get(npcStateDocRef);
                if (!npcStateDoc.exists) {
                    transaction.set(npcStateDocRef, { friendlinessValue: change.friendlinessChange });
                    return;
                }
                const currentFriendliness = npcStateDoc.data().friendlinessValue || 0;
                const newFriendlinessValue = currentFriendliness + change.friendlinessChange;
                transaction.update(npcStateDocRef, { 
                    friendlinessValue: newFriendlinessValue,
                });
            });
        } catch (error) {
            console.error(`[友好度系統] 更新與NPC "${change.name}" 的關係時出錯:`, error);
        }
    });
    await Promise.all(promises);
};

const updateRomanceValues = async (userId, romanceChanges) => {
    if (!romanceChanges || romanceChanges.length === 0) return;
    const playerNpcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    const promises = romanceChanges.map(async ({ npcName, valueChange }) => {
        if (!npcName || typeof valueChange !== 'number' || valueChange === 0) return;
        const npcStateDocRef = playerNpcStatesRef.doc(npcName);
        try {
            await npcStateDocRef.set({ 
                romanceValue: admin.firestore.FieldValue.increment(valueChange) 
            }, { merge: true });
        } catch (error) {
            console.error(`[戀愛系統] 更新與NPC "${npcName}" 的心動值時出錯:`, error);
        }
    });
    await Promise.all(promises);
};

const checkAndTriggerRomanceEvent = async (userId, playerProfile) => {
    const playerNpcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    const statesSnapshot = await playerNpcStatesRef.where('romanceValue', '>=', 50).get();
    if (statesSnapshot.empty) return null;

    for (const stateDoc of statesSnapshot.docs) {
        const npcName = stateDoc.id;
        const npcState = stateDoc.data();
        const npcProfile = await getMergedNpcProfile(userId, npcName);
        if (!npcProfile) continue;

        const { romanceValue = 0, triggeredRomanceEvents = [] } = npcState;
        const eventTriggers = [ { level: 'level_2_confession', threshold: 150 } ];
        
        for (const trigger of eventTriggers) {
            if (romanceValue >= trigger.threshold && !triggeredRomanceEvents.includes(trigger.level)) {
                console.log(`[戀愛系統] 偵測到與 ${npcName} 的 ${trigger.level} 事件觸發條件！`);
                const romanceEventResultText = await getAIRomanceEvent(playerProfile, npcProfile, trigger.level);
                try {
                    const romanceEventResult = JSON.parse(romanceEventResultText);
                    if (romanceEventResult && romanceEventResult.story) {
                        await stateDoc.ref.update({
                            triggeredRomanceEvents: admin.firestore.FieldValue.arrayUnion(trigger.level)
                        });
                        return {
                            eventStory: romanceEventResult.story,
                            npcUpdates: romanceEventResult.npcUpdates || []
                        };
                    }
                } catch(e){
                     console.error('[戀愛系統] 解析AI回傳的戀愛事件JSON時出錯:', e);
                     return null;
                }
            }
        }
    }
    return null; 
};

const getInventoryState = async (userId) => {
    const playerInventoryRef = db.collection('users').doc(userId).collection('inventory_items');
    const snapshot = await playerInventoryRef.get();
    if (snapshot.empty) return { money: 0, itemsString: '身無長物' };
    let money = 0;
    const itemCounts = {};
    snapshot.forEach(doc => {
        const item = doc.data();
        const itemName = item.templateId; 
        const quantity = item.quantity || 1;
        if (itemName === '銀兩') {
            money += quantity;
        } else {
            itemCounts[itemName] = (itemCounts[itemName] || 0) + quantity;
        }
    });
    const otherItems = Object.entries(itemCounts).map(([name, count]) => `${name} x${count}`);
    return { money, itemsString: otherItems.length > 0 ? otherItems.join('、') : '身無長物' };
};

const getRawInventory = async (userId) => {
    const playerInventoryRef = db.collection('users').doc(userId).collection('inventory_items');
    const snapshot = await playerInventoryRef.get();
    if (snapshot.empty) return {};
    const inventoryData = {};
    for (const doc of snapshot.docs) {
        const playerData = doc.data();
        const templateId = playerData.templateId;
        if (!templateId) continue;
        const template = await getOrGenerateItemTemplate(templateId);
        if (template) {
            inventoryData[doc.id] = { ...template, ...playerData };
        }
    }
    return inventoryData;
};

const updateSkills = async (userId, skillChanges) => {
    if (!skillChanges || skillChanges.length === 0) return [];
    const playerSkillsRef = db.collection('users').doc(userId).collection('skills');
    const levelUpEvents = [];
    for (const skillChange of skillChanges) {
        const playerSkillDocRef = playerSkillsRef.doc(skillChange.skillName);
        try {
            await db.runTransaction(async (transaction) => {
                if (skillChange.isNewlyAcquired) {
                    const template = await getOrGenerateSkillTemplate(skillChange.skillName);
                    if (!template) {
                        console.error(`無法為「${skillChange.skillName}」獲取或生成模板，跳過此武學。`);
                        return;
                    }
                    const playerSkillData = {
                        level: skillChange.level || 0,
                        exp: skillChange.exp || 0,
                        lastPractice: admin.firestore.FieldValue.serverTimestamp()
                    };
                    transaction.set(playerSkillDocRef, playerSkillData);
                    console.log(`[武學系統] 玩家 ${userId} 習得新武學: ${skillChange.skillName}，初始等級: ${playerSkillData.level}`);
                } else if (skillChange.expChange > 0) {
                    const playerSkillDoc = await transaction.get(playerSkillDocRef);
                    if (!playerSkillDoc.exists) {
                        console.warn(`[武學系統] 玩家 ${userId} 試圖修練不存在的武學: ${skillChange.skillName}`);
                        return;
                    }
                    const template = await getOrGenerateSkillTemplate(skillChange.skillName);
                    if (!template) return;
                    let currentData = playerSkillDoc.data();
                    let currentLevel = currentData.level || 0;
                    let currentExp = currentData.exp || 0;
                    const maxLevel = template.max_level || 10;
                    if (currentLevel >= maxLevel) {
                         console.log(`[武學系統] 武學 ${skillChange.skillName} 已達最高等級(${maxLevel})。`);
                         return;
                    }
                    currentExp += skillChange.expChange;
                    let requiredExp = (currentLevel === 0) ? 100 : currentLevel * 100;
                    while (currentExp >= requiredExp && currentLevel < maxLevel) {
                        currentLevel++;
                        currentExp -= requiredExp;
                        levelUpEvents.push({ skillName: skillChange.skillName, levelUpTo: currentLevel });
                        if(currentLevel < maxLevel) {
                            requiredExp = currentLevel * 100;
                        } else {
                            currentExp = 0;
                        }
                    }
                    transaction.update(playerSkillDocRef, { level: currentLevel, exp: currentExp });
                    console.log(`[武學系統] 玩家 ${userId} 修練 ${skillChange.skillName}，熟練度增加 ${skillChange.expChange}。等級: ${currentLevel}, 熟練度: ${currentExp}`);
                }
            });
        } catch (error) {
            console.error(`[武學系統] 更新武學 ${skillChange.skillName} 時發生錯誤:`, error);
        }
    }
    return levelUpEvents;
};

const getPlayerSkills = async (userId) => {
    const playerSkillsRef = db.collection('users').doc(userId).collection('skills');
    const playerSkillsSnapshot = await playerSkillsRef.get();
    if (playerSkillsSnapshot.empty) return [];
    const mergedSkills = [];
    for (const playerSkillDoc of playerSkillsSnapshot.docs) {
        const skillName = playerSkillDoc.id;
        const playerData = playerSkillDoc.data();
        const template = await getOrGenerateSkillTemplate(skillName);
        if (template) {
            mergedSkills.push({
                ...template,
                level: playerData.level,
                exp: playerData.exp
            });
        }
    }
    return mergedSkills;
};

const processNpcUpdates = async (userId, updates) => {
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
        console.log(`[NPC關係系統] 已將玩家 ${userId} 與「${npcName}」的關係欄位「${fieldToUpdate}」更新為：`, newValue);
    }
    try {
        await batch.commit();
        console.log(`[NPC關係系統] 玩家與NPC的關係狀態已批次更新。`);
    } catch (error) {
        console.error(`[NPC關係系統] 為玩家 ${userId} 更新NPC關係時發生錯誤:`, error);
    }
};

module.exports = {
    TIME_SEQUENCE,
    getFriendlinessLevel,
    advanceDate,
    invalidateNovelCache,
    updateLibraryNovel,
    createNpcProfileInBackground,
    updateInventory,
    updateFriendlinessValues,
    updateRomanceValues,
    checkAndTriggerRomanceEvent,
    getInventoryState,
    getRawInventory,
    updateSkills,
    getPlayerSkills,
    processNpcUpdates,
    getMergedLocationData,
    getMergedNpcProfile,
};
