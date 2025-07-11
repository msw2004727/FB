// api/worldEngine.js
const admin = require('firebase-admin');
const { getBountyGeneratorPrompt } = require('../prompts/bountyGeneratorPrompt.js');
const { getLocationGeneratorPrompt } = require('../prompts/locationGeneratorPrompt.js');
const { callAI, aiConfig } = require('../services/aiService');

const db = admin.firestore();

/**
 * 【核心重構 3.0】採用批次處理和層級感知的地點生成邏輯
 * @param {string} userId - 玩家的ID.
 * @param {string} locationName - 需要生成的最深層地點的名稱.
 * @param {string} locationType - 地點的類型.
 * @param {string} worldSummary - 當前世界的長期故事摘要.
 * @param {Array<string>} [knownHierarchy=[]] - 已知的上級地點層級.
 */
async function generateAndCacheLocation(userId, locationName, locationType = '未知', worldSummary = '江湖軼事無可考。', knownHierarchy = []) {
    if (!userId || !locationName) return;
    console.log(`[世界引擎 3.0] 收到為玩家 ${userId} 初始化地點「${locationName}」的請求...`);

    const staticLocationRef = db.collection('locations').doc(locationName);
    const dynamicLocationRef = db.collection('users').doc(userId).collection('location_states').doc(locationName);

    try {
        const staticDoc = await staticLocationRef.get();

        // 如果最深層的地點已存在，則無需生成
        if (staticDoc.exists) {
            console.log(`[世界引擎 3.0] 地點「${locationName}」的共享模板已存在，跳過AI生成。`);
        } else {
            console.log(`[世界引擎 3.0] 為「${locationName}」啟動層級感知生成程序...`);
            
            // 建立一個更豐富的上下文，告訴AI我們已經知道了哪些上級
            const generationContext = `需要為地點「${locationName}」建檔。目前已知的上級地點包含：${knownHierarchy.join('->') || '無'}。請基於此脈絡，生成包含「${locationName}」在內的完整、合理的行政層級。`;
            
            const prompt = getLocationGeneratorPrompt(locationName, locationType, generationContext);
            const locationJsonString = await callAI(aiConfig.location, prompt, true);
            const locationDataArray = JSON.parse(locationJsonString).locationHierarchy; // 假設AI現在會回傳一個地點陣列

            if (!locationDataArray || !Array.isArray(locationDataArray) || locationDataArray.length === 0) {
                 throw new Error("AI生成的地點資料結構不正確，應為一個包含地點物件的陣列。");
            }
            
            const batch = db.batch();

            for (const loc of locationDataArray) {
                const locRef = db.collection('locations').doc(loc.locationName);
                const doc = await locRef.get();
                // 只有當該層級的地點不存在時，才寫入
                if (!doc.exists) {
                    batch.set(locRef, loc.staticTemplate);
                     console.log(`[世界引擎 3.0] 已將新地點「${loc.locationName}」加入批次創建佇列。`);
                }
            }

            // 為玩家初始化最深層地點的動態狀態
            const deepestLocation = locationDataArray.find(loc => loc.locationName === locationName);
            if (deepestLocation) {
                batch.set(dynamicLocationRef, deepestLocation.initialDynamicState);
            }
            
            await batch.commit();
            console.log(`[世界引擎 3.0] 成功批次創建地點層級及玩家初始狀態。`);
            return;
        }

        // 如果模板存在，但玩家的動態狀態不存在，則為其建立
        const dynamicDoc = await dynamicLocationRef.get();
        if (!dynamicDoc.exists) {
            console.log(`[世界引擎 3.0] 模板已存在，但玩家 ${userId} 的動態狀態不存在，正在為其建立...`);
            const initialDynamicData = {
                governance: { ruler: '未知', allegiance: '獨立', security: '普通' },
                economy: { currentProsperity: '普通' },
                facilities: [],
                buildings: [],
                lore: { currentIssues: ['暫無江湖傳聞'] }
            };
            await dynamicLocationRef.set(initialDynamicData);
            console.log(`[世界引擎 3.0] 成功為玩家 ${userId} 初始化了「${locationName}」的動態狀態。`);
        }

    } catch (error) {
        console.error(`[世界引擎 3.0] 在處理地點「${locationName}」時發生錯誤:`, error);
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
