// api/worldEngine.js
const admin = require('firebase-admin');
const { getLocationGeneratorPrompt } = require('../prompts/locationGeneratorPrompt.js');
const { callAI, aiConfig } = require('../services/aiService');

const db = admin.firestore();

// 【核心新增】數據淨化與預設值填充函式
function sanitizeLocationData(template) {
    if (!template) return null;

    // 確保頂層屬性存在
    template.geography = template.geography || {};
    template.economy = template.economy || {};
    template.lore = template.lore || {};
    template.address = template.address || {};
    // 【核心修正】確保 governance 物件永遠存在，杜絕 undefined 錯誤
    template.governance = template.governance || {};

    // 為lore.history提供預設值，防止undefined
    if (!template.lore.history) {
        template.lore.history = "關於此地的由來，已淹沒在時間的長河中。";
    }
    
    return template;
}


function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (isPlainObject(value)) {
        const out = {};
        Object.entries(value).forEach(([key, nestedValue]) => {
            out[key] = cloneValue(nestedValue);
        });
        return out;
    }
    return value;
}

function deepMergeObjects(base, override) {
    const merged = isPlainObject(base) ? cloneValue(base) : {};
    if (!isPlainObject(override)) return merged;

    Object.entries(override).forEach(([key, value]) => {
        if (isPlainObject(merged[key]) && isPlainObject(value)) {
            merged[key] = deepMergeObjects(merged[key], value);
            return;
        }
        merged[key] = cloneValue(value);
    });

    return merged;
}

function sanitizeInitialDynamicState(initialDynamicState) {
    if (!isPlainObject(initialDynamicState)) return {};

    const sanitized = deepMergeObjects({}, initialDynamicState);
    sanitized.governance = isPlainObject(sanitized.governance) ? sanitized.governance : {};
    sanitized.economy = isPlainObject(sanitized.economy) ? sanitized.economy : {};
    sanitized.lore = isPlainObject(sanitized.lore) ? sanitized.lore : {};
    sanitized.facilities = Array.isArray(sanitized.facilities) ? sanitized.facilities : [];
    sanitized.buildings = Array.isArray(sanitized.buildings) ? sanitized.buildings : [];
    if (!Array.isArray(sanitized.lore.currentIssues)) sanitized.lore.currentIssues = [];
    return sanitized;
}

async function generateAndCacheLocation(userId, locationName, locationType = '未知', worldSummary = '江湖軼事無可考。', knownHierarchy = []) {
    if (!userId || !locationName) return;
    console.log(`[世界引擎 4.0] 收到為玩家 ${userId} 初始化地點「${locationName}」的請求...`);

    const staticLocationRef = db.collection('locations').doc(locationName);
    const dynamicLocationRef = db.collection('users').doc(userId).collection('location_states').doc(locationName);

    let generatedLocationMap = new Map();

    try {
        let staticDoc = await staticLocationRef.get();

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
                if (loc && typeof loc.locationName === 'string' && loc.locationName.trim()) {
                    generatedLocationMap.set(loc.locationName.trim(), loc);
                }
                const locRef = db.collection('locations').doc(loc.locationName);
                const docToCheck = await locRef.get();
                if (!docToCheck.exists) {
                    const sanitizedTemplate = sanitizeLocationData(loc.staticTemplate);
                    if (sanitizedTemplate) {
                        batch.set(locRef, sanitizedTemplate);
                        console.log(`[世界引擎 4.0] 已將淨化後的新地點「${loc.locationName}」的全局模板加入批次創建佇列。`);
                    }
                }
            }
            
            await batch.commit();
            console.log(`[世界引擎 4.0] 成功批次創建地點層級的全局模板。`);

            staticDoc = await staticLocationRef.get(); 
        } else {
             console.log(`[世界引擎 4.0] 地點「${locationName}」的全局模板已存在，跳過AI生成。`);
        }

        const dynamicDoc = await dynamicLocationRef.get();
        if (!dynamicDoc.exists) {
            console.log(`[世界引擎 4.0] 玩家 ${userId} 的個人地點狀態「${locationName}」不存在，正在為其初始化...`);
            
            const staticData = staticDoc.data(); 

            const defaultInitialDynamicData = {
                governance: { ruler: staticData.governance?.ruler || 'unknown', allegiance: staticData.governance?.allegiance || 'unknown', security: 'stable' },
                economy: { currentProsperity: 'stable' },
                facilities: staticData.facilities || [],
                buildings: staticData.buildings || [],
                lore: { currentIssues: ['No notable issues.'] }
            };
            const generatedLocationSeed = generatedLocationMap.get(String(locationName).trim());
            const aiInitialDynamicData = sanitizeInitialDynamicState(generatedLocationSeed?.initialDynamicState);
            const initialDynamicData = deepMergeObjects(defaultInitialDynamicData, aiInitialDynamicData);

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
