// api/itemManager.js
const admin = require('firebase-admin');
const { getItemGeneratorPrompt } = require('../prompts/itemGeneratorPrompt.js');
const { callAI, aiConfig } = require('../services/aiService');

const db = admin.firestore();

/**
 * 獲取或生成一個物品的設計模板。
 * 如果模板不存在，會呼叫AI生成並存入資料庫。
 * @param {string} itemName - 物品的準確名稱.
 * @param {object} roundData - 當前回合的完整數據，作為生成物品的情境(context).
 * @returns {Promise<Object|null>} 物品的模板數據，如果失敗則返回null.
 */
async function getOrGenerateItemTemplate(itemName, roundData = {}) {
    if (!itemName) return null;

    const templateRef = db.collection('items').doc(itemName);

    try {
        const doc = await templateRef.get();

        // 如果設計圖已存在，直接回傳
        if (doc.exists) {
            // 【核心修正】回傳標準格式的物件
            return { template: doc.data(), isNew: false };
        }

        // 如果不存在，呼叫「神級工匠AI」進行設計
        console.log(`[神兵閣] 物品「${itemName}」的設計圖不存在，啟動AI生成...`);
        
        const playerLevel = (roundData.internalPower || 0) + (roundData.externalPower || 0) + (roundData.lightness || 0);
        const context = {
            location: roundData.LOC ? roundData.LOC[0] : '未知地點',
            sourceType: '劇情發展', // 可根據EVT內容進一步推斷，例如 '敵人掉落'
            sourceName: roundData.EVT || '未知事件',
            playerLevel: playerLevel
        };

        const prompt = getItemGeneratorPrompt(itemName, context);
        
        const modelToUse = aiConfig.itemTemplate || 'openai';
        const itemJsonString = await callAI(modelToUse, prompt, true); 
        const newTemplateData = JSON.parse(itemJsonString);

        if (!newTemplateData.itemName) {
            throw new Error('AI生成的物品模板缺少必要的itemName欄位。');
        }

        if (newTemplateData.createdAt === "CURRENT_TIMESTAMP") {
            newTemplateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        }

        // 將新的設計圖存入'items'集合中
        await templateRef.set(newTemplateData);
        console.log(`[神兵閣] 成功為「${itemName}」建立並儲存了設計圖。`);
        
        const newDoc = await templateRef.get();
        // 【核心修正】回傳標準格式的物件
        return { template: newDoc.data(), isNew: true };

    } catch (error) {
        console.error(`[神兵閣] 在處理物品「${itemName}」的設計圖時發生錯誤:`, error);
        return null;
    }
}

module.exports = {
    getOrGenerateItemTemplate,
};
