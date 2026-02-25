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


function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (isPlainObject(value)) {
        const out = {};
        Object.entries(value).forEach(([key, nestedValue]) => {
            out[key] = cloneValue(nestedValue);
        });
        return out;
    }
    return value;
}

function deepMergeObjects(base, override) {
    const baseObj = isPlainObject(base) ? base : {};
    const overrideObj = isPlainObject(override) ? override : {};
    const merged = cloneValue(baseObj);

    Object.entries(overrideObj).forEach(([key, overrideValue]) => {
        const baseValue = merged[key];
        if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
            merged[key] = deepMergeObjects(baseValue, overrideValue);
            return;
        }
        merged[key] = cloneValue(overrideValue);
    });

    return merged;
}

function normalizeLocationHierarchyInput(locationHierarchyInput) {
    if (Array.isArray(locationHierarchyInput)) {
        return locationHierarchyInput
            .map(value => (typeof value === 'string' ? value.trim() : ''))
            .filter(Boolean);
    }
    if (typeof locationHierarchyInput === 'string' && locationHierarchyInput.trim()) {
        return [locationHierarchyInput.trim()];
    }
    return [];
}

function getAddressPath(address) {
    if (!isPlainObject(address)) return '';
    const preferredOrder = ['country', 'province', 'state', 'region', 'city', 'district', 'town', 'village'];
    const orderedValues = [];
    const seen = new Set();

    preferredOrder.forEach((key) => {
        const value = typeof address[key] === 'string' ? address[key].trim() : '';
        if (!value) return;
        seen.add(key);
        orderedValues.push(value);
    });

    Object.entries(address).forEach(([key, rawValue]) => {
        if (seen.has(key)) return;
        const value = typeof rawValue === 'string' ? rawValue.trim() : '';
        if (value) orderedValues.push(value);
    });

    return orderedValues.join(' > ');
}

function buildLocationSummary(currentMerged, inheritedMerged) {
    const resolved = isPlainObject(inheritedMerged) ? inheritedMerged : {};
    const current = isPlainObject(currentMerged) ? currentMerged : {};
    const name = current.locationName || current.name || resolved.locationName || resolved.name || '未知地區';
    const description = current.description || resolved.description || '地區情報載入中...';
    const governance = deepMergeObjects(resolved.governance, current.governance);
    const address = deepMergeObjects(resolved.address, current.address);

    return {
        locationName: name,
        description,
        ruler: governance && governance.ruler ? governance.ruler : '未知',
        addressPath: getAddressPath(address),
        locationType: current.locationType || resolved.locationType || '未知'
    };
}

function createFallbackLocationData(locationName) {
    const safeName = typeof locationName === 'string' && locationName.trim() ? locationName.trim() : '未知地區';
    const description = '地區情報載入失敗，請稍後再試。';
    const summary = {
        locationName: safeName,
        description,
        ruler: '未知',
        addressPath: '',
        locationType: '未知'
    };

    return {
        locationId: safeName,
        locationName: safeName,
        description,
        locationHierarchy: [safeName],
        schemaVersion: 2,
        summary,
        current: {
            static: {},
            dynamic: {},
            merged: { locationName: safeName, description },
            inheritedMerged: { locationName: safeName, description },
            summary
        },
        hierarchy: [],
        layers: {
            currentStatic: {},
            currentDynamic: {},
            currentMerged: { locationName: safeName, description },
            inheritedMerged: { locationName: safeName, description }
        }
    };
}

async function getMergedLocationData(userId, locationHierarchyInput) {
    const normalizedHierarchy = normalizeLocationHierarchyInput(locationHierarchyInput);
    if (normalizedHierarchy.length === 0) {
        console.error('[LocationData] Invalid location hierarchy input:', locationHierarchyInput);
        return null;
    }

    let currentLocationName = normalizedHierarchy[normalizedHierarchy.length - 1];
    const processedHierarchy = [];
    const visitedLocations = new Set();

    try {
        while (currentLocationName) {
            if (typeof currentLocationName !== 'string' || !currentLocationName.trim()) {
                console.error('[LocationData] Invalid location name in hierarchy traversal:', currentLocationName);
                break;
            }

            currentLocationName = currentLocationName.trim();

            if (visitedLocations.has(currentLocationName)) {
                console.warn('[LocationData] Detected hierarchy cycle, abort traversal at:', currentLocationName);
                break;
            }
            visitedLocations.add(currentLocationName);

            const staticDocRef = db.collection('locations').doc(currentLocationName);
            const dynamicDocRef = db.collection('users').doc(userId).collection('location_states').doc(currentLocationName);

            let [staticDoc, dynamicDoc] = await Promise.all([staticDocRef.get(), dynamicDocRef.get()]);

            if (!staticDoc.exists) {
                console.log('[LocationData] Missing static location ' + currentLocationName + ', generating...');
                await generateAndCacheLocation(userId, currentLocationName, '未知', '世界摘要未提供', normalizedHierarchy);
                [staticDoc, dynamicDoc] = await Promise.all([staticDocRef.get(), dynamicDocRef.get()]);
            } else if (!dynamicDoc.exists) {
                console.log('[LocationData] Missing dynamic location state for ' + currentLocationName + ' (user=' + userId + '), generating...');
                await generateAndCacheLocation(userId, currentLocationName, '未知', '世界摘要未提供', normalizedHierarchy);
                dynamicDoc = await dynamicDocRef.get();
            }

            if (!staticDoc.exists) {
                const tempMerged = {
                    locationId: currentLocationName,
                    locationName: currentLocationName,
                    description: '地區情報生成中，請稍後再試。'
                };
                processedHierarchy.unshift({
                    locationName: currentLocationName,
                    static: {},
                    dynamic: {},
                    merged: tempMerged
                });
                break;
            }

            const staticData = staticDoc.data() || {};
            const dynamicData = dynamicDoc.exists ? (dynamicDoc.data() || {}) : {};
            const mergedForNode = deepMergeObjects(staticData, dynamicData);
            const resolvedLocationName = mergedForNode.locationName || mergedForNode.name || staticData.locationName || staticData.name || currentLocationName;

            processedHierarchy.unshift({
                locationName: resolvedLocationName,
                static: staticData,
                dynamic: dynamicData,
                merged: mergedForNode
            });

            currentLocationName = typeof staticData.parentLocation === 'string' ? staticData.parentLocation.trim() : '';
        }

        let inheritedMerged = {};
        processedHierarchy.forEach((node) => {
            inheritedMerged = deepMergeObjects(inheritedMerged, node.merged);
        });

        const currentNode = processedHierarchy[processedHierarchy.length - 1] || null;
        const currentStatic = currentNode && currentNode.static ? currentNode.static : {};
        const currentDynamic = currentNode && currentNode.dynamic ? currentNode.dynamic : {};
        const currentMerged = currentNode && currentNode.merged ? currentNode.merged : {};
        const summary = buildLocationSummary(currentMerged, inheritedMerged);

        const hierarchy = processedHierarchy.map((node) => ({
            locationName: node.locationName || (node.merged && (node.merged.locationName || node.merged.name)) || '未知地區',
            static: node.static || {},
            dynamic: node.dynamic || {},
            merged: node.merged || {},
            summary: buildLocationSummary(node.merged || {}, node.merged || {})
        }));

        const compatibilityPayload = deepMergeObjects({}, inheritedMerged);
        compatibilityPayload.locationId = compatibilityPayload.locationId || summary.locationName;
        compatibilityPayload.locationName = summary.locationName;
        compatibilityPayload.description = summary.description;
        compatibilityPayload.locationHierarchy = hierarchy.map(node => node.locationName);

        return {
            ...compatibilityPayload,
            schemaVersion: 2,
            summary,
            current: {
                static: currentStatic,
                dynamic: currentDynamic,
                merged: currentMerged,
                inheritedMerged,
                summary
            },
            hierarchy,
            layers: {
                currentStatic,
                currentDynamic,
                currentMerged,
                inheritedMerged
            }
        };
    } catch (error) {
        console.error('[LocationData] Failed to merge location data for ' + normalizedHierarchy.join(' > '), error);
        return createFallbackLocationData(currentLocationName || normalizedHierarchy[normalizedHierarchy.length - 1]);
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
