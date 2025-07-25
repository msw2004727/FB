// /services/npcCreationService.js
const admin = require('firebase-admin');
const { callAI, aiConfig } = require('./aiService');
const { getNpcCreatorPrompt } = require('../prompts/npcCreatorPrompt.js');
const { processNpcRelationships } = require('../api/relationshipManager');

const db = admin.firestore();

// 【核心新增】在創建新NPC前，先在資料庫中尋找潛在的親友
async function findPotentialRelatives(npcName, location) {
    if (!location) return {};

    const npcsRef = db.collection('npcs');
    const snapshot = await npcsRef.where('currentLocation', '==', location).get();
    if (snapshot.empty) return {};

    const potentialRelatives = {
        father: [],
        mother: [],
        spouse: [],
        sibling: []
    };
    
    // 簡單的姓氏和地點匹配邏輯
    const surname = npcName.charAt(0);

    snapshot.forEach(doc => {
        const data = doc.data();
        // 排除自己
        if (data.name === npcName) return;

        // 尋找潛在的父親 (同姓、男性、年齡大20-40歲)
        if (data.name.startsWith(surname) && data.gender === '男' && data.age > 20) {
            potentialRelatives.father.push({ name: data.name, age: data.age });
        }
        // 尋找潛在的母親 (女性、年齡大20-40歲)
        if (data.gender === '女' && data.age > 20) {
            potentialRelatives.mother.push({ name: data.name, age: data.age });
        }
    });

    return potentialRelatives;
}


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

async function generateNpcTemplateData(username, npcDataFromStory, roundData, playerProfile) {
    const initialName = npcDataFromStory.name;
    try {
        console.log(`[NPC Creation Service] 為「${initialName}」啟動AI生成程序...`);
        
        const encounterLocation = roundData.LOC && roundData.LOC.length > 0 ? roundData.LOC[0] : null;
        const potentialRelationships = await findPotentialRelatives(initialName, encounterLocation);

        const prompt = getNpcCreatorPrompt(username, initialName, roundData, playerProfile, potentialRelationships);
        const npcJsonString = await callAI(aiConfig.npcProfile, prompt, true);
        const newTemplateData = JSON.parse(npcJsonString.replace(/^```json\s*|```\s*$/g, ''));

        const canonicalName = newTemplateData.name || initialName;
        if (!canonicalName) {
            throw new Error("NPC Creator AI 未能生成有效的 'name' 欄位。");
        }
        
        newTemplateData.name = canonicalName; 
        
        // --- 【核心修改】為新創建的NPC預留頭像欄位 ---
        newTemplateData.avatarUrl = null; 
        // --- 修改結束 ---
        
        const rand = Math.random();
        newTemplateData.romanceOrientation = rand < 0.7 ? "異性戀" : rand < 0.85 ? "雙性戀" : rand < 0.95 ? "同性戀" : "無性戀";
        
        if (!newTemplateData.currentLocation && encounterLocation) {
             newTemplateData.currentLocation = encounterLocation;
        }
        
        return { canonicalName, templateData: newTemplateData };

    } catch (error) {
        console.error(`[NPC Creation Service] 為 "${initialName}" 生成模板時發生錯誤:`, error);
        return null;
    }
}

async function createNewNpc(userId, username, npcDataFromStory, roundData, playerProfile, batch) {
    const initialName = npcDataFromStory.name;
    console.log(`[NPC 創建服務 v2.0] 偵測到新NPC「${initialName}」，開始建檔流程...`);
    
    const generationResult = await generateNpcTemplateData(username, npcDataFromStory, roundData, playerProfile);
    
    if (!generationResult || !generationResult.canonicalName || !generationResult.templateData) {
        console.error(`[嚴重錯誤] 無法為NPC "${initialName}" 生成有效的模板數據，建檔中止。`);
        return null;
    }

    const { canonicalName, templateData: npcTemplateData } = generationResult;
    
    const finalTemplateRef = db.collection('npcs').doc(canonicalName);
    npcTemplateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
    
    batch.set(finalTemplateRef, npcTemplateData);
    console.log(`[NPC 創建服務 v2.0] AI生成完畢，新模板「${canonicalName}」已加入批次創建佇列。`);
    
    if (npcTemplateData.relationships) {
        processNpcRelationships(userId, canonicalName, npcTemplateData.relationships)
            .catch(err => console.error(`[關係引擎背景錯誤] NPC: ${canonicalName}, UserID: ${userId}, 錯誤:`, err));
    }

    const playerLocation = roundData.LOC && roundData.LOC.length > 0 ? roundData.LOC[roundData.LOC.length - 1] : '未知之地';
    const npcStateDocRef = db.collection('users').doc(userId).collection('npc_states').doc(canonicalName);
    
    const encounterTime = `${roundData.yearName || '元祐'}${roundData.year || 1}年${roundData.month || 1}月${roundData.day || 1}日 ${roundData.timeOfDay || '未知時辰'}`;
    const initialMoney = getMoneyForNpc(npcTemplateData);
    
    const initialStatePayload = {
        currentLocation: playerLocation,
        interactionSummary: `你與${canonicalName}在${playerLocation}初次相遇。`,
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
        friendlinessValue: npcTemplateData.initialFriendlinessValue || npcDataFromStory.friendlinessChange || 0,
        triggeredRomanceEvents: []
    };

    batch.set(npcStateDocRef, initialStatePayload);
    console.log(`[NPC 創建服務 v2.0] 已為玩家 ${username} 建立與NPC「${canonicalName}」的個人關聯檔案。`);

    return canonicalName;
}

module.exports = {
    createNewNpc,
    generateNpcTemplateData
};
