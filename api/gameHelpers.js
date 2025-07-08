// /api/gameHelpers.js
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const { getAINpcProfile, getAIRomanceEvent } = require('../services/aiService');
const { getOrGenerateItemTemplate } = require('./itemManager');
const { generateAndCacheLocation } = require('./worldEngine'); // 新增引用

const db = admin.firestore();

const TIME_SEQUENCE = ['清晨', '上午', '中午', '下午', '黃昏', '夜晚', '深夜'];
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const getFriendlinessLevel = (value) => {
    if (value >= 100) return 'devoted';
    if (value >= 70) return 'trusted';
    if (value >= 30) return 'friendly';
    if (value <= -100) return 'sworn_enemy';
    if (value <= -50) return 'hostile';
    if (value <= -10) return 'wary';
    return 'neutral';
};

/**
 * 【核心新增】
 * 輔助函式，用於合併地點的靜態和動態資料。
 * 這個函式從 stateRoutes.js 搬移至此，作為共用函式。
 * @param {string} userId - 玩家的ID.
 * @param {string} locationName - 新地點的名稱.
 * @returns {Promise<Object|null>} 合併後的地點資料
 */
const getMergedLocationData = async (userId, locationName) => {
    if (!locationName) return null;

    try {
        const staticDocRef = db.collection('locations').doc(locationName);
        const dynamicDocRef = db.collection('users').doc(userId).collection('location_states').doc(locationName);

        const [staticDoc, dynamicDoc] = await Promise.all([
            staticDocRef.get(),
            dynamicDocRef.get()
        ]);

        if (!staticDoc.exists) {
            console.log(`[讀取系統] 偵測到玩家 ${userId} 的全新地點: ${locationName}，將在背景生成...`);
            generateAndCacheLocation(userId, locationName, '未知', '初次抵達，資訊尚不明朗。')
                .catch(err => console.error(`[世界引擎] 地點 ${locationName} 的背景生成失敗:`, err));
            return {
                locationId: locationName,
                locationName: locationName,
                description: "此地詳情尚在傳聞之中...",
            };
        }
        
        if (staticDoc.exists && !dynamicDoc.exists) {
             console.log(`[讀取系統] 模板存在，但玩家 ${userId} 的地點狀態不存在: ${locationName}，將在背景初始化...`);
             generateAndCacheLocation(userId, locationName, '未知', '初次抵達，資訊尚不明朗。')
                .catch(err => console.error(`[世界引擎] 地點 ${locationName} 的背景生成失敗:`, err));
        }

        const staticData = staticDoc.data() || {};
        const dynamicData = dynamicDoc.data() || {};

        return { ...staticData, ...dynamicData };

    } catch (error) {
        console.error(`[讀取系統] 合併地點 ${locationName} 的資料時出錯:`, error);
        return {
            locationId: locationName,
            locationName: locationName,
            description: "讀取此地詳情時發生錯誤...",
        };
    }
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

const createNpcProfileInBackground = async (userId, username, npcData, roundData) => {
    const npcName = npcData.name;
    console.log(`[NPC系統] UserId: ${userId}。偵測到新NPC: "${npcName}"，已啟動背景建檔程序。`);
    try {
        const npcDocRef = db.collection('users').doc(userId).collection('npcs').doc(npcName);
        const npcDoc = await npcDocRef.get();
        if (npcDoc.exists) {
            console.log(`[NPC系統] "${npcName}" 的檔案已存在，取消建立。`);
            return;
        }
        const npcProfile = await getAINpcProfile('deepseek', username, npcName, roundData);
        if (npcProfile) {
            npcProfile.currentLocation = roundData.LOC[0];
            npcProfile.friendlinessValue = npcData.friendlinessValue || 0;
            npcProfile.friendliness = getFriendlinessLevel(npcProfile.friendlinessValue);
            await npcDocRef.set(npcProfile);
            console.log(`[NPC系統] 成功為 "${npcName}" 建立並儲存了詳細檔案。`);
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
        const { action, itemName, quantity = 1, itemType, rarity, description } = change;

        if (action === 'add') {
            const template = await getOrGenerateItemTemplate(itemName);
            if (!template) {
                console.error(`[物品系統] 無法為 "${itemName}" 獲取或生成設計圖，跳過此物品。`);
                continue;
            }
            
            if (['材料', '財寶', '道具'].includes(template.itemType)) {
                 const stackableItemRef = userInventoryRef.doc(itemName);
                 batch.set(stackableItemRef, { 
                    ...template,
                    quantity: admin.firestore.FieldValue.increment(quantity),
                    lastAcquiredAt: admin.firestore.FieldValue.serverTimestamp()
                 }, { merge: true });
                 console.log(`[物品系統] 已為玩家 ${userId} 增加可堆疊物品: ${itemName} x${quantity}`);

            } else {
                for (let i = 0; i < quantity; i++) {
                    const newItemId = uuidv4();
                    const newItemRef = userInventoryRef.doc(newItemId);
                    batch.set(newItemRef, {
                        ...template,
                        instanceId: newItemId,
                        owner: userId,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        durability: 100,
                        upgrades: {},
                        lore: ""
                    });
                }
                console.log(`[物品系統] 已為玩家 ${userId} 創建獨立物品實例: ${itemName} x${quantity}`);
            }

        } else if (action === 'remove') {
            const querySnapshot = await userInventoryRef.where('itemName', '==', itemName).limit(quantity).get();
            if (querySnapshot.empty) {
                console.warn(`[物品系統] 警告：試圖移除不存在的物品'${itemName}'。`);
                continue;
            }
            querySnapshot.forEach(doc => {
                if (doc.data().quantity > 1) {
                    batch.update(doc.ref, { quantity: admin.firestore.FieldValue.increment(-1) });
                } else {
                    batch.delete(doc.ref);
                }
            });
            console.log(`[物品系統] 已為玩家 ${userId} 移除物品: ${itemName} x${querySnapshot.size}`);

        } else if (action === 'remove_all' && itemType === '財寶') {
            const treasuresSnapshot = await userInventoryRef.where('itemType', '==', '財寶').get();
            treasuresSnapshot.forEach(doc => {
                batch.delete(doc.ref);
            });
            console.log(`[物品系統] 因特殊事件，為玩家 ${userId} 移除了所有財寶。`);
        }
    }
    await batch.commit();
};


const updateFriendlinessValues = async (userId, npcChanges) => {
    if (!npcChanges || npcChanges.length === 0) return;
    const userNpcsRef = db.collection('users').doc(userId).collection('npcs');

    const promises = npcChanges.map(async (change) => {
        if (!change.name || typeof change.friendlinessChange !== 'number' || change.friendlinessChange === 0) {
            return;
        }

        const npcDocRef = userNpcsRef.doc(change.name);
        try {
            await db.runTransaction(async (transaction) => {
                const npcDoc = await transaction.get(npcDocRef);
                if (!npcDoc.exists) {
                    console.warn(`[友好度系統] 嘗試更新一個不存在的NPC檔案: ${change.name}`);
                    return;
                }
                const currentFriendliness = npcDoc.data().friendlinessValue || 0;
                const newFriendlinessValue = currentFriendliness + change.friendlinessChange;
                
                transaction.update(npcDocRef, { 
                    friendlinessValue: newFriendlinessValue,
                    friendliness: getFriendlinessLevel(newFriendlinessValue)
                });
            });
        } catch (error) {
            console.error(`[友好度系統] 更新NPC "${change.name}" 友好度時出錯:`, error);
        }
    });

    await Promise.all(promises);
};


const updateRomanceValues = async (userId, romanceChanges) => {
    if (!romanceChanges || romanceChanges.length === 0) return;
    const userNpcsRef = db.collection('users').doc(userId).collection('npcs');
    const promises = romanceChanges.map(async ({ npcName, valueChange }) => {
        if (!npcName || typeof valueChange !== 'number' || valueChange === 0) return;
        const npcDocRef = userNpcsRef.doc(npcName);
        try {
            await npcDocRef.update({ romanceValue: admin.firestore.FieldValue.increment(valueChange) });
        } catch (error) {
            if (error.code === 5) {
                await npcDocRef.set({ romanceValue: valueChange }, { merge: true });
            } else {
                console.error(`[戀愛系統] 更新NPC "${npcName}" 心動值時出錯:`, error);
            }
        }
    });
    await Promise.all(promises);
};

const checkAndTriggerRomanceEvent = async (userId, playerProfile) => {
    const userNpcsRef = db.collection('users').doc(userId).collection('npcs');
    const npcsSnapshot = await userNpcsRef.where('romanceValue', '>=', 150).get();
    if (npcsSnapshot.empty) {
        return null;
    }

    for (const doc of npcsSnapshot.docs) {
        const npcProfile = doc.data();
        const { name, romanceValue = 0, triggeredRomanceEvents = [] } = npcProfile;
        
        const eventTriggers = [
            { level: 'level_2_confession', threshold: 150 }
        ];

        for (const trigger of eventTriggers) {
            if (romanceValue >= trigger.threshold && !triggeredRomanceEvents.includes(trigger.level)) {
                
                console.log(`[戀愛系統] 偵測到與 ${name} 的 ${trigger.level} 事件觸發條件！`);
                
                const romanceEventResultText = await getAIRomanceEvent('gemini', playerProfile, npcProfile, trigger.level);
                
                try {
                    const romanceEventResult = JSON.parse(romanceEventResultText);
                    if (romanceEventResult && romanceEventResult.story) {
                        await doc.ref.update({
                            triggeredRomanceEvents: admin.firestore.FieldValue.arrayUnion(trigger.level)
                        });
                        
                        return {
                            eventStory: romanceEventResult.story,
                            npcUpdates: romanceEventResult.npcUpdates || []
                        };
                    }
                } catch(e){
                     console.error('[戀愛系統] 解析AI回傳的戀愛事件JSON時出錯:', e);
                     return null; // 解析失敗則不觸發事件
                }
            }
        }
    }

    return null; 
};

const getInventoryState = async (userId) => {
    const inventoryRef = db.collection('users').doc(userId).collection('inventory_items');
    const snapshot = await inventoryRef.get();
    if (snapshot.empty) return { money: 0, itemsString: '身無長物' };

    let money = 0;
    const itemCounts = {};

    snapshot.forEach(doc => {
        const item = doc.data();
        if (item.itemName === '銀兩') {
            money += item.quantity || 0;
        } else {
            const count = item.quantity || 1;
            itemCounts[item.itemName] = (itemCounts[item.itemName] || 0) + count;
        }
    });

    const otherItems = Object.entries(itemCounts).map(([name, count]) => `${name} x${count}`);
    return { money, itemsString: otherItems.length > 0 ? otherItems.join('、') : '身無長物' };
};


const getRawInventory = async (userId) => {
    const inventoryRef = db.collection('users').doc(userId).collection('inventory_items');
    const snapshot = await inventoryRef.get();
    if (snapshot.empty) {
        return {};
    }
    const inventoryData = {};
    snapshot.forEach(doc => {
        inventoryData[doc.id] = doc.data();
    });
    return inventoryData;
};

const updateSkills = async (userId, skillChanges) => {
    if (!skillChanges || skillChanges.length === 0) return [];
    
    const skillsCollectionRef = db.collection('users').doc(userId).collection('skills');
    const levelUpEvents = [];

    for (const skillChange of skillChanges) {
        const skillDocRef = skillsCollectionRef.doc(skillChange.skillName);

        try {
            await db.runTransaction(async (transaction) => {
                const skillDoc = await transaction.get(skillDocRef);

                if (skillChange.isNewlyAcquired) {
                    const newSkillData = {
                        name: skillChange.skillName,
                        type: skillChange.skillType,
                        power_type: skillChange.power_type || 'none',
                        max_level: skillChange.max_level || 10,
                        level: skillChange.level || 0,
                        exp: skillChange.exp || 0,
                        description: skillChange.description,
                        acquiredAt: admin.firestore.FieldValue.serverTimestamp()
                    };
                    transaction.set(skillDocRef, newSkillData);
                    console.log(`[武學系統] 已為玩家 ${userId} 新增武學: ${skillChange.skillName}，初始等級: ${newSkillData.level}`);

                } else if (skillChange.expChange > 0) {
                    if (!skillDoc.exists) {
                        console.warn(`[武學系統] 玩家 ${userId} 試圖修練不存在的武學: ${skillChange.skillName}`);
                        return;
                    }
                    
                    let currentData = skillDoc.data();
                    let currentLevel = currentData.level || 0;
                    let currentExp = currentData.exp || 0;
                    const maxLevel = currentData.max_level || 10;
                    
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

                    transaction.update(skillDocRef, { level: currentLevel, exp: currentExp });
                    console.log(`[武學系統] 玩家 ${userId} 修練 ${skillChange.skillName}，熟練度增加 ${skillChange.expChange}。現有等級: ${currentLevel}, 熟練度: ${currentExp}`);
                }
            });
        } catch (error) {
            console.error(`[武學系統] 更新武學 ${skillChange.skillName} 時發生錯誤:`, error);
        }
    }
    return levelUpEvents;
};

const getPlayerSkills = async (userId) => {
    const skillsSnapshot = await db.collection('users').doc(userId).collection('skills').get();
    if (skillsSnapshot.empty) {
        return [];
    }
    const skills = [];
    skillsSnapshot.forEach(doc => {
        skills.push(doc.data());
    });
    return skills;
};

const processNpcUpdates = async (userId, updates) => {
    if (!updates || !Array.isArray(updates) || updates.length === 0) {
        return;
    }

    console.log(`[NPC檔案更新系統] 收到為玩家 ${userId} 更新NPC檔案的指令...`);
    const batch = db.batch();
    const userNpcsRef = db.collection('users').doc(userId).collection('npcs');

    for (const update of updates) {
        const { npcName, fieldToUpdate, newValue, updateType } = update;

        if (!npcName || !fieldToUpdate || newValue === undefined) continue;

        const npcDocRef = userNpcsRef.doc(npcName);
        let updatePayload = {};

        if (updateType === 'arrayUnion') {
            updatePayload[fieldToUpdate] = admin.firestore.FieldValue.arrayUnion(newValue);
        } else if (updateType === 'arrayRemove') {
            updatePayload[fieldToUpdate] = admin.firestore.FieldValue.arrayRemove(newValue);
        } else { 
            updatePayload[fieldToUpdate] = newValue;
        }

        batch.update(npcDocRef, updatePayload);
        console.log(`[NPC檔案更新系統] 已將NPC「${npcName}」的欄位「${fieldToUpdate}」更新為：`, newValue);
    }

    try {
        await batch.commit();
        console.log(`[NPC檔案更新系統] NPC檔案批次更新已成功提交。`);
    } catch (error) {
        console.error(`[NPC檔案更新系統] 在為玩家 ${userId} 更新NPC檔案時發生錯誤:`, error);
    }
};

module.exports = {
    TIME_SEQUENCE,
    getFriendlinessLevel,
    getMergedLocationData, // 新增導出
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
    processNpcUpdates
};
