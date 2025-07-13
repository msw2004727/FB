// api/worldEngine.js
const admin = require('firebase-admin');
const { getBountyGeneratorPrompt } = require('../prompts/bountyGeneratorPrompt.js');
const { getLocationGeneratorPrompt } = require('../prompts/locationGeneratorPrompt.js');
const { callAI, aiConfig } = require('../services/aiService');

const db = admin.firestore();

/**
 * 【核心重構 4.0】採用「先檢查、後創建」的全局模板生成邏輯
 * @param {string} userId - 玩家的ID.
 * @param {string} locationName - 需要生成的最深層地點的名稱.
 * @param {string} locationType - 地點的類型.
 * @param {string} worldSummary - 當前世界的長期故事摘要.
 * @param {Array<string>} [knownHierarchy=[]] - 已知的上級地點層級.
 */
async function generateAndCacheLocation(userId, locationName, locationType = '未知', worldSummary = '江湖軼事無可考。', knownHierarchy = []) {
    if (!userId || !locationName) return;
    console.log(`[世界引擎 4.0] 收到為玩家 ${userId} 初始化地點「${locationName}」的請求...`);

    const staticLocationRef = db.collection('locations').doc(locationName);
    const dynamicLocationRef = db.collection('users').doc(userId).collection('location_states').doc(locationName);

    try {
        let staticDoc = await staticLocationRef.get();

        // 步驟一：檢查並創建最外層的【全局靜態模板】
        if (!staticDoc.exists) {
            console.log(`[世界引擎 4.0] 全局模板「${locationName}」不存在，啟動AI生成程序...`);
            
            const generationContext = `需要為地點「${locationName}」建檔。目前已知的上級地點包含：${knownHierarchy.join('->') || '無'}。請基於此脈絡，生成包含「${locationName}」在內的完整、合理的行政層級。`;
            
            const prompt = getLocationGeneratorPrompt(locationName, locationType, generationContext);
            const locationJsonString = await callAI(aiConfig.location, prompt, true);
            const locationDataArray = JSON.parse(locationJsonString).locationHierarchy;

            if (!locationDataArray || !Array.isArray(locationDataArray) || locationDataArray.length === 0) {
                 throw new Error("AI生成的地點資料結構不正確，應為一個包含地點物件的陣列。");
            }
            
            const batch = db.batch();

            for (const loc of locationDataArray) {
                const locRef = db.collection('locations').doc(loc.locationName);
                const docToCheck = await locRef.get();
                if (!docToCheck.exists) {
                    batch.set(locRef, loc.staticTemplate);
                    console.log(`[世界引擎 4.0] 已將新地點「${loc.locationName}」的全局模板加入批次創建佇列。`);
                }
            }
            
            await batch.commit();
            console.log(`[世界引擎 4.0] 成功批次創建地點層級的全局模板。`);

            // 重新獲取一次，確保後續邏輯能用到剛創建的資料
            staticDoc = await staticLocationRef.get(); 
        } else {
             console.log(`[世界引擎 4.0] 地點「${locationName}」的全局模板已存在，跳過AI生成。`);
        }

        // 步驟二：為當前玩家創建【個人動態狀態】
        const dynamicDoc = await dynamicLocationRef.get();
        if (!dynamicDoc.exists) {
            console.log(`[世界引擎 4.0] 玩家 ${userId} 的個人地點狀態「${locationName}」不存在，正在為其初始化...`);
            
            // 從剛獲取或已存在的靜態文檔中，提取對應的初始動態狀態
            // 這裡假設 getLocationGeneratorPrompt 返回的結構中，staticTemplate 同層級有 initialDynamicState
            // 我們需要找到對應 locationName 的 initialDynamicState
            const staticData = staticDoc.data(); 

            // 如果模板是AI生成的，我們可以從中獲取初始狀態，否則使用一個預設值
            // 這個邏輯需要 getLocationGeneratorPrompt 配合返回 staticTemplate 和 initialDynamicState
            // 由於我們無法直接從 staticDoc 獲取 initialDynamicState，這裡使用一個安全的預設值
            const initialDynamicData = {
                governance: { ruler: staticData.governance?.ruler || '未知', allegiance: staticData.governance?.allegiance ||'獨立', security: '普通' },
                economy: { currentProsperity: '普通' },
                facilities: staticData.facilities || [],
                buildings: staticData.buildings || [],
                lore: { currentIssues: ['暫無江湖傳聞'] }
            };

            await dynamicLocationRef.set(initialDynamicData);
            console.log(`[世界引擎 4.0] 成功為玩家 ${userId} 初始化了「${locationName}」的個人地點狀態。`);
        }

    } catch (error) {
        console.error(`[世界引擎 4.0] 在處理地點「${locationName}」時發生嚴重錯誤:`, error);
    }
}


/**
 * 根據詳細的玩家情境，觸發一次新的懸賞生成。
 * @param {string} userId - 玩家的ID
 * @param {string} longTermSummary - 長期故事摘要
 */
async function triggerBountyGeneration(userId, longTermSummary) {
    console.log(`[世界引擎] 正在為玩家 ${userId} 嘗試生成新的懸賞...`);
    
    try {
        const userDocRef = db.collection('users').doc(userId);
        
        const [npcsSnapshot, lastSaveSnapshot] = await Promise.all([
            userDocRef.collection('npc_states').get(),
            userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get()
        ]);

        if (lastSaveSnapshot.empty) {
            console.warn(`[世界引擎] 找不到玩家 ${userId} 的最新存檔，無法生成懸賞。`);
            return;
        }
        
        const npcDetails = [];
        if(!npcsSnapshot.empty){
             const npcTemplatePromises = npcsSnapshot.docs.map(doc => db.collection('npcs').doc(doc.id).get());
             const npcTemplateDocs = await Promise.all(npcTemplatePromises);
             npcTemplateDocs.forEach(templateDoc => {
                 if(templateDoc.exists){
                      const data = templateDoc.data();
                      npcDetails.push({
                        name: data.name,
                        background: data.background || '背景不詳'
                      });
                 }
             });
        }
       
        const playerLocation = lastSaveSnapshot.docs[0].data().LOC[0] || '未知之地';

        const playerContext = {
            longTermSummary,
            npcDetails,
            playerLocation
        };

        const prompt = getBountyGeneratorPrompt(playerContext);
        const bountyJsonString = await callAI(aiConfig.bounty, prompt, true); 
        const newBountyData = JSON.parse(bountyJsonString);

        if (!newBountyData.title || !newBountyData.content) {
            console.log(`[世界引擎] AI生成的懸賞資料不完整，本次跳過。`);
            return;
        }
        
        const rand = Math.random();
        if (rand < 0.4) {
            newBountyData.difficulty = "低";
        } else if (rand < 0.9) {
            newBountyData.difficulty = "中";
        } else {
            newBountyData.difficulty = "高";
        }
        console.log(`[懸賞系統] 已為新懸賞隨機指派難度為: ${newBountyData.difficulty}`);

        newBountyData.status = 'active';
        newBountyData.isRead = false;
        newBountyData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        
        const expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + 7);
        newBountyData.expireAt = admin.firestore.Timestamp.fromDate(expireDate);

        const bountiesRef = db.collection('users').doc(userId).collection('bounties');
        await bountiesRef.add(newBountyData);

        console.log(`[世界引擎] 成功為玩家 ${userId} 生成新懸賞: "${newBountyData.title}"`);

    } catch (error) {
        console.error(`[世界引擎] 為玩家 ${userId} 生成懸賞時發生錯誤:`, error);
    }
}

module.exports = {
    triggerBountyGeneration,
    generateAndCacheLocation
};
