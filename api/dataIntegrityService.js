// api/dataIntegrityService.js
const admin = require('firebase-admin');
const { DEFAULT_USER_FIELDS } = require('./authRoutes'); // 從 authRoutes 導入預設欄位
const { generateNpcTemplateData } = require('../services/npcCreationService');
const { getOrGenerateItemTemplate, getOrGenerateSkillTemplate } = require('./playerStateHelpers');
const { generateAndCacheLocation } = require('./worldEngine');

const db = admin.firestore();

/**
 * 檢查並修補玩家資料中的預設欄位
 * @param {string} userId - 玩家ID
 */
async function checkUserFields(userId) {
    const userDocRef = db.collection('users').doc(userId);
    const userDoc = await userDocRef.get();
    if (!userDoc.exists) return;

    const userData = userDoc.data();
    const batch = db.batch();
    let needsUpdate = false;

    for (const [field, defaultValue] of Object.entries(DEFAULT_USER_FIELDS)) {
        if (userData[field] === undefined) {
            needsUpdate = true;
            let value = defaultValue;
            if (field === 'maxInternalPowerAchieved') value = userData.internalPower || defaultValue;
            else if (field === 'maxExternalPowerAchieved') value = userData.externalPower || defaultValue;
            else if (field === 'maxLightnessAchieved') value = userData.lightness || defaultValue;
            batch.update(userDocRef, { [field]: value });
        }
    }

    if (needsUpdate) {
        await batch.commit();
        console.log(`[健康檢查-玩家] 已為玩家 ${userId} 補全了缺失的核心欄位。`);
    }
}

/**
 * 檢查玩家所有接觸過的NPC，並為缺少模板的NPC重建檔案
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 */
async function checkNpcTemplates(userId, username) {
    const userDocRef = db.collection('users').doc(userId);
    const userData = (await userDocRef.get()).data();
    const npcStatesSnapshot = await userDocRef.collection('npc_states').get();

    if (npcStatesSnapshot.empty) return;

    const allSavesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'asc').get();
    const allSavesData = allSavesSnapshot.docs.map(doc => doc.data());

    for (const npcStateDoc of npcStatesSnapshot.docs) {
        const npcName = npcStateDoc.id;
        const npcTemplateRef = db.collection('npcs').doc(npcName);
        const npcTemplateDoc = await npcTemplateRef.get();

        if (!npcTemplateDoc.exists) {
            console.log(`[健康檢查-NPC] 偵測到「${npcName}」缺少模板，開始自動修補...`);
            const firstMentionRound = allSavesData.find(round => round.NPC?.some(npc => npc.name === npcName));

            if (firstMentionRound) {
                try {
                    const generationResult = await generateNpcTemplateData(username, { name: npcName }, firstMentionRound, userData);
                    if (generationResult && generationResult.canonicalName && generationResult.templateData) {
                        const newTemplateData = { ...generationResult.templateData, createdAt: admin.firestore.FieldValue.serverTimestamp() };
                        await db.collection('npcs').doc(generationResult.canonicalName).set(newTemplateData);
                        console.log(`[健康檢查-NPC] 成功為「${generationResult.canonicalName}」重建了通用模板。`);
                    }
                } catch (genError) {
                    console.error(`[健康檢查-NPC] 為「${npcName}」生成模板時AI出錯:`, genError);
                }
            } else {
                console.warn(`[健康檢查-NPC] 警告：在存檔中找不到NPC「${npcName}」的初見情境，無法為其生成模板。`);
            }
        }
    }
}

/**
 * 檢查玩家物品，確保所有物品都有對應的模板
 * @param {string} userId - 玩家ID
 */
async function checkItemTemplates(userId) {
    const inventorySnapshot = await db.collection('users').doc(userId).collection('inventory_items').get();
    if (inventorySnapshot.empty) return;

    console.log(`[健康檢查-物品] 開始為玩家 ${userId} 檢查 ${inventorySnapshot.size} 件物品...`);
    const promises = inventorySnapshot.docs.map(doc => {
        const itemData = doc.data();
        if (itemData.templateId) {
            // getOrGenerateItemTemplate 函式內部已包含檢查和創建邏輯
            return getOrGenerateItemTemplate(itemData.templateId);
        }
        return Promise.resolve();
    });

    await Promise.all(promises);
    console.log(`[健康檢查-物品] 玩家 ${userId} 的物品模板檢查完畢。`);
}

/**
 * 檢查玩家技能，確保所有技能都有對應的模板
 * @param {string} userId - 玩家ID
 */
async function checkSkillTemplates(userId) {
    const skillsSnapshot = await db.collection('users').doc(userId).collection('skills').get();
    if (skillsSnapshot.empty) return;

    console.log(`[健康檢查-技能] 開始為玩家 ${userId} 檢查 ${skillsSnapshot.size} 項技能...`);
    const promises = skillsSnapshot.docs.map(doc => {
        const skillName = doc.id;
        // getOrGenerateSkillTemplate 函式內部已包含檢查和創建邏輯
        return getOrGenerateSkillTemplate(skillName);
    });

    await Promise.all(promises);
     console.log(`[健康檢查-技能] 玩家 ${userId} 的技能模板檢查完畢。`);
}

/**
 * 檢查玩家去過的地點，確保所有地點都有對應的模板
 * @param {string} userId - 玩家ID
 */
async function checkLocationTemplates(userId) {
    const locationsSnapshot = await db.collection('users').doc(userId).collection('location_states').get();
    if (locationsSnapshot.empty) return;
    
    console.log(`[健康檢查-地點] 開始為玩家 ${userId} 檢查 ${locationsSnapshot.size} 個地點...`);
    const summaryDoc = await db.collection('users').doc(userId).collection('game_state').doc('summary').get();
    const worldSummary = summaryDoc.exists ? summaryDoc.data().text : '江湖軼事無可考。';

    const promises = locationsSnapshot.docs.map(doc => {
        const locationName = doc.id;
        // generateAndCacheLocation 函式內部已包含檢查和創建邏輯
        return generateAndCacheLocation(userId, locationName, '未知', worldSummary);
    });
    
    await Promise.all(promises);
    console.log(`[健康檢查-地點] 玩家 ${userId} 的地點模板檢查完畢。`);
}


/**
 * 總健康檢查函式，用於登入後在背景執行
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 */
async function runDataHealthCheck(userId, username) {
    console.log(`[健康檢查] 開始為玩家 ${username} 執行登入後資料健康檢查...`);
    try {
        // 將所有檢查任務並行執行以提高效率
        await Promise.all([
            checkUserFields(userId),
            checkNpcTemplates(userId, username),
            checkItemTemplates(userId),
            checkSkillTemplates(userId),
            checkLocationTemplates(userId)
        ]);
        console.log(`[健康檢查] 玩家 ${username} 的所有資料健康檢查完畢。`);
    } catch (error) {
        console.error(`[健康檢查] 為玩家 ${username} 執行時發生錯誤:`, error);
    }
}

module.exports = {
    runDataHealthCheck
};
