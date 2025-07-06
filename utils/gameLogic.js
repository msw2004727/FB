// utils/gameLogic.js

// 遊戲中的時間序列和每月天數
const TIME_SEQUENCE = ['清晨', '上午', '中午', '下午', '黃昏', '夜晚', '深夜'];
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // 索引0不用

/**
 * 將遊戲日期推進一天
 * @param {object} currentDate - 當前的日期物件 { year, month, day, yearName }
 * @returns {object} - 推進一天後的新日期物件
 */
export function advanceDate(currentDate) {
    let { year, month, day, yearName } = currentDate;
    day++;
    if (day > DAYS_IN_MONTH[month]) {
        day = 1;
        month++;
        if (month > 12) {
            month = 1;
            year++;
        }
    }
    return { year, month, day, yearName };
}

/**
 * 根據變化字串更新物品列表
 * @param {string} currentItems - 當前的物品字串，以 '、' 分隔
 * @param {string} itemChangeString - 物品變化字串，例如 "+金瘡藥、-火摺子"
 * @returns {string} - 更新後的物品字串
 */
export function applyItemChanges(currentItems, itemChangeString) {
    let items = currentItems ? currentItems.split('、').filter(i => i) : [];
    if (!itemChangeString) return items.join('、');

    const changes = itemChangeString.split('、');
    changes.forEach(change => {
        change = change.trim();
        if (change.startsWith('+')) {
            const newItem = change.substring(1).trim();
            if (newItem) items.push(newItem);
        } else if (change.startsWith('-')) {
            const itemToRemove = change.substring(1).trim();
            const index = items.indexOf(itemToRemove);
            if (index > -1) {
                items.splice(index, 1);
            }
        }
    });
    return items.filter(Boolean).join('、');
}

/**
 * 獲取下一個時間點
 * @param {string} currentTimeOfDay - 目前的時辰
 * @param {string} nextTimeOfDay - AI 指定的下一個時辰
 * @returns {boolean} - 是否需要將日期推進一天
 */
export function shouldAdvanceDay(currentTimeOfDay, nextTimeOfDay) {
    const oldTimeIndex = TIME_SEQUENCE.indexOf(currentTimeOfDay);
    const newTimeIndex = TIME_SEQUENCE.indexOf(nextTimeOfDay);
    return newTimeIndex < oldTimeIndex;
}
