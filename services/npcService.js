// services/npcService.js

const admin = require('firebase-admin');
const { getAINpcProfile } = require('./aiService.js');

const db = admin.firestore();

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
            const finalProfile = {
                ...npcProfile,
                friendliness: npcData.friendliness || 'neutral'
            };
            await npcDocRef.set(finalProfile);
            console.log(`[NPC系統] 成功為 "${npcName}" 建立並儲存了詳細檔案。`);
        } else {
            console.log(`[NPC系統] AI 未能為 "${npcName}" 生成有效的檔案。`);
        }
    } catch (error) {
        console.error(`[NPC系統] 為 "${npcName}" 進行背景建檔時發生錯誤:`, error);
    }
};

module.exports = {
    createNpcProfileInBackground
};
