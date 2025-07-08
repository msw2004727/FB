// api/worldEngine.js
const admin = require('firebase-admin');
const { getBountyGeneratorPrompt } = require('../prompts/bountyGeneratorPrompt.js');
const { getLocationGeneratorPrompt } = require('../prompts/locationGeneratorPrompt.js'); 
const { callAI } = require('../services/aiService');

const db = admin.firestore();

/**
 * 【核心修改】採納新的混合式架構，同時生成共享的靜態模板和玩家專屬的動態狀態。
 * @param {string} userId - 玩家的ID.
 * @param {string} locationName - 新地點的名稱.
 * @param {string} locationType - 新地點的類型.
 * @param {string} worldSummary - 當前世界的長期故事摘要.
 */
async function generateAndCacheLocation(userId, locationName, locationType = '未知', worldSummary = '江湖軼事無可考。') {
    if (!userId || !locationName) return;
    console.log(`[世界引擎-混合模式] 收到為玩家 ${userId} 初始化地點 ${locationName} 的請求...`);

    // 定義兩個儲存位置
    const staticLocationRef = db.collection('locations').doc(locationName); // 全域共享的靜態模板
    const dynamicLocationRef = db.collection('users').doc(userId).collection('location_states').doc(locationName); // 玩家專屬的動態狀態

    try {
        // 檢查靜態模板是否已存在，如果已存在，則不需再讓AI生成
        const staticDoc = await staticLocationRef.get();
        if (staticDoc.exists) {
            console.log(`[世界引擎-混合模式] 地點「${locationName}」的共享模板已存在，跳過AI生成。`);
        } else {
            // 只有在共享模板不存在時，才呼叫AI進行創造
            console.log(`[世界引擎-混合模式] 為「${locationName}」啟動共享模板生成程序...`);
            const prompt = getLocationGeneratorPrompt(locationName, locationType, worldSummary);
            const locationJsonString = await callAI('deepseek', prompt, true);
            const newLocationData = JSON.parse(locationJsonString);

            if (!newLocationData.locationId || !newLocationData.description) {
                throw new Error("AI生成的地點資料不完整。");
            }
            
            // 將AI生成的完整資料拆分成兩部分
            const staticData = {
                locationId: newLocationData.locationId,
                locationName: newLocationData.locationName,
                locationType: newLocationData.locationType,
                description: newLocationData.description,
                geography: newLocationData.geography,
                "lore.history": newLocationData.lore.history // 只儲存靜態的歷史
            };
            
            const dynamicData = {
                governance: newLocationData.governance,
                economy: newLocationData.economy,
                demographics: newLocationData.demographics,
                resources: newLocationData.resources,
                infrastructure: newLocationData.infrastructure,
                "lore.currentIssues": newLocationData.lore.currentIssues // 只儲存動態的當前問題
            };

            // 使用一個 "batch" 寫入，確保兩個檔案要嘛都成功，要嘛都失敗，保證資料一致性
            const batch = db.batch();
            batch.set(staticLocationRef, staticData);
            batch.set(dynamicLocationRef, dynamicData);
            await batch.commit();

            console.log(`[世界引擎-混合模式] 成功為「${locationName}」建立共享模板，並為玩家 ${userId} 初始化了動態狀態。`);
            return; // 已完成，直接返回
        }

        // 如果共享模板已存在，我們只需要檢查是否需要為當前玩家初始化動態狀態
        const dynamicDoc = await dynamicLocationRef.get();
        if (!dynamicDoc.exists) {
            console.log(`[世界引擎-混合模式] 模板已存在，但玩家 ${userId} 尚未初始化，正在為其建立動態狀態...`);
            // 從靜態模板中提取預設的動態部分來初始化
            const staticData = staticDoc.data();
            const initialDynamicData = {
                governance: staticData.governance || { ruler: '未知', allegiance: '獨立', security: '普通' },
                economy: staticData.economy || { prosperity: '普通', primaryIndustry: ['農業'], specialty: ['無'], taxRevenue: 1000 },
                demographics: staticData.demographics || { population: 100, populationComposition: '成分不明' },
                resources: staticData.resources || { manpower: 20, food: '足夠', materials: '普通' },
                infrastructure: staticData.infrastructure || { buildings: ['民居', '農田'] },
                "lore.currentIssues": staticData.lore.currentIssues || ['暫無江湖傳聞']
            };
            await dynamicLocationRef.set(initialDynamicData);
            console.log(`[世界引擎-混合模式] 成功為玩家 ${userId} 初始化了「${locationName}」的動態狀態。`);
        }

    } catch (error) {
        console.error(`[世界引擎-混合模式] 在處理地點「${locationName}」時發生錯誤:`, error);
    }
}


/**
 * 【核心修改】根據詳細的玩家情境，觸發一次新的懸賞生成。
 * @param {string} userId - 玩家的ID
 * @param {string} longTermSummary - 長期故事摘要
 */
async function triggerBountyGeneration(userId, longTermSummary) {
    console.log(`[世界引擎] 正在為玩家 ${userId} 嘗試生成新的懸賞...`);
    
    try {
        const userDocRef = db.collection('users').doc(userId);
        
        // 【核心修改】並行獲取生成懸賞所需的所有情境資料
        const [npcsSnapshot, lastSaveSnapshot] = await Promise.all([
            userDocRef.collection('npcs').get(),
            userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get()
        ]);

        if (lastSaveSnapshot.empty) {
            console.warn(`[世界引擎] 找不到玩家 ${userId} 的最新存檔，無法生成懸賞。`);
            return;
        }

        const npcDetails = npcsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                name: data.name,
                background: data.background || '背景不詳'
            };
        });

        const playerLocation = lastSaveSnapshot.docs[0].data().LOC[0] || '未知之地';

        const playerContext = {
            longTermSummary,
            npcDetails,
            playerLocation
        };

        const prompt = getBountyGeneratorPrompt(playerContext);
        const bountyJsonString = await callAI('deepseek', prompt, true); 
        const newBountyData = JSON.parse(bountyJsonString);

        if (!newBountyData.title || !newBountyData.content) {
            console.log(`[世界引擎] AI生成的懸賞資料不完整，本次跳過。`);
            return;
        }

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
