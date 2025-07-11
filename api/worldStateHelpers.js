// api/worldStateHelpers.js
const admin = require('firebase-admin');
const { generateAndCacheLocation } = require('./worldEngine');

const db = admin.firestore();

const TIME_SEQUENCE = ['清晨', '上午', '中午', '下午', '黃昏', '夜晚', '深夜'];
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function advanceDate(currentDate) {
    let { year, month, day, yearName } = currentDate;
    day++;
    if (day > DAYS_IN_MONTH[month]) {
        day = 1;
        month++;
        if (month > 12) { month = 1; year++; }
    }
    return { year, month, day, yearName };
}

async function invalidateNovelCache(userId) {
    try {
        const novelCacheRef = db.collection('users').doc(userId).collection('game_state').doc('novel_cache');
        await novelCacheRef.delete();
        console.log(`[小說快取系統] 已成功清除玩家 ${userId} 的小說快取。`);
    } catch (error) {
        console.warn(`[小說快取系統] 清除玩家 ${userId} 的小說快取時發生非致命錯誤:`, error.message);
    }
}

async function updateLibraryNovel(userId, username) {
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
}

async function getMergedLocationData(userId, locationHierarchyArray) {
    if (!Array.isArray(locationHierarchyArray) || locationHierarchyArray.length === 0) {
        console.error('[讀取系統] 錯誤：傳入的地點資料不是有效的陣列。', locationHierarchyArray);
        return null;
    }
    let currentLocationName = locationHierarchyArray[locationHierarchyArray.length - 1];
    let mergedData = {};
    const processedHierarchy = [];
    try {
        while (currentLocationName) {
            if (typeof currentLocationName !== 'string' || currentLocationName.trim() === '') {
                 console.error(`[讀取系統] 偵測到無效的地點名稱，停止向上查找:`, currentLocationName);
                 break;
            }
            const staticDocRef = db.collection('locations').doc(currentLocationName);
            const dynamicDocRef = db.collection('users').doc(userId).collection('location_states').doc(currentLocationName);

            const [staticDoc, dynamicDoc] = await Promise.all([staticDocRef.get(), dynamicDocRef.get()]);

            if (!staticDoc.exists) {
                console.log(`[讀取系統] 偵測到全新地點: ${currentLocationName}，將在背景生成...`);
                await generateAndCacheLocation(userId, currentLocationName, '未知', '初次抵達，資訊尚不明朗。');
                const tempNewLoc = { locationId: currentLocationName, locationName: currentLocationName, description: "此地詳情尚在傳聞之中..." };
                processedHierarchy.unshift(tempNewLoc);
                break;
            }
            if (staticDoc.exists && !dynamicDoc.exists) {
                 console.log(`[讀取系統] 模板存在，但玩家 ${userId} 的地點狀態不存在: ${currentLocationName}，將在背景初始化...`);
                 await generateAndCacheLocation(userId, currentLocationName, '未知', '初次抵達，資訊尚不明朗。');
            }

            const staticData = staticDoc.data() || {};
            const dynamicData = dynamicDoc.exists ? dynamicDoc.data() : {};
            processedHierarchy.unshift({ ...staticData, ...dynamicData });
            currentLocationName = staticData.parentLocation;
        }
        processedHierarchy.forEach(loc => { mergedData = { ...mergedData, ...loc }; });
        const deepestLocation = processedHierarchy[processedHierarchy.length - 1];
        if (deepestLocation) {
            mergedData.locationName = deepestLocation.locationName;
            mergedData.description = deepestLocation.description;
        }
        mergedData.locationHierarchy = processedHierarchy.map(loc => loc.locationName);
        return mergedData;
    } catch (error) {
        console.error(`[讀取系統] 獲取地點「${locationHierarchyArray.join(',')}」的層級資料時出錯:`, error);
        return { locationId: currentLocationName, locationName: currentLocationName, description: "讀取此地詳情時發生錯誤..." };
    }
}

module.exports = {
    TIME_SEQUENCE,
    DAYS_IN_MONTH,
    advanceDate,
    invalidateNovelCache,
    updateLibraryNovel,
    getMergedLocationData
};
