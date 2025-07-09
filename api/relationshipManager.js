// api/relationshipManager.js
const admin = require('firebase-admin');
const db = admin.firestore();

// 定義關係的雙向對應表
const relationshipMappings = {
    '父親': '兒子',
    '母親': '兒子',
    '兒子': '父親', // 假設默認為父
    '女兒': '父親', // 假設默認為父
    '丈夫': '妻子',
    '妻子': '丈夫',
    '哥哥': '弟弟', // 簡化處理，可擴充為兄弟/姊妹
    '弟弟': '哥哥',
    '姐姐': '妹妹',
    '妹妹': '姐姐',
    '師父': '徒弟',
    '徒弟': '師父',
    '恩人': '受恩者',
    '殺父仇人': '復仇者',
    '老闆': '下屬',
    '老大': '小弟',
    // ... 可以根據需要無限擴充
};

/**
 * 處理並同步NPC之間的雙向關係
 * @param {string} userId - 玩家ID
 * @param {string} sourceNpcName - 新建立的、關係的發起方NPC名稱
 * @param {object} relationships - 新NPC檔案中的關係物件
 */
async function processNpcRelationships(userId, sourceNpcName, relationships) {
    if (!userId || !sourceNpcName || !relationships || Object.keys(relationships).length === 0) {
        return;
    }

    console.log(`[關係譜系統] 開始處理 ${sourceNpcName} 的人際關係...`);

    // 使用 for...of 迴圈來確保異步操作能被正確處理
    for (const [relation, targetNpcName] of Object.entries(relationships)) {
        
        // 尋找對應的反向關係
        const reciprocalRelation = relationshipMappings[relation];
        
        // 如果沒有定義反向關係 (例如 "夢中情人")，則跳過
        if (!reciprocalRelation) {
            console.log(`[關係譜系統] 關係 "${relation}" 沒有定義反向對應，跳過對 ${targetNpcName} 的更新。`);
            continue;
        }

        try {
            const npcTemplateRef = db.collection('npcs').doc(targetNpcName);
            const doc = await npcTemplateRef.get();

            // 確保目標NPC的通用模板存在
            if (doc.exists) {
                // 使用點記法來更新或新增 relationships 物件中的特定欄位
                const fieldToUpdate = `relationships.${reciprocalRelation}`;
                const updatePayload = {
                    [fieldToUpdate]: sourceNpcName
                };

                await npcTemplateRef.set(updatePayload, { merge: true });
                console.log(`[關係譜系統] 成功更新！在 ${targetNpcName} 的檔案中加入了關係: "${reciprocalRelation}: ${sourceNpcName}"`);
            } else {
                console.warn(`[關係譜系統] 警告：找不到目標NPC "${targetNpcName}" 的通用模板，暫時無法建立雙向關係。`);
                // 未來可以在這裡加入一個機制，等目標NPC被建立後再補全關係
            }

        } catch (error) {
            console.error(`[關係譜系統] 在更新 ${targetNpcName} 與 ${sourceNpcName} 的關係時發生錯誤:`, error);
        }
    }
}

module.exports = {
    processNpcRelationships
};
