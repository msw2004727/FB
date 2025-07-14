// api/dataIntegrityService.js
const admin = require('firebase-admin');
const { DEFAULT_USER_FIELDS } = require('./models/userModel');
const { generateNpcTemplateData } = require('../services/npcCreationService');
const { getOrGenerateItemTemplate, getOrGenerateSkillTemplate } = require('./playerStateHelpers');
const { generateAndCacheLocation } = require('./worldEngine');
const { addCurrency } = require('./economyManager');

const db = admin.firestore();

// 定義一個NPC狀態檔案應有的預設欄位和值
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
 * 將舊的 money 欄位轉移到銀兩物品，並刪除舊欄位
 * @param {string} userId - 玩家ID
 * @param {object} userData - 玩家的文檔數據
 */
async function migrateCurrency(userId, userData) {
    // 檢查舊的 money 欄位是否存在且大於0
    if (userData.money !== undefined && typeof userData.money === 'number' && userData.money > 0) {
        console.log(`[健康檢查-貨幣] 發現玩家 ${userId} 存在舊貨幣 ${userData.money} 文錢，開始清算...`);
        const batch = db.batch();
        const userDocRef = db.collection('users').doc(userId);
        
        // 1. 將舊貨幣加到銀兩中
        await addCurrency(userId, userData.money, batch);
        
        // 2. 刪除舊的 money 欄位
        batch.update(userDocRef, { money: admin.firestore.FieldValue.delete() });
        
        await batch.commit();
        console.log(`[健康檢查-貨幣] 清算完畢！已將 ${userData.money} 文錢兌換為銀兩，並移除舊欄位。`);
    }
}

/**
 * 為指定玩家的所有舊NPC狀態檔案，補全缺失的欄位
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
 * @param {object} userData - 從資料庫讀取的原始玩家數據
 */
async function checkUserFields(userId, userData) {
    const userDocRef = db.collection('users').doc(userId);
    const updates = {};
    let needsUpdate = false;

    for (const [field, defaultValue] of Object.entries(DEFAULT_USER_FIELDS)) {
        if (userData[field] === undefined) {
            needsUpdate = true;
            updates[field] = defaultValue;
        }
    }
    
    const fieldsToEnsureNumber = ['internalPower', 'externalPower', 'lightness', 'morality', 'stamina', 'bulkScore', 'R', 'shortActionCounter', 'year', 'month', 'day', 'maxInternalPowerAchieved', 'maxExternalPowerAchieved', 'maxLightnessAchieved'];
    for (const field of fieldsToEnsureNumber) {
        if (userData[field] !== undefined && typeof userData[field] !== 'number') {
            const parsedValue = Number(userData[field]);
            updates[field] = isNaN(parsedValue) ? (DEFAULT_USER_FIELDS[field] || 0) : parsedValue;
            needsUpdate = true;
        }
    }
    
    const finalData = { ...userData, ...updates };
    const powerTypes = ['Internal', 'External', 'Lightness'];

    powerTypes.forEach(type => {
        const currentPowerKey = type.toLowerCase() + 'Power';
        const maxPowerKey = 'max' + type + 'PowerAchieved';
        const currentPower = finalData[currentPowerKey] || 0;
        const maxPower = finalData[maxPowerKey] || 0;

        if (currentPower > maxPower) {
            updates[maxPowerKey] = currentPower;
            needsUpdate = true;
            console.log(`[健康檢查-玩家] 修正歷史巔峰記錄: ${maxPowerKey} 從 ${maxPower} 修復為 ${currentPower}。`);
        }
    });

    if (needsUpdate) {
        await userDocRef.update(updates);
        console.log(`[健康檢查-玩家] 已為玩家 ${userId} 補全並修正了核心欄位。`);
    }
}

/**
 * 修復內容不完整的NPC公用模板
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

        // 1. 優先處理貨幣轉移
        await migrateCurrency(userId, playerProfile);

        // 2. 在其他檢查前，先確保玩家檔案本身是健康的
        await checkUserFields(userId, playerProfile);
        
        // 3. 獲取所有存檔，供後續檢查共用
        const allSavesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'asc').get();
        const allSavesData = allSavesSnapshot.docs.map(doc => doc.data());
        
        // 4. 並行執行剩餘的檢查
        await Promise.all([
            repairMissingNpcTemplates(userId, username, playerProfile, allSavesData),
            repairIncompleteNpcTemplates(userId, username, playerProfile, allSavesData),
            backfillNpcStates(userId)
        ]);
        console.log(`[健康檢查] 玩家 ${username} 的所有資料健康檢查完畢。`);
    } catch (error) {
        console.error(`[健康檢查] 為玩家 ${username} 執行時發生錯誤:`, error);
    }
}

module.exports = {
    runDataHealthCheck
};
