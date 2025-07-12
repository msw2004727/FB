// /services/npcCreationService.js
const admin = require('firebase-admin');
const { callAI, aiConfig } = require('./aiService'); 
const { getNpcCreatorPrompt } = require('../prompts/npcCreatorPrompt.js');
const { processNpcRelationships } = require('../api/relationshipManager');
const { findReusableNpc } = require('../api/templateManager'); // 引入新的模板管理器

const db = admin.firestore();

/**
 * 【輔助函式】根據NPC的職業和地位，為其生成一個合理的初始金錢。
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
 * 【輔助函式】此函式負責從無到有生成一個全新的NPC模板。
 * @param {string} username - 玩家名稱
 * @param {object} npcDataFromStory - 從故事AI得到的NPC基礎數據 (包含name)
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
 * 【核心創建函式 v2.0】採用「模板優先」策略處理新NPC的完整資料庫寫入流程
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 * @param {object} npcDataFromStory - 從故事AI得到的NPC基礎數據 (必須包含 name 和 status_title)
 * @param {object} roundData - 當前回合數據
 * @param {object} playerProfile - 玩家的完整檔案
 * @param {admin.firestore.WriteBatch} batch - Firestore的批次寫入物件
 * @param {Array<string>} existingNpcIds - 玩家在本局遊戲中已遇到的所有NPC的ID列表
 * @returns {Promise<string|null>} 成功時返回NPC的權威名稱，失敗時返回null
 */
async function createNewNpc(userId, username, npcDataFromStory, roundData, playerProfile, batch, existingNpcIds) {
    const { name: npcName, status: npcStatus } = npcDataFromStory;
    // 從 status 中提取身份，例如 "人稱「葉大師」的葉繼安正專注地打鐵。" -> 身份可能是 "鐵匠"
    // 這是一個簡化邏輯，可以根據需要變得更複雜
    const requiredIdentity = npcStatus.includes('鐵匠') ? '鐵匠' : 
                             npcStatus.includes('郎中') ? '郎中' :
                             npcStatus.includes('商人') ? '商人' :
                             npcStatus.includes('官差') ? '官差' : '浪人'; // 預設身份

    console.log(`[NPC創建服務 v2.0] 接到請求：為 ${username} 創建新NPC「${npcName}」(推斷身份: ${requiredIdentity})`);

    // --- 核心修改：模板優先 ---
    // 1. 嘗試從模板池中尋找可復用的NPC
    const reusableNpcProfile = await findReusableNpc(requiredIdentity, existingNpcIds);
    let finalNpcProfile;
    let canonicalName = npcName; // 預設使用劇情指定的名字

    if (reusableNpcProfile) {
        // 2a. 如果找到了可復用的模板
        console.log(`[NPC創建服務 v2.0] 成功復用模板NPC「${reusableNpcProfile.name}」來扮演「${npcName}」。`);
        finalNpcProfile = { ...reusableNpcProfile };
        canonicalName = finalNpcProfile.name; // 使用模板的權威名稱
    } else {
        // 2b. 如果找不到模板，則啟動AI生成全新的NPC
        console.log(`[NPC創建服務 v2.0] 未找到身份為「${requiredIdentity}」的可用模板，啟動AI為「${npcName}」生成新檔案...`);
        
        const generationResult = await generateNpcTemplateData(username, npcDataFromStory, roundData, playerProfile);
        
        if (generationResult && generationResult.canonicalName && generationResult.templateData) {
            finalNpcProfile = generationResult.templateData;
            canonicalName = generationResult.canonicalName;
            
            const newNpcTemplateRef = db.collection('npcs').doc(canonicalName);
            finalNpcProfile.createdAt = admin.firestore.FieldValue.serverTimestamp();
            
            // 將這個全新的NPC存入 'npcs' 集合，使其成為未來可用的模板
            batch.set(newNpcTemplateRef, finalNpcProfile);
            console.log(`[NPC創建服務 v2.0] AI生成完畢，新NPC「${canonicalName}」已存入全局模板池。`);
            
            // 如果新生成的NPC有關係，則觸發關係處理
            if (finalNpcProfile.relationships) {
                processNpcRelationships(userId, canonicalName, finalNpcProfile.relationships)
                    .catch(err => console.error(`[關係引擎背景錯誤] NPC: ${canonicalName}, UserID: ${userId}, 錯誤:`, err));
            }
        } else {
            console.error(`[嚴重錯誤] 無法為NPC "${npcName}" 生成有效的模板數據，建檔中止。`);
            return null; // 中止創建流程
        }
    }

    // 3. 為玩家創建這個NPC的個人狀態檔案 (npc_states)
    const playerLocation = roundData.LOC && roundData.LOC.length > 0 ? roundData.LOC[roundData.LOC.length - 1] : '未知之地';
    const npcStateDocRef = db.collection('users').doc(userId).collection('npc_states').doc(canonicalName);
    
    const encounterTime = `${roundData.yearName || '元祐'}${roundData.year || 1}年${roundData.month || 1}月${roundData.day || 1}日 ${roundData.timeOfDay || '未知時辰'}`;
    const initialMoney = getMoneyForNpc(finalNpcProfile);
    
    const initialStatePayload = {
        currentLocation: playerLocation, // NPC的初始位置就是玩家遇到他的地方
        interactionSummary: `你與${canonicalName}在${playerLocation}初次相遇。`,
        firstMet: {
            round: roundData.R,
            time: encounterTime,
            location: playerLocation,
            event: roundData.EVT || '初次相遇'
        },
        isDeceased: false,
        inventory: { '銀兩': initialMoney },
        equipment: finalNpcProfile.initialEquipment || [], 
        romanceValue: 0,
        // 根據劇情互動，設定初始好感度
        friendlinessValue: npcDataFromStory.friendlinessChange || 0,
        triggeredRomanceEvents: []
    };

    batch.set(npcStateDocRef, initialStatePayload);
    console.log(`[NPC創建服務 v2.0] 已為玩家 ${username} 建立與NPC「${canonicalName}」的個人關聯檔案。`);

    return canonicalName;
}

module.exports = {
    createNewNpc,
    generateNpcTemplateData // 導出此函式以便其他服務(如authRoutes的修補邏輯)也能使用
};
