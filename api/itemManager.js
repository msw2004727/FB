// api/itemManager.js
const admin = require('firebase-admin');
const { getItemGeneratorPrompt } = require('../prompts/itemGeneratorPrompt.js');
const { callAI } = require('../services/aiService');

const db = admin.firestore();

/**
 * 獲取或生成一個物品的設計模板。
 * 如果模板不存在，會呼叫AI生成並存入資料庫。
 * @param {string} itemName - 物品的準確名稱.
 * @returns {Promise<Object|null>} 物品的模板數據，如果失敗則返回null.
 */
async function getOrGenerateItemTemplate(itemName) {
    if (!itemName) return null;

    // 將物品名稱轉換為安全的文檔ID（例如："金瘡藥" -> "item_jin_chuang_yao"）
    const docId = `item_${itemName.replace(/\s/g, '_')}`;
    const templateRef = db.collection('items').doc(docId);

    try {
        let doc = await templateRef.get();

        // 如果設計圖已存在，直接回傳
        if (doc.exists) {
            return doc.data();
        }

        // 如果不存在，呼叫「神級工匠AI」進行設計
        console.log(`[神兵閣] 物品「${itemName}」的設計圖不存在，啟動AI生成...`);
        const prompt = getItemGeneratorPrompt(itemName);
        // 我們可以使用一個穩定且富有創造力的模型來設計物品
        const itemJsonString = await callAI('deepseek', prompt, true); 
        const newTemplateData = JSON.parse(itemJsonString);

        if (!newTemplateData.itemName) {
            throw new Error('AI生成的物品模板缺少必要的itemName欄位。');
        }

        // 將新的設計圖存入'items'集合中
        await templateRef.set(newTemplateData);
        console.log(`[神兵閣] 成功為「${itemName}」建立並儲存了設計圖。`);
        
        // 再次獲取以確保返回的是資料庫中的最新版本
        doc = await templateRef.get();
        return doc.data();

    } catch (error) {
        console.error(`[神兵閣] 在處理物品「${itemName}」的設計圖時發生錯誤:`, error);
        return null;
    }
}

module.exports = {
    getOrGenerateItemTemplate,
};
