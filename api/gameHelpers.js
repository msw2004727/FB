// /api/gameHelpers.js
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const { getAINpcProfile, getAIRomanceEvent, callAI, aiConfig } = require('../services/aiService');
const { getNpcCreatorPrompt } = require('../prompts/npcCreatorPrompt.js');
const { getSkillGeneratorPrompt } = require('../prompts/skillGeneratorPrompt.js');
const { getOrGenerateItemTemplate } = require('./itemManager');
const { generateAndCacheLocation } = require('./worldEngine');
const { processNpcRelationships } = require('./relationshipManager');

const db = admin.firestore();

const skillTemplateCache = new Map();

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

    if (skillTemplateCache.has(skillName)) {
        return { template: skillTemplateCache.get(skillName), isNew: false };
    }
    
    const skillTemplateRef = db.collection('skills').doc(skillName);
    try {
        const doc = await skillTemplateRef.get();
        if (doc.exists) {
            const templateData = doc.data();
            skillTemplateCache.set(skillName, templateData);
            return { template: templateData, isNew: false };
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
        
        const newDoc = await skillTemplateRef.get();
        const finalTemplateData = newDoc.data();
        skillTemplateCache.set(skillName, finalTemplateData);
        
        console.log(`[武學總綱] 成功為「${skillName}」建立並儲存了總綱模板。`);
        return { template: finalTemplateData, isNew: true };

    } catch (error) {
        console.error(`[武學總綱] 在處理武學「${skillName}」的總綱時發生錯誤:`, error);
        return null;
    }
}

const getMergedLocationData = async (userId, locationName) => {
    if (!locationName) return null;

    let currentLocationName = locationName;
    let mergedData = {};
    const locationHierarchy = []; // 從子到父

    try {
        while (currentLocationName) {
            const staticDocRef = db.collection('locations').doc(currentLocationName);
            const dynamicDocRef = db.collection('users').doc(userId).collection('location_states').doc(currentLocationName);

            const [staticDoc, dynamicDoc] = await Promise.all([
                staticDocRef.get(),
                dynamicDocRef.get()
            ]);

            if (!staticDoc.exists) {
                console.log(`[讀取系統] 偵測到全新地點: ${currentLocationName}，將在背景生成...`);
                await generateAndCacheLocation(userId, currentLocationName, '未知', '初次抵達，資訊尚不明朗。');
                // 因為是新地點，我們在這裡停止向上查找，避免錯誤
                const tempNewLoc = { locationId: currentLocationName, locationName: currentLocationName, description: "此地詳情尚在傳聞之中..." };
                locationHierarchy.unshift(tempNewLoc);
                break; 
            }
             if (staticDoc.exists && !dynamicDoc.exists) {
                 console.log(`[讀取系統] 模板存在，但玩家 ${userId} 的地點狀態不存在: ${currentLocationName}，將在背景初始化...`);
                 await generateAndCacheLocation(userId, currentLocationName, '未知', '初次抵達，資訊尚不明朗。');
            }

            const staticData = staticDoc.data() || {};
            const dynamicData = dynamicDoc.exists ? dynamicDoc.data() : {};
            
            locationHierarchy.unshift({ ...staticData, ...dynamicData });
            currentLocationName = staticData.parentLocation;
        }

        // 從最高層級開始向下合併數據
        locationHierarchy.forEach(loc => {
            mergedData = { ...mergedData, ...loc };
        });
        
        // 確保最底層的描述和名稱是最終結果
        const deepestLocation = locationHierarchy[locationHierarchy.length - 1];
        if (deepestLocation) {
            mergedData.locationName = deepestLocation.locationName;
            mergedData.description = deepestLocation.description;
        }
        
        mergedData.locationHierarchy = locationHierarchy.map(loc => loc.locationName);

        return mergedData;
        
    } catch (error) {
        console.error(`[讀取系統] 獲取地點「${locationName}」的層級資料時出錯:`, error);
        return { locationId: locationName, locationName: locationName, description: "讀取此地詳情時發生錯誤..." };
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
        const novelTitle = `${username}的江湖路`;
        const libraryDocRef = db.collection('library_novels').doc(userId);

        await libraryDocRef.set({
            playerName: username,
            novelTitle: novelTitle,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            storyHTML: fullStoryHTML,
            isDeceased,
            lastChapterTitle: lastRoundData.EVT || `第 ${lastRoundData.R} 回`,
            lastChapterData: lastRoundData
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
            
            const rand = Math.random();
            if (rand < 0.7) {
                newTemplateData.romanceOrientation = "異性戀";
            } else if (rand < 0.85) {
                newTemplateData.romanceOrientation = "雙性戀";
            } else if (rand < 0.95) {
                newTemplateData.romanceOrientation = "同性戀";
            } else {
                newTemplateData.romanceOrientation = "無性戀";
            }
            console.log(`[戀愛傾向系統] 已為NPC「${npcName}」隨機指派戀愛傾向為: ${newTemplateData.romanceOrientation}`);

            if (newTemplateData.createdAt === "CURRENT_TIMESTAMP") {
                newTemplateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
            }
            await npcTemplateRef.set(newTemplateData);
            console.log(`[NPC系統] 成功為「${npcName}」建立並儲存了通用模板。`);

            if (newTemplateData.relationships) {
                await processNpcRelationships(userId, npcName, newTemplateData.relationships);
            }
        }

        const stateDoc = await playerNpcStateRef.get();
        if (!stateDoc.exists) {
            const templateData = (await npcTemplateRef.get()).data();
            const initialState = {
                friendlinessValue: npcData.friendlinessChange || 0,
                romanceValue: 0,
                interactionSummary: `你與${npcName}的交往尚淺，還沒有什麼值得一提的共同回憶。`,
                currentLocation: templateData.currentLocation || roundData.LOC[0],
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

const updateInventory = async (userId, itemChanges, roundData = {}) => {
    if (!itemChanges || itemChanges.length === 0) return;
    const userInventoryRef = db.collection('users').doc(userId).collection('inventory_items');
    const batch = db.batch();

    const uniqueItemNames = [...new Set(itemChanges.map(c => c.itemName).filter(Boolean))];
    const templatePromises = uniqueItemNames.map(name => getOrGenerateItemTemplate(name, roundData));
    const templateResults = await Promise.all(templatePromises);
    
    const templates = new Map();
    uniqueItemNames.forEach((name, index) => {
        if (templateResults[index] && templateResults[index].template) {
            templates.set(name, templateResults[index].template);
        }
    });

    for (const change of itemChanges) {
        const { action, itemName, quantity = 1 } = change;
        if (!itemName) continue;
        
        const template = templates.get(itemName);
        
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
                    if (currentQuantity > quantity) {
                        batch.update(stackableItemRef, { quantity: admin.firestore.FieldValue.increment(-quantity) });
                    } else {
                        batch.delete(stackableItemRef);
                    }
                }
            } else {
                 console.warn(`[物品系統] GM工具尚不支援精準移除唯一的非堆疊物品: ${itemName}`);
            }
        } else if (action === 'remove_all' && change.itemType) {
            const itemsToDeleteSnapshot = await userInventoryRef.where('itemType', '==', change.itemType).get();
            itemsToDeleteSnapshot.forEach(doc => batch.delete(doc.ref));
        }
    }
    await batch.commit();
    console.log(`[物品系統] 已為玩家 ${userId} 完成批次庫存更新。`);
};

// ... a lot of other functions are omitted for brevity ...
// (The rest of the file remains unchanged from the previous version)

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
    getOrGenerateSkillTemplate,
};
