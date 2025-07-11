// api/worldEngine.js
const admin = require('firebase-admin');
const { getBountyGeneratorPrompt } = require('../prompts/bountyGeneratorPrompt.js');
const { getLocationGeneratorPrompt } = require('../prompts/locationGeneratorPrompt.js');
const { callAI, aiConfig } = require('../services/aiService');

const db = admin.firestore();

/**
 * 【核心修改 2.0】採納全新的靜態/動態分離架構。
 * @param {string} userId - 玩家的ID.
 * @param {string} locationName - 新地點的名稱.
 * @param {string} locationType - 新地點的類型.
 * @param {string} worldSummary - 當前世界的長期故事摘要.
 */
async function generateAndCacheLocation(userId, locationName, locationType = '未知', worldSummary = '江湖軼事無可考。') {
    if (!userId || !locationName) return;
    console.log(`[世界引擎 2.0] 收到為玩家 ${userId} 初始化地點 ${locationName} 的請求...`);

    const staticLocationRef = db.collection('locations').doc(locationName);
    const dynamicLocationRef = db.collection('users').doc(userId).collection('location_states').doc(locationName);

    try {
        const staticDoc = await staticLocationRef.get();
        let staticData;

        // 步驟 1: 處理靜態地點模板
        if (staticDoc.exists) {
            console.log(`[世界引擎 2.0] 地點「${locationName}」的共享模板已存在，跳過AI生成。`);
            staticData = staticDoc.data();
        } else {
            console.log(`[世界引擎 2.0] 為「${locationName}」啟動共享模板生成程序...`);
            const prompt = getLocationGeneratorPrompt(locationName, locationType, worldSummary);
            const locationJsonString = await callAI(aiConfig.location, prompt, true);
            const newLocationData = JSON.parse(locationJsonString);

            if (!newLocationData.staticTemplate || !newLocationData.initialDynamicState) {
                throw new Error("AI生成的地點資料結構不完整，缺少靜態或動態部分。");
            }
            
            // 將靜態模板存入 'locations' 集合
            staticData = newLocationData.staticTemplate;
            await staticLocationRef.set(staticData);
            console.log(`[世界引擎 2.0] 成功為「${locationName}」建立共享模板。`);

            // 直接將對應的初始動態狀態存給當前玩家
            await dynamicLocationRef.set(newLocationData.initialDynamicState);
            console.log(`[世界引擎 2.0] 已為玩家 ${userId} 初始化了「${locationName}」的初始動態狀態。`);
            return; // 完成後直接返回，因為動態部分已在此處處理
        }

        // 步驟 2: 處理玩家專屬的動態地點狀態
        const dynamicDoc = await dynamicLocationRef.get();
        if (!dynamicDoc.exists) {
            console.log(`[世界引擎 2.0] 模板已存在，但玩家 ${userId} 的動態狀態不存在，正在為其建立...`);
            
            // 這裡可以設計一個更智能的預設值，但目前簡單處理
            const initialDynamicData = {
                governance: {
                    ruler: '未知',
                    allegiance: '獨立',
                    security: '普通'
                },
                economy: {
                    currentProsperity: '普通'
                },
                facilities: [],
                buildings: [],
                lore: {
                    currentIssues: ['暫無江湖傳聞']
                }
            };
            await dynamicLocationRef.set(initialDynamicData);
            console.log(`[世界引擎 2.0] 成功為玩家 ${userId} 初始化了「${locationName}」的動態狀態。`);
        }

    } catch (error) {
        console.error(`[世界引擎 2.0] 在處理地點「${locationName}」時發生錯誤:`, error);
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
