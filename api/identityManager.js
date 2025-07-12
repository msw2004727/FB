// /api/identityManager.js
const admin = require('firebase-admin');
const db = admin.firestore();

// 身份對應表
const RULER_IDENTITY_MAP = {
    '村莊': '村長',
    '城鎮': '鎮長',
    '城市': '城主',
    '都府': '府尹',
    '山寨': '寨主',
    '堡壘': '堡主',
    '門派': '掌門',
    '幫派': '幫主',
    '家族': '家主'
};

/**
 * 為一個新出現的NPC決定其身份
 * @param {string} npcName - NPC的姓名
 * @returns {Promise<{identity: string, location: string|null}>} - 返回一個包含身份和所在地的物件
 */
async function getIdentityForNewNpc(npcName) {
    try {
        // 查詢 locations 集合，看是否有地點的統治者(ruler)是這個NPC
        const locationsRef = db.collection('locations');
        const snapshot = await locationsRef.where('ruler', '==', npcName).limit(1).get();

        if (!snapshot.empty) {
            const locationDoc = snapshot.docs[0];
            const locationData = locationDoc.data();
            const locationType = locationData.locationType;
            const locationName = locationData.name || locationDoc.id;

            // 從對應表中查找身份，如果找不到，則給一個通用的“領主”
            const identity = RULER_IDENTITY_MAP[locationType] || '領主';
            
            console.log(`[身份管理器] 發現 ${npcName} 是 ${locationName}(${locationType}) 的統治者，賦予身份：${identity}`);
            
            return { identity: identity, location: locationName };
        } else {
            // 如果在所有地點的統治者名單中都找不到他，則預設為浪人
            return { identity: '浪人', location: null };
        }
    } catch (error) {
        console.error(`[身份管理器] 在為 ${npcName} 查詢身份時出錯:`, error);
        // 出錯時也返回預設值，避免阻斷流程
        return { identity: '浪人', location: null };
    }
}

module.exports = { getIdentityForNewNpc };
