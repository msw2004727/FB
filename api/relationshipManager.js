// api/relationshipManager.js
const admin = require('firebase-admin');
const db = admin.firestore();

// 完整關係對照表
const relationshipMappings = {
    '父親': '兒子', // 預設兒子，需要性別判斷來修正為女兒
    '母親': '兒子', // 預設兒子，需要性別判斷來修正為女兒
    '兒子': '父親', // 預設父親，需要性別判斷來修正為母親
    '女兒': '父親', // 預設父親，需要性別判斷來修正為母親
    '丈夫': '妻子',
    '妻子': '丈夫',
    '哥哥': '弟弟', // 簡化處理，未來可擴充
    '弟弟': '哥哥',
    '姐姐': '妹妹',
    '妹妹': '姐姐',
    '師父': '徒弟',
    '徒弟': '師父',
    '義父': '義子',
    '義子': '義父',
    '義母': '義子',
    '恩人': '受恩者',
    '仇人': '仇人', // 仇人關係是雙向的
    '宿敵': '宿敵',
    '老闆': '下屬',
    '老大': '小弟',
    '手帕交': '手帕交',
    '知己': '知己',
    // ... 可以根據需要無限擴充
};

// 定義哪些關係是需要進行家族樹擴散的血緣或核心家庭關係
const familyTies = new Set(['父親', '母親', '兒子', '女兒', '丈夫', '妻子', '哥哥', '弟弟', '姐姐', '妹妹']);

/**
 * 輔助函式：獲取一個NPC的檔案
 * @param {string} npcName - NPC的名稱
 * @returns {Promise<object|null>} NPC的資料或null
 */
const getNpcDoc = async (npcName) => {
    if (!npcName) return null;
    const npcRef = db.collection('npcs').doc(npcName);
    const doc = await npcRef.get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
};

/**
 * 核心功能：處理並同步NPC之間的雙向關係 (2.0 版本)
 * @param {string} userId - 玩家ID (備用)
 * @param {string} sourceNpcName - 新建立的、關係的發起方NPC名稱
 * @param {object} sourceRelationships - 新NPC檔案中的關係物件
 */
async function processNpcRelationships(userId, sourceNpcName, sourceRelationships) {
    if (!userId || !sourceNpcName || !sourceRelationships || Object.keys(sourceRelationships).length === 0) {
        return;
    }

    console.log(`[關係譜系統 2.0] 開始處理 ${sourceNpcName} 的人際關係...`);
    const sourceNpc = await getNpcDoc(sourceNpcName);
    if (!sourceNpc) return;

    for (const [relation, targetNpcName] of Object.entries(sourceRelationships)) {
        try {
            const targetNpc = await getNpcDoc(targetNpcName);
            if (!targetNpc) {
                console.warn(`[關係譜系統 2.0] 警告：找不到目標NPC "${targetNpcName}" 的通用模板，暫時無法建立雙向關係。`);
                continue;
            }

            // 1. 建立直接的雙向關係
            let reciprocalRelation = relationshipMappings[relation];
            if (reciprocalRelation) {
                // 性別判斷修正
                if (relation === '父親' || relation === '母親') {
                    reciprocalRelation = sourceNpc.gender === '男' ? '兒子' : '女兒';
                }
                if (relation === '兒子' || relation === '女兒') {
                    reciprocalRelation = sourceNpc.gender === '男' ? '父親' : '母親';
                }
                
                await db.collection('npcs').doc(targetNpcName).set({
                    relationships: { [reciprocalRelation]: sourceNpcName }
                }, { merge: true });
                console.log(`[關係譜系統 2.0] 成功在 ${targetNpcName} 的檔案中加入了關係: "${reciprocalRelation}: ${sourceNpcName}"`);
            }

            // 2. 如果是家族關係，則進行關係擴散
            if (familyTies.has(relation)) {
                await propagateFamilyTies(sourceNpc, targetNpc, relation, reciprocalRelation);
            }

        } catch (error) {
            console.error(`[關係譜系統 2.0] 在更新 ${targetNpcName} 與 ${sourceNpcName} 的關係時發生錯誤:`, error);
        }
    }
}

/**
 * 輔助函式：擴散家族關係，自動更新家族其他成員的關係
 * @param {object} sourceNpc - 關係發起方
 * @param {object} targetNpc - 關係接收方
 * @param {string} relation - 原始關係 (e.g., '父親')
 * @param {string} reciprocalRelation - 反向關係 (e.g., '兒子')
 */
async function propagateFamilyTies(sourceNpc, targetNpc, relation, reciprocalRelation) {
    console.log(`[關係譜系統 2.0] 偵測到家族關係，開始為 ${sourceNpc.name} 和 ${targetNpc.name} 進行關係擴散...`);
    const batch = db.batch();

    // 案例：C是B的父親 (sourceNpc: C, targetNpc: B, relation: '女兒')
    if (relation === '女兒' || relation === '兒子') {
        const parentNpc = sourceNpc;
        const childNpc = targetNpc;

        // 遍歷孩子(B)的所有關係，尋找他的兄弟姊妹
        if (childNpc.relationships) {
            for (const [rel, siblingName] of Object.entries(childNpc.relationships)) {
                if (rel === '哥哥' || rel === '弟弟' || rel === '姐姐' || rel === '妹妹') {
                    const siblingNpc = await getNpcDoc(siblingName);
                    if (siblingNpc) {
                        console.log(`[關係譜系統 2.0] 發現 ${childNpc.name} 的手足 ${siblingNpc.name}，正在為他們建立與 ${parentNpc.name} 的關係...`);
                        
                        // 更新手足(A)的檔案，加上父親(C)
                        const siblingReciprocal = siblingNpc.gender === '男' ? '兒子' : '女兒';
                        batch.set(db.collection('npcs').doc(siblingNpc.id), { relationships: { [relation]: parentNpc.name } }, { merge: true });

                        // 更新父親(C)的檔案，加上手足(A)這個孩子
                        batch.set(db.collection('npcs').doc(parentNpc.id), { relationships: { [siblingReciprocal]: siblingNpc.name } }, { merge: true });
                    }
                }
            }
        }
    }
    // 可以再擴充其他關係的推導，例如處理配偶的父母等
    
    await batch.commit();
    console.log(`[關係譜系統 2.0] 關係擴散完成。`);
}


module.exports = {
    processNpcRelationships
};
