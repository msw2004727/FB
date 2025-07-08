// api/worldEngine.js
const admin = require('firebase-admin');
const { getBountyGeneratorPrompt } = require('../prompts/bountyGeneratorPrompt.js');
const { getLocationGeneratorPrompt } = require('../prompts/locationGeneratorPrompt.js'); 
const { callAI } = require('../services/aiService');

const db = admin.firestore();

/**
 * 【核心修改】函式現在需要傳入 userId
 * 生成並快取新地點的詳細資訊。
 * @param {string} userId - 玩家的ID.
 * @param {string} locationName - 新地點的名稱.
 * @param {string} locationType - 新地點的類型.
 * @param {string} worldSummary - 當前世界的長期故事摘要.
 */
async function generateAndCacheLocation(userId, locationName, locationType = '未知', worldSummary = '江湖軼事無可考。') {
    if (!userId || !locationName) return;
    console.log(`[世界引擎] 收到為玩家 ${userId} 生成地點 ${locationName} 的請求...`);

    // 【核心修改】路徑現在指向玩家的個人子集合
    const locationRef = db.collection('users').doc(userId).collection('locations').doc(locationName);

    try {
        const doc = await locationRef.get();
        if (doc.exists) {
            console.log(`[世界引擎] 玩家 ${userId} 的地點「${locationName}」檔案已存在，跳過生成。`);
            return;
        }

        console.log(`[世界引擎] 為玩家 ${userId} 的「${locationName}」啟動背景建檔...`);
        const prompt = getLocationGeneratorPrompt(locationName, locationType, worldSummary);
        const locationJsonString = await callAI('deepseek', prompt, true);
        const newLocationData = JSON.parse(locationJsonString);

        if (!newLocationData.locationId || !newLocationData.description) {
            throw new Error("AI生成的地點資料不完整。");
        }

        await locationRef.set(newLocationData);
        console.log(`[世界引擎] 成功為玩家 ${userId} 的地點「${locationName}」建立檔案。`);

    } catch (error) {
        console.error(`[世界引擎] 在為地點「${locationName}」進行背景建檔時發生錯誤:`, error);
    }
}


/**
 * 根據當前世界摘要，觸發一次新的懸賞生成。
 * @param {string} userId - 玩家的ID
 * @param {string} longTermSummary - 長期故事摘要
 */
async function triggerBountyGeneration(userId, longTermSummary) {
    console.log(`[世界引擎] 正在為玩家 ${userId} 嘗試生成新的懸賞...`);
    try {
        const prompt = getBountyGeneratorPrompt(longTermSummary);
        const bountyJsonString = await callAI('deepseek', prompt, true); 
        const newBountyData = JSON.parse(bountyJsonString);

        if (!newBountyData.title || !newBountyData.content) {
            console.log(`[世界引擎] AI生成的懸賞資料不完整，本次跳過。`);
            return;
        }

        newBountyData.status = 'active';
        newBountyData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        
        const expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + 7);
        newBountyData.expireAt = admin.firestore.Timestamp.fromDate(expireDate);

        const bountiesRef = db.collection('users').doc(userId).collection('bounties');
        await bountiesRef.add(newBountyData);

        console.log(`[世界引擎] 成功為玩家 ${userId} 生成新懸賞: "${newBountyData.title}"`);

    } catch (error) {
        console.error(`[世界引擎] 為玩家 ${userId} 生成懸賞時發生錯誤:`, error);
    }
}

module.exports = {
    triggerBountyGeneration,
    generateAndCacheLocation
};
