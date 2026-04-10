// api/admin/logService.js
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 獲取日誌
 * @param {string|null} playerId - 可選的玩家ID，用於篩選特定玩家的日誌
 * @param {number} limit - 要獲取的日誌數量上限
 * @returns {Promise<Array<object>>} - 日誌物件陣列
 */
async function getLogs(playerId = null, limit = 100) {
    try {
        let query = db.collection('logs');

        // 【核心修正】將 'where' 篩選放在 'orderBy' 之前
        if (playerId) {
            query = query.where('userId', '==', playerId);
        }

        // 統一將排序和數量限制放在最後
        query = query.orderBy('timestamp', 'desc').limit(limit);

        const snapshot = await query.get();
        if (snapshot.empty) {
            return [];
        }

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            // 將 Firestore Timestamp 轉換為可讀的日期字串
            timestamp: doc.data().timestamp.toDate().toISOString()
        }));
    } catch (error) {
        console.error('[Log Service] 獲取日誌時發生錯誤:', error);
        // 為了讓後台即使在資料庫出錯時也能顯示錯誤，我們向上拋出異常
        throw new Error('從資料庫獲取日誌時失敗。');
    }
}

/**
 * 獲取所有有日誌記錄的玩家列表
 * @returns {Promise<Array<string>>} - 玩家ID列表
 */
async function getPlayersWithLogs() {
    try {
        const snapshot = await db.collection('logs').select('userId').get();
        const userIds = new Set();
        snapshot.forEach(doc => {
            if (doc.data().userId) {
                userIds.add(doc.data().userId);
            }
        });
        return Array.from(userIds);
    } catch (error) {
        console.error('[Log Service] 獲取玩家列表時發生錯誤:', error);
        throw new Error('從資料庫獲取玩家列表時失敗。');
    }
}


module.exports = {
    getLogs,
    getPlayersWithLogs,
};
