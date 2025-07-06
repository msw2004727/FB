// utils/gameLogic.js

const TIME_SEQUENCE = ['清晨', '上午', '中午', '下午', '黃昏', '夜晚', '深夜'];
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function advanceDate(currentDate) {
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

function applyItemChanges(currentItems, itemChangeString) {
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

function shouldAdvanceDay(currentTimeOfDay, nextTimeOfDay) {
    const oldTimeIndex = TIME_SEQUENCE.indexOf(currentTimeOfDay);
    const newTimeIndex = TIME_SEQUENCE.indexOf(nextTimeOfDay);
    return newTimeIndex < oldTimeIndex;
}

module.exports = {
    advanceDate,
    applyItemChanges,
    shouldAdvanceDay
};
