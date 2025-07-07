// /api/gameHelpers.js
const admin = require('firebase-admin');
const { getAINpcProfile, getAIRomanceEvent } = require('../services/aiService');
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
    const inventoryRef = db.collection('users').doc(userId).collection('game_state').doc('inventory');
    await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(inventoryRef);
        let inventory = doc.exists ? doc.data() : {};
        for (const change of itemChanges) {
            const { action, itemName, quantity = 1, itemType, rarity, description } = change;
            if (action === 'add') {
                if (inventory[itemName]) {
                    inventory[itemName].quantity += quantity;
                } else {
                    inventory[itemName] = { quantity, itemType: itemType || '其他', rarity: rarity || '普通', description: description || '一個神秘的物品。', addedAt: admin.firestore.FieldValue.serverTimestamp() };
                }
            } else if (action === 'remove') {
                if (inventory[itemName] && inventory[itemName].quantity >= quantity) {
                    inventory[itemName].quantity -= quantity;
                    if (inventory[itemName].quantity <= 0) delete inventory[itemName];
                } else {
                    // Do not throw error, just log it. This can happen if AI makes a mistake.
                    console.warn(`物品移除警告：試圖移除不存在或數量不足的物品'${itemName}'。`);
                }
            }
        }
        transaction.set(inventoryRef, inventory);
    });
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

const checkAndTriggerRomanceEvent = async (userId, username, romanceChanges, roundData, model) => {
    if (!romanceChanges || romanceChanges.length === 0) return "";
    let triggeredEventNarrative = "";
    const userNpcsRef = db.collection('users').doc(userId).collection('npcs');
    for (const { npcName } of romanceChanges) {
        const npcDocRef = userNpcsRef.doc(npcName);
        const npcDoc = await npcDocRef.get();
        if (!npcDoc.exists) continue;

        const npcProfile = npcDoc.data();
        const { romanceValue = 0, triggeredRomanceEvents = [] } = npcProfile;

        if (romanceValue >= 50 && !triggeredRomanceEvents.includes('level_1')) {
            const playerProfileForEvent = { username, location: roundData.LOC[0] };
            const eventNarrative = await getAIRomanceEvent(model, playerProfileForEvent, npcProfile, 'level_1');
            if (eventNarrative) {
                triggeredEventNarrative += `<div class="random-event-message romance-event">${eventNarrative}</div>`;
                await npcDocRef.update({ triggeredRomanceEvents: admin.firestore.FieldValue.arrayUnion('level_1') });
            }
        }
    }
    return triggeredEventNarrative;
};

// 此函式維持原樣，用於生成顯示在儀表板上的摘要字串
const getInventoryState = async (userId) => {
    const inventoryRef = db.collection('users').doc(userId).collection('game_state').doc('inventory');
    const doc = await inventoryRef.get();
    if (!doc.exists) return { money: 0, itemsString: '行囊空空' };

    const inventory = doc.data();
    const otherItems = [];
    let money = 0;
    for (const [name, data] of Object.entries(inventory)) {
        if (name === '銀兩') {
            money = data.quantity || 0;
        } else {
            if(data.quantity > 0) { // 只顯示數量大於0的物品
                 otherItems.push(`${name} x${data.quantity}`);
            }
        }
    }
    return { money, itemsString: otherItems.length > 0 ? otherItems.join('、') : '身無長物' };
};

// 【核心新增】此函式用於提供給「贈予」彈窗，回傳的是完整的物品物件
const getRawInventory = async (userId) => {
    const inventoryRef = db.collection('users').doc(userId).collection('game_state').doc('inventory');
    const doc = await inventoryRef.get();
    if (!doc.exists) {
        return {}; // 如果沒有背包資料，回傳一個空物件
    }
    return doc.data(); // 直接回傳從資料庫讀取的原始資料
};


module.exports = {
    TIME_SEQUENCE,
    getFriendlinessLevel,
    advanceDate,
    invalidateNovelCache,
    updateLibraryNovel,
    createNpcProfileInBackground,
    updateInventory,
    updateRomanceValues,
    checkAndTriggerRomanceEvent,
    getInventoryState,
    getRawInventory // 【核心新增】
};
