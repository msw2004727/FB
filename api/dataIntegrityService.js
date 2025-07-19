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
 * 總健康檢查函式，用於登入後在背景執行
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 */
async function runDataHealthCheck(userId, username) {
    console.log(`[健康檢查 v2.0] 開始為玩家 ${username} 執行**輕量化**登入檢查...`);
    try {
        const userDocRef = db.collection('users').doc(userId);
        const playerDoc = await userDocRef.get();
        if (!playerDoc.exists) return;
        const playerProfile = playerDoc.data();

        // 【核心修改】只執行輕量級的檢查，移除重量級的AI修復流程
        await migrateCurrency(userId, playerProfile);
        await checkUserFields(userId, playerProfile);
        await backfillNpcStates(userId);
        
        console.log(`[健康檢查 v2.0] 玩家 ${username} 的輕量化檢查完畢。`);
    } catch (error) {
        console.error(`[健康檢查 v2.0] 為玩家 ${username} 執行時發生錯誤:`, error);
    }
}

module.exports = {
    runDataHealthCheck
};
