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

// 【核心修正 v2.3 - 釜底抽薪，強制刪除舊欄位】
async function updateLibraryNovel(userId, username) {
    console.log(`[圖書館系統 v2.3] 開始為 ${username} 更新分章節小說...`);
    try {
        const userSavesSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
        if (userSavesSnapshot.empty) return;

        const libraryDocRef = db.collection('library_novels').doc(userId);
        const chaptersRef = libraryDocRef.collection('chapters');
        const batch = db.batch();

        const lastSaveDoc = userSavesSnapshot.docs[userSavesSnapshot.docs.length - 1];
        if (!lastSaveDoc) {
             console.error(`[圖書館系統 v2.3] 錯誤：找不到玩家 ${username} 的最後存檔。`);
             return;
        }
        const lastRoundData = lastSaveDoc.data();
        const isDeceased = lastRoundData.playerState === 'dead';
        const novelTitle = `${username}的江湖路`;

        // 1. 【關鍵修改】使用 batch.update 並明確刪除舊的、龐大的欄位
        const updatePayload = {
            playerName: username,
            novelTitle: novelTitle,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            isDeceased,
            lastChapterTitle: lastRoundData.EVT || `第 ${lastRoundData.R} 回`,
            lastRoundNumber: lastRoundData.R,
            lastYearName: lastRoundData.yearName || '元祐',
            lastYear: lastRoundData.year || 1,
            lastMonth: lastRoundData.month || 1,
            lastDay: lastRoundData.day || 1,
            // 【釜底抽薪】明確地刪除可能存在的、導致文件過大的舊欄位
            lastChapterData: admin.firestore.FieldValue.delete(),
            storyHTML: admin.firestore.FieldValue.delete()
        };
        batch.update(libraryDocRef, updatePayload);
        
        // 2. 將每一回合的故事作為一個獨立的章節文件存儲
        userSavesSnapshot.docs.forEach(doc => {
            const roundData = doc.data();
            const chapterId = `R${String(roundData.R).padStart(6, '0')}`;
            const chapterDocRef = chaptersRef.doc(chapterId);

            const chapterContent = {
                title: roundData.EVT || `第 ${roundData.R} 回`,
                content: roundData.story || "這段往事，已淹沒在時間的長河中。",
                round: roundData.R
            };
            
            // 使用 set + merge:true 來創建或覆蓋章節文件
            batch.set(chapterDocRef, chapterContent, { merge: true });
        });
        
        // 3. 提交所有批次操作
        await batch.commit();

        console.log(`[圖書館系統 v2.3] 成功為 ${username} 的小說更新了 ${userSavesSnapshot.docs.length} 個章節，並清理了索引文件。`);

    } catch (error) {
        // 如果初次執行update失敗（因為文件不存在），則嘗試用set創建
        if (error.code === 5) { // 5 = NOT_FOUND, 表示文件不存在
            console.warn(`[圖書館系統 v2.3] 索引文件不存在，將嘗試創建...`);
            // 重新執行一次，但這次使用 set 而不是 update
            await createLibraryNovel(userId, username);
        } else {
            console.error(`[圖書館系統 v2.3] 更新 ${username} 的小說時發生錯誤:`, error);
        }
    }
}

// 輔助函式：在文件不存在時，使用 set 進行創建
async function createLibraryNovel(userId, username) {
    try {
        const userSavesSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
        if (userSavesSnapshot.empty) return;
        const libraryDocRef = db.collection('library_novels').doc(userId);
        const lastSaveDoc = userSavesSnapshot.docs[userSavesSnapshot.docs.length - 1];
        const lastRoundData = lastSaveDoc.data();
        const createPayload = {
            playerName: username,
            novelTitle: `${username}的江湖路`,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            isDeceased: lastRoundData.playerState === 'dead',
            lastChapterTitle: lastRoundData.EVT || `第 ${lastRoundData.R} 回`,
            lastRoundNumber: lastRoundData.R,
            lastYearName: lastRoundData.yearName || '元祐',
            lastYear: lastRoundData.year || 1,
            lastMonth: lastRoundData.month || 1,
            lastDay: lastRoundData.day || 1,
        };
        await libraryDocRef.set(createPayload);
        console.log(`[圖書館系統 v2.3] 成功為 ${username} 創建了新的圖書館索引文件。`);
    } catch(e) {
        console.error(`[圖書館系統 v2.3] 創建索引文件時失敗:`, e);
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
