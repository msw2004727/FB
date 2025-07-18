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
 * 將日期推進一天
 * @param {object} currentDate - 當前日期物件 { year, month, day, yearName }
 * @returns {object} - 新的日期物件
 */
function advanceDate(currentDate) {
    let { year, month, day, yearName } = currentDate;
    
    day++;

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

/**
 * 【核心重構 v3.0 - 增量更新】
 * 根據單一回合數據，更新或創建圖書館中的對應章節，避免讀取整個存檔集合。
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 * @param {object} newRoundData - 新產生的單一回合存檔數據
 */
async function updateLibraryNovel(userId, username, newRoundData) {
    if (!newRoundData || typeof newRoundData.R !== 'number') {
        console.error(`[圖書館系統 v3.0] 錯誤：缺少有效的回合數據，無法進行增量更新。`);
        return;
    }
    
    console.log(`[圖書館系統 v3.0] 開始為 ${username} 增量更新小說，章節：R${newRoundData.R}...`);
    try {
        const libraryDocRef = db.collection('library_novels').doc(userId);
        const chapterId = `R${String(newRoundData.R).padStart(6, '0')}`;
        const chapterDocRef = libraryDocRef.collection('chapters').doc(chapterId);
        const batch = db.batch();

        // 1. 準備章節內容
        const chapterContent = {
            title: newRoundData.EVT || `第 ${newRoundData.R} 回`,
            content: newRoundData.story || "這段往事，已淹沒在時間的長河中。",
            round: newRoundData.R
        };
        batch.set(chapterDocRef, chapterContent, { merge: true });

        // 2. 準備主小說文檔的更新內容
        const isDeceased = newRoundData.playerState === 'dead';
        const novelTitle = `${username}的江湖路`;
        
        const novelUpdatePayload = {
            playerName: username,
            novelTitle: novelTitle,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            isDeceased,
            lastChapterTitle: newRoundData.EVT || `第 ${newRoundData.R} 回`,
            lastRoundNumber: newRoundData.R,
            lastYearName: newRoundData.yearName || '元祐',
            lastYear: newRoundData.year || 1,
            lastMonth: newRoundData.month || 1,
            lastDay: newRoundData.day || 1,
        };

        // 3. 使用 set + merge:true 來創建或更新主文檔，避免因文件不存在而出錯
        batch.set(libraryDocRef, novelUpdatePayload, { merge: true });
        
        // 4. 提交所有操作
        await batch.commit();

        console.log(`[圖書館系統 v3.0] 成功為 ${username} 的小說增量更新了章節 R${newRoundData.R}。`);

    } catch (error) {
        console.error(`[圖書館系統 v3.0] 增量更新 ${username} 的小說時發生錯誤:`, error);
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
