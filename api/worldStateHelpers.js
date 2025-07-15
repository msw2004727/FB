// api/worldStateHelpers.js
const admin = require('firebase-admin');
const { generateAndCacheLocation } = require('./worldEngine');

const db = admin.firestore();

const TIME_SEQUENCE = ['清晨', '上午', '中午', '下午', '黃昏', '夜晚', '深夜'];
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * 檢查是否為閏年
 * @param {number} year - 年份
 * @returns {boolean}
 */
function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * 【核心修正 v2.0 - 已加入閏年判斷】
 * 將日期推進一天
 * @param {object} currentDate - 當前日期物件 { year, month, day, yearName }
 * @returns {object} - 新的日期物件
 */
function advanceDate(currentDate) {
    let { year, month, day, yearName } = currentDate;
    
    day++;

    // 獲取當前月份的天數，考慮閏年
    let daysInCurrentMonth = DAYS_IN_MONTH[month];
    if (month === 2 && isLeapYear(year)) {
        daysInCurrentMonth = 29;
    }

    if (day > daysInCurrentMonth) {
        day = 1;
        month++;
        if (month > 12) {
            month = 1;
            year++;
            // 這裡可以加入更換年號的邏輯，如果需要的話
        }
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

// 【核心修正 v2.1 - 修復變數未定義錯誤】
async function updateLibraryNovel(userId, username) {
    console.log(`[圖書館系統 v2.1] 開始為 ${username} 更新分章節小說...`);
    try {
        const userSavesSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
        if (userSavesSnapshot.empty) return;

        const libraryDocRef = db.collection('library_novels').doc(userId);
        const chaptersRef = libraryDocRef.collection('chapters');

        // 使用批次寫入以提高效率
        const batch = db.batch();

        // 【錯誤修復】從已獲取的快照中正確地取得最後一回合的數據
        const lastSaveDoc = userSavesSnapshot.docs[userSavesSnapshot.docs.length - 1];
        if (!lastSaveDoc) {
             console.error(`[圖書館系統 v2.1] 錯誤：找不到玩家 ${username} 的最後存檔。`);
             return;
        }
        const lastRoundData = lastSaveDoc.data();

        const isDeceased = lastRoundData.playerState === 'dead';
        const novelTitle = `${username}的江湖路`;

        // 1. 更新主文檔，只包含元數據，不再包含巨大的 storyHTML
        batch.set(libraryDocRef, {
            playerName: username,
            novelTitle: novelTitle,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            isDeceased,
            lastChapterTitle: lastRoundData.EVT || `第 ${lastRoundData.R} 回`,
            lastChapterData: lastRoundData
        }, { merge: true });
        
        // 2. 將每一回合的故事作為一個獨立的章節文件存儲
        userSavesSnapshot.docs.forEach(doc => {
            const roundData = doc.data();
            const chapterId = `R${String(roundData.R).padStart(6, '0')}`; // 使用 R 作為文檔ID，並補零以確保順序
            const chapterDocRef = chaptersRef.doc(chapterId);

            const chapterContent = {
                title: roundData.EVT || `第 ${roundData.R} 回`,
                content: roundData.story || "這段往事，已淹沒在時間的長河中。",
                round: roundData.R
            };
            
            batch.set(chapterDocRef, chapterContent);
        });
        
        // 3. 提交所有批次操作
        await batch.commit();

        console.log(`[圖書館系統 v2.1] 成功為 ${username} 的小說更新了 ${userSavesSnapshot.docs.length} 個章節。`);

    } catch (error) {
        console.error(`[圖書館系統 v2.1] 更新 ${username} 的小說時發生錯誤:`, error);
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
