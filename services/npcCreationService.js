// services/npcCreationService.js
const admin = require('firebase-admin');
// 【路徑已修正】
const { callAI, aiConfig } = require('./aiService'); 
const { getNpcCreatorPrompt } = require('../prompts/npcCreatorPrompt.js');
const { processNpcRelationships } = require('../api/relationshipManager');

const db = admin.firestore();

/**
 * 根據NPC的職業和地位，為其生成一個合理的初始金錢。
 * @param {object} npcProfile - NPC的通用模板資料
 * @returns {number} - 應有的金錢數量
 */
function getMoneyForNpc(npcProfile) {
    if (!npcProfile) return 10;
    const occupation = npcProfile.occupation || '';
    const status = npcProfile.status_title || '';
    let money = Math.floor(Math.random() * 50) + 10;

    if (['富商', '老闆', '掌櫃', '員外'].some(kw => occupation.includes(kw) || status.includes(kw))) {
        money = Math.floor(Math.random() * 5000) + 1000;
    } else if (['官', '捕頭', '將軍', '知府', '縣令'].some(kw => occupation.includes(kw) || status.includes(kw))) {
        money = Math.floor(Math.random() * 2000) + 500;
    } else if (['殺手', '遊俠', '鏢頭', '刺客'].some(kw => occupation.includes(kw) || status.includes(kw))) {
        money = Math.floor(Math.random() * 800) + 200;
    } else if (['鐵匠', '郎中', '教頭', '工匠', '廚師'].some(kw => occupation.includes(kw) || status.includes(kw))) {
        money = Math.floor(Math.random() * 400) + 100;
    } else if (['乞丐', '難民', '流民'].some(kw => occupation.includes(kw) || status.includes(kw))) {
        money = Math.floor(Math.random() * 10);
    }
    
    return money;
}

/**
 * 【核心創建邏輯】此函式負責從無到有生成一個完整的NPC模板。
 * @param {string} username - 玩家名稱
 * @param {object} npcDataFromStory - 從故事AI得到的NPC基礎數據
 * @param {object} roundData - 當前回合數據
 * @param {object} playerProfile - 玩家的完整檔案
 * @returns {Promise<{canonicalName: string, templateData: object}|null>} - 包含權威名稱和模板數據的物件，或在失敗時返回null
 */
async function generateNpcTemplateData(username, npcDataFromStory, roundData, playerProfile) {
    const initialName = npcDataFromStory.name;
    try {
        console.log(`[NPC Creation Service] 為「${initialName}」啟動AI生成程序...`);
        const prompt = getNpcCreatorPrompt(username, initialName, roundData, playerProfile);
        const npcJsonString = await callAI(aiConfig.npcProfile, prompt, true);
        const newTemplateData = JSON.parse(npcJsonString.replace(/^```json\s*|```\s*$/g, ''));

        const canonicalName = newTemplateData.name || initialName;
        if (!canonicalName) {
            throw new Error("NPC Creator AI 未能生成有效的 'name' 欄位。");
        }
        
        newTemplateData.name = canonicalName; 
        
        const rand = Math.random();
        newTemplateData.romanceOrientation = rand < 0.7 ? "異性戀" : rand < 0.85 ? "雙性戀" : rand < 0.95 ? "同性戀" : "無性戀";
        
        const encounterLocation = roundData.LOC && roundData.LOC.length > 0 ? roundData.LOC[0] : '未知之地';
        if (!newTemplateData.currentLocation) {
             newTemplateData.currentLocation = encounterLocation;
        }
        
        return { canonicalName, templateData: newTemplateData };

    } catch (error) {
        console.error(`[NPC Creation Service] 為 "${initialName}" 生成模板時發生錯誤:`, error);
        return null;
    }
}


/**
 * 【核心創建函式】負責處理新NPC的完整資料庫寫入流程
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 * @param {object} npcDataFromStory - 從故事AI得到的NPC基礎數據
 * @param {object} roundData - 當前回合數據
 * @param {object} playerProfile - 玩家的完整檔案
 * @param {admin.firestore.WriteBatch} batch - Firestore的批次寫入物件
 * @returns {Promise<string|null>} 成功時返回NPC的權威名稱，失敗時返回null
 */
async function createNewNpc(userId, username, npcDataFromStory, roundData, playerProfile, batch) {
    const initialName = npcDataFromStory.name;
    console.log(`[NPC Creation Service] 偵測到全新NPC「${initialName}」，啟動完整建檔流程...`);
    
    const npcTemplateRef = db.collection('npcs').doc(initialName);
    const templateDoc = await npcTemplateRef.get();

    let canonicalName = initialName;
    let npcTemplateData;

    if (!templateDoc.exists) {
        const generationResult = await generateNpcTemplateData(username, npcDataFromStory, roundData, playerProfile);
        
        if (generationResult && generationResult.canonicalName && generationResult.templateData) {
            canonicalName = generationResult.canonicalName;
            npcTemplateData = generationResult.templateData;
            
            const finalTemplateRef = db.collection('npcs').doc(canonicalName);
            npcTemplateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
            batch.set(finalTemplateRef, npcTemplateData);
            console.log(`[NPC Creation Service] 已將「${canonicalName}」的通用模板加入批次創建佇列 (ID: ${canonicalName})。`);
            
            if (npcTemplateData.relationships) {
                processNpcRelationships(userId, canonicalName, npcTemplateData.relationships)
                    .catch(err => console.error(`[關係引擎背景錯誤] NPC: ${canonicalName}, UserID: ${userId}, 錯誤:`, err));
            }
        } else {
            console.error(`[嚴重錯誤] 無法為NPC "${initialName}" 生成有效的模板數據，建檔中止。`);
            return null;
        }
    } else {
        npcTemplateData = templateDoc.data();
        canonicalName = npcTemplateData.name || initialName;
        console.log(`[NPC Creation Service] 「${initialName}」的通用模板已存在，權威名稱為「${canonicalName}」，跳過AI生成。`);
    }

    const playerLocation = roundData.LOC && roundData.LOC.length > 0 ? roundData.LOC[0] : '未知之地';
    const npcStateDocRef = db.collection('users').doc(userId).collection('npc_states').doc(canonicalName);
    
    const encounterTime = `${roundData.yearName || '元祐'}${roundData.year || 1}年${roundData.month || 1}月${roundData.day || 1}日 ${roundData.timeOfDay || '未知時辰'}`;
    const initialMoney = getMoneyForNpc(npcTemplateData);
    
    const initialStatePayload = {
        currentLocation: playerLocation,
        interactionSummary: `你與${canonicalName}的交往尚淺。`,
        firstMet: {
            round: roundData.R,
            time: encounterTime,
            location: playerLocation,
            event: roundData.EVT || '初次相遇'
        },
        isDeceased: false,
        inventory: { '銀兩': initialMoney },
        equipment: npcTemplateData.initialEquipment || [], 
        romanceValue: 0,
        friendlinessValue: npcDataFromStory.friendlinessChange || 0,
        triggeredRomanceEvents: []
    };
    batch.set(npcStateDocRef, initialStatePayload);
    console.log(`[NPC Creation Service] 已為新NPC「${canonicalName}」建立完整的玩家專屬狀態檔案 (ID: ${canonicalName})。`);

    return canonicalName;
}

module.exports = {
    createNewNpc,
    generateNpcTemplateData 
};
