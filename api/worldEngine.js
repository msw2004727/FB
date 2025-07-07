// api/worldEngine.js
const admin = require('firebase-admin');
const { getBountyGeneratorPrompt } = require('../prompts/bountyGeneratorPrompt.js'); // 注意：之後我們需要建立這個檔案
const { callAI } = require('../services/aiService'); // 假設 callAI 在 aiService 中並已匯出

const db = admin.firestore();

/**
 * 根據當前世界摘要，觸發一次新的懸賞生成。
 * @param {string} userId - 玩家的ID
 * @param {string} longTermSummary - 長期故事摘要
 */
async function triggerBountyGeneration(userId, longTermSummary) {
    console.log(`[世界引擎] 正在為玩家 ${userId} 嘗試生成新的懸賞...`);
    try {
        // 1. 呼叫AI生成懸賞內容
        const prompt = getBountyGeneratorPrompt(longTermSummary);
        // 我們可以使用一個較快且有創造力的模型來生成
        const bountyJsonString = await callAI('deepseek', prompt, true); 
        const newBountyData = JSON.parse(bountyJsonString);

        if (!newBountyData.title || !newBountyData.content) {
            console.log(`[世界引擎] AI生成的懸賞資料不完整，本次跳過。`);
            return;
        }

        // 2. 設定懸賞的基礎屬性
        newBountyData.status = 'active';
        newBountyData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        
        // 設定7天後過期
        const expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + 7);
        newBountyData.expireAt = admin.firestore.Timestamp.fromDate(expireDate);

        // 3. 存入資料庫
        const bountiesRef = db.collection('users').doc(userId).collection('bounties');
        await bountiesRef.add(newBountyData);

        console.log(`[世界引擎] 成功為玩家 ${userId} 生成新懸賞: "${newBountyData.title}"`);

    } catch (error) {
        console.error(`[世界引擎] 為玩家 ${userId} 生成懸賞時發生錯誤:`, error);
    }
}

module.exports = {
    triggerBountyGeneration
};
