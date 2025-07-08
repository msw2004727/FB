// api/worldEngine.js
const admin = require('firebase-admin');
const { getBountyGeneratorPrompt } = require('../prompts/bountyGeneratorPrompt.js');
// 【核心新增】引入我們新建立的地點生成器AI腳本
const { getLocationGeneratorPrompt } = require('../prompts/locationGeneratorPrompt.js'); 
const { callAI } = require('../services/aiService');

const db = admin.firestore();

/**
 * 【核心新增】生成並快取新地點的詳細資訊。
 * 這是一個「執行後不理」的背景任務，不會影響當前回合的速度。
 * @param {string} locationName - 新地點的名稱.
 * @param {string} locationType - 新地點的類型 (例如: '村莊', '山寨').
 * @param {string} worldSummary - 當前世界的長期故事摘要，供AI參考.
 */
async function generateAndCacheLocation(locationName, locationType = '未知', worldSummary = '江湖軼事無可考。') {
    if (!locationName) return;
    console.log(`[世界引擎] 收到地點生成請求: ${locationName} (${locationType})`);

    // 我們將使用地點名稱作為其在資料庫中的唯一ID
    const locationRef = db.collection('locations').doc(locationName);

    try {
        const doc = await locationRef.get();
        // 如果地點檔案已存在，則跳過，避免重複生成
        if (doc.exists) {
            console.log(`[世界引擎] 地點「${locationName}」的檔案已存在，跳過生成。`);
            return;
        }

        console.log(`[世界引擎] 為「${locationName}」啟動背景建檔程序...`);
        // 1. 呼叫AI，使用我們新設計的prompt來生成地點的詳細JSON資料
        const prompt = getLocationGeneratorPrompt(locationName, locationType, worldSummary);
        const locationJsonString = await callAI('deepseek', prompt, true); // 使用創造力強的DeepSeek
        const newLocationData = JSON.parse(locationJsonString);

        // 2. 驗證AI回傳的資料是否合格
        if (!newLocationData.locationId || !newLocationData.description) {
            throw new Error("AI生成的地點資料不完整。");
        }

        // 3. 將這份詳盡的檔案存入新的 'locations' 集合中
        await locationRef.set(newLocationData);
        console.log(`[世界引擎] 成功為地點「${locationName}」建立並儲存了詳細檔案。`);

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

// 將新舊函式一起匯出
module.exports = {
    triggerBountyGeneration,
    generateAndCacheLocation
};
