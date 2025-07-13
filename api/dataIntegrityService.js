// api/dataIntegrityService.js
const admin = require('firebase-admin');
const { DEFAULT_USER_FIELDS } = require('./models/userModel');
const { generateNpcTemplateData } = require('../services/npcCreationService');
const { getOrGenerateItemTemplate, getOrGenerateSkillTemplate } = require('./playerStateHelpers');
const { generateAndCacheLocation } = require('./worldEngine');

const db = admin.firestore();

// 【核心新增】定義一個NPC狀態檔案應有的預設欄位和值
const DEFAULT_NPC_STATE_FIELDS = {
    interactionSummary: "你與此人的交往尚淺。",
    isDeceased: false,
    inventory: {},
    equipment: [],
    romanceValue: 0,
    friendlinessValue: 0,
    triggeredRomanceEvents: []
};


/**
 * 【核心新增】為指定玩家的所有舊NPC狀態檔案，補全缺失的欄位
 * @param {string} userId - 玩家ID
 */
async function backfillNpcStates(userId) {
    const npcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    const snapshot = await npcStatesRef.get();

    if (snapshot.empty) return;

    const batch = db.batch();
    let updatesMade = 0;

    snapshot.forEach(doc => {
        const npcData = doc.data();
        const updates = {};
        let needsUpdate = false;

        for (const [field, defaultValue] of Object.entries(DEFAULT_NPC_STATE_FIELDS)) {
            if (npcData[field] === undefined) {
                updates[field] = defaultValue;
                needsUpdate = true;
            }
        }
        
        // 特別處理 firstMet，因為它是一個物件
        if (npcData.firstMet === undefined) {
            updates.firstMet = { round: 0, time: '未知', location: '未知', event: '一次未被記錄的相遇' };
            needsUpdate = true;
        }

        if (needsUpdate) {
            batch.update(doc.ref, updates);
            updatesMade++;
            console.log(`[健康檢查-NPC戶籍] 將為 NPC「${doc.id}」補全缺失的欄位。`);
        }
    });

    if (updatesMade > 0) {
        await batch.commit();
        console.log(`[健康檢查-NPC戶籍] 任務完成！共為 ${updatesMade} 個舊NPC檔案補全了戶籍。`);
    }
}


/**
 * 檢查並修補玩家資料中的預設欄位和資料類型
 * @param {string} userId - 玩家ID
 */
async function checkUserFields(userId) {
    const userDocRef = db.collection('users').doc(userId);
    const userDoc = await userDocRef.get();
    if (!userDoc.exists) return;

    const userData = userDoc.data();
    const updates = {};
    let needsUpdate = false;

    for (const [field, defaultValue] of Object.entries(DEFAULT_USER_FIELDS)) {
        if (userData[field] === undefined) {
            needsUpdate = true;
            updates[field] = defaultValue;
            console.log(`[健康檢查-玩家] 補齊缺失欄位: ${field} ->`, defaultValue);
        }
    }
    
    const fieldsToEnsureNumber = ['internalPower', 'externalPower', 'lightness', 'morality', 'stamina', 'money', 'bulkScore', 'R', 'shortActionCounter', 'year', 'month', 'day'];
    for (const field of fieldsToEnsureNumber) {
        if (userData[field] !== undefined && typeof userData[field] !== 'number') {
            const parsedValue = Number(userData[field]);
            updates[field] = isNaN(parsedValue) ? (DEFAULT_USER_FIELDS[field] || 0) : parsedValue;
            needsUpdate = true;
            console.log(`[健康檢查-玩家] 修正類型錯誤: ${field} 從 "${userData[field]}" (${typeof userData[field]}) 修復為 ${updates[field]} (number)。`);
        }
    }

    if (needsUpdate) {
        await userDocRef.update(updates);
        console.log(`[健康檢查-玩家] 已為玩家 ${userId} 補全並修正了核心欄位。`);
    }
}

/**
 * 【核心新增】修復內容不完整的NPC公用模板
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 * @param {object} playerProfile - 玩家的完整檔案
 * @param {Array<object>} allSavesData - 玩家的所有存檔記錄
 */
async function repairIncompleteNpcTemplates(userId, username, playerProfile, allSavesData) {
    const npcStatesSnapshot = await db.collection('users').doc(userId).collection('npc_states').get();
    if (npcStatesSnapshot.empty) return;

    for (const npcStateDoc of npcStatesSnapshot.docs) {
        const npcName = npcStateDoc.id;
        const npcTemplateRef = db.collection('npcs').doc(npcName);
        const npcTemplateDoc = await npcTemplateRef.get();

        if (npcTemplateDoc.exists) {
            const templateData = npcTemplateDoc.data();
            const isIncomplete = Object.values(templateData).some(value => typeof value === 'string' && value.includes('生成中'));

            if (isIncomplete) {
                console.log(`[健康檢查-NPC修復] 偵測到「${npcName}」的模板不完整，開始修復...`);
                
                const npcStateData = npcStateDoc.data();
                const firstMetRoundNumber = npcStateData.firstMet?.round;
                let firstMentionRound = null;

                if (firstMetRoundNumber !== undefined && firstMetRoundNumber > 0) {
                    firstMentionRound = allSavesData.find(save => save.R === firstMetRoundNumber);
                } else {
                    firstMentionRound = allSavesData.find(round => round.NPC?.some(npc => npc.name === npcName));
                }

                if (firstMentionRound) {
                    try {
                        const generationResult = await generateNpcTemplateData(username, { name: npcName }, firstMentionRound, playerProfile);
                        if (generationResult && generationResult.canonicalName && generationResult.templateData) {
                            await npcTemplateRef.update(generationResult.templateData);
                            console.log(`[健康檢查-NPC修復] 成功為「${generationResult.canonicalName}」重新生成並覆蓋了完整的公用模板。`);
                        }
                    } catch (genError) {
                        console.error(`[健康檢查-NPC修復] 為「${npcName}」重新生成模板時AI出錯:`, genError);
                    }
                } else {
                    console.warn(`[健康檢查-NPC修復] 警告：在存檔中找不到NPC「${npcName}」的初見情境，無法為其修復模板。`);
                }
            }
        }
    }
}


/**
 * 檢查玩家所有接觸過的NPC，並為缺少模板的NPC重建檔案
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 * @param {object} playerProfile - 玩家的完整檔案
 * @param {Array<object>} allSavesData - 玩家的所有存檔記錄
 */
async function repairMissingNpcTemplates(userId, username, playerProfile, allSavesData) {
    const npcStatesSnapshot = await db.collection('users').doc(userId).collection('npc_states').get();
    if (npcStatesSnapshot.empty) return;

    for (const npcStateDoc of npcStatesSnapshot.docs) {
        const npcName = npcStateDoc.id;
        const npcTemplateRef = db.collection('npcs').doc(npcName);
        const npcTemplateDoc = await npcTemplateRef.get();

        if (!npcTemplateDoc.exists) {
            console.log(`[健康檢查-NPC創建] 偵測到「${npcName}」缺少模板，開始自動創建...`);
            const firstMentionRound = allSavesData.find(round => round.NPC?.some(npc => npc.name === npcName));

            if (firstMentionRound) {
                try {
                    const generationResult = await generateNpcTemplateData(username, { name: npcName }, firstMentionRound, playerProfile);
                    if (generationResult && generationResult.canonicalName && generationResult.templateData) {
                        const newTemplateData = { ...generationResult.templateData, createdAt: admin.firestore.FieldValue.serverTimestamp() };
                        await db.collection('npcs').doc(generationResult.canonicalName).set(newTemplateData);
                        console.log(`[健康檢查-NPC創建] 成功為「${generationResult.canonicalName}」創建了通用模板。`);
                    }
                } catch (genError) {
                    console.error(`[健康檢查-NPC創建] 為「${npcName}」生成模板時AI出錯:`, genError);
                }
            } else {
                console.warn(`[健康檢查-NPC創建] 警告：在存檔中找不到NPC「${npcName}」的初見情境，無法為其生成模板。`);
            }
        }
    }
}

/**
 * 總健康檢查函式，用於登入後在背景執行
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 */
async function runDataHealthCheck(userId, username) {
    console.log(`[健康檢查] 開始為玩家 ${username} 執行登入後資料健康檢查...`);
    try {
        const userDocRef = db.collection('users').doc(userId);
        const playerDoc = await userDocRef.get();
        if (!playerDoc.exists) return;
        const playerProfile = playerDoc.data();

        const allSavesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'asc').get();
        const allSavesData = allSavesSnapshot.docs.map(doc => doc.data());

        await Promise.all([
            checkUserFields(userId),
            repairMissingNpcTemplates(userId, username, playerProfile, allSavesData),
            repairIncompleteNpcTemplates(userId, username, playerProfile, allSavesData),
            backfillNpcStates(userId) // 【核心新增】執行NPC狀態檔案的回填
        ]);
        console.log(`[健康檢查] 玩家 ${username} 的所有資料健康檢查完畢。`);
    } catch (error) {
        console.error(`[健康檢查] 為玩家 ${username} 執行時發生錯誤:`, error);
    }
}

module.exports = {
    runDataHealthCheck
};
