// api/itemManager.js
const admin = require('firebase-admin');
const { getItemGeneratorPrompt } = require('../prompts/itemGeneratorPrompt.js');
// 【核心修改】從 aiService 引入 aiConfig
const { callAI, aiConfig } = require('../services/aiService');

const db = admin.firestore();

/**
 * 獲取或生成一個物品的設計模板。
 * 如果模板不存在，會呼叫AI生成並存入資料庫。
 * @param {string} itemName - 物品的準確名稱.
 * @returns {Promise<Object|null>} 物品的模板數據，如果失敗則返回null.
 */
async function getOrGenerateItemTemplate(itemName) {
    if (!itemName) return null;

    // 【核心修改】直接使用物品名稱作為文檔ID，更清晰
    const templateRef = db.collection('items').doc(itemName);

    try {
        const doc = await templateRef.get();

        // 如果設計圖已存在，直接回傳
        if (doc.exists) {
            return doc.data();
        }

        // 如果不存在，呼叫「神級工匠AI」進行設計
        console.log(`[神兵閣] 物品「${itemName}」的設計圖不存在，啟動AI生成...`);
        const prompt = getItemGeneratorPrompt(itemName);
        
        // 【核心修改】使用中央設定檔來決定AI模型
        const modelToUse = aiConfig.itemTemplate || 'openai';
        const itemJsonString = await callAI(modelToUse, prompt, true); 
        const newTemplateData = JSON.parse(itemJsonString);

        if (!newTemplateData.itemName) {
            throw new Error('AI生成的物品模板缺少必要的itemName欄位。');
        }

        // 【核心新增】處理 createdAt 時間戳
        if (newTemplateData.createdAt === "CURRENT_TIMESTAMP") {
            newTemplateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        }

        // 將新的設計圖存入'items'集合中
        await templateRef.set(newTemplateData);
        console.log(`[神兵閣] 成功為「${itemName}」建立並儲存了設計圖。`);
        
        // 再次獲取以確保返回的是資料庫中的最新版本
        const newDoc = await templateRef.get();
        return newDoc.data();

    } catch (error) {
        console.error(`[神兵閣] 在處理物品「${itemName}」的設計圖時發生錯誤:`, error);
        return null;
    }
}

module.exports = {
    getOrGenerateItemTemplate,
};
