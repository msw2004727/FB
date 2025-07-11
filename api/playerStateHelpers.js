// api/playerStateHelpers.js
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const { callAI, aiConfig } = require('../services/aiService');
const { getItemGeneratorPrompt } = require('../prompts/itemGeneratorPrompt.js');
const { getSkillGeneratorPrompt } = require('../prompts/skillGeneratorPrompt.js');

const db = admin.firestore();
const skillTemplateCache = new Map();

async function getOrGenerateItemTemplate(itemName, roundData = {}) {
    if (!itemName) return null;
    const templateRef = db.collection('items').doc(itemName);
    try {
        const doc = await templateRef.get();
        if (doc.exists) {
            let templateData = doc.data();
            // 【核心修正】為舊物品自動修補bulk欄位
            if (templateData.bulk === undefined) {
                templateData.bulk = '中'; // 給予一個合理的預設值
                await templateRef.set({ bulk: '中' }, { merge: true });
                console.log(`[資料庫維護] 物品「${itemName}」缺少 bulk 欄位，自動修補為 "中"。`);
            }
            return { template: templateData, isNew: false };
        }
        
        console.log(`[物品系統] 物品「${itemName}」的設計圖不存在，啟動AI生成...`);
        const playerLevel = (roundData.internalPower || 0) + (roundData.externalPower || 0) + (roundData.lightness || 0);
        const context = {
            location: roundData.LOC ? roundData.LOC[0] : '未知地點',
            sourceType: '劇情發展',
            sourceName: roundData.EVT || '未知事件',
            playerLevel: playerLevel
        };
        const prompt = getItemGeneratorPrompt(itemName, context);
        const itemJsonString = await callAI(aiConfig.itemTemplate || 'openai', prompt, true);
        const newTemplateData = JSON.parse(itemJsonString);

        if (!newTemplateData.itemName) throw new Error('AI生成的物品模板缺少itemName。');
        
        newTemplateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        await templateRef.set(newTemplateData);
        console.log(`[物品系統] 成功為「${itemName}」建立並儲存了設計圖。`);
        const newDoc = await templateRef.get();
        return { template: newDoc.data(), isNew: true };
    } catch (error) {
        console.error(`[物品系統] 在處理物品「${itemName}」的設計圖時發生錯誤:`, error);
        return null;
    }
}

async function getOrGenerateSkillTemplate(skillName) {
    if (!skillName) return null;
    if (skillTemplateCache.has(skillName)) {
        return { template: skillTemplateCache.get(skillName), isNew: false };
    }
    const skillTemplateRef = db.collection('skills').doc(skillName);
    try {
        const doc = await skillTemplateRef.get();
        if (doc.exists) {
            let templateData = doc.data();
            let needsUpdate = false;

            if (templateData.cost === undefined) {
                templateData.cost = 10;
                needsUpdate = true;
                console.log(`[資料庫維護] 武學「${skillName}」缺少 cost 欄位，自動修補為 10。`);
            }
            if (templateData.combatCategory === undefined) {
                templateData.combatCategory = (templateData.skillType === '醫術' || templateData.skillType === '治癒') ? '治癒' : '攻擊';
                needsUpdate = true;
                console.log(`[資料庫維護] 武學「${skillName}」缺少 combatCategory 欄位，自動修補為 ${templateData.combatCategory}。`);
            }
            
            if (needsUpdate) {
                await skillTemplateRef.set(templateData, { merge: true });
                console.log(`[資料庫維護] 已成功將武學「${skillName}」的模板更新至最新結構。`);
            }

            skillTemplateCache.set(skillName, templateData);
            return { template: templateData, isNew: false };
        }

        console.log(`[武學總綱] 武學「${skillName}」的總綱不存在，啟動AI生成...`);
        const prompt = getSkillGeneratorPrompt(skillName);
        const skillJsonString = await callAI(aiConfig.skillTemplate || 'openai', prompt, true);
        const newTemplateData = JSON.parse(skillJsonString);
        if (!newTemplateData.skillName) throw new Error('AI生成的武學模板缺少skillName。');
        newTemplateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        await skillTemplateRef.set(newTemplateData);
        const finalTemplateData = (await skillTemplateRef.get()).data();
        skillTemplateCache.set(skillName, finalTemplateData);
        console.log(`[武學總綱] 成功為「${skillName}」建立並儲存了總綱模板。`);
        return { template: finalTemplateData, isNew: true };
    } catch (error) {
        console.error(`[武學總綱] 在處理武學「${skillName}」的總綱時發生錯誤:`, error);
        return null;
    }
}

async function updateInventory(userId, itemChanges, roundData = {}) {
    if (!itemChanges || itemChanges.length === 0) return;
    const userInventoryRef = db.collection('users').doc(userId).collection('inventory_items');
    const batch = db.batch();
    const uniqueItemNames = [...new Set(itemChanges.map(c => c.itemName).filter(Boolean))];
    const templateResults = await Promise.all(uniqueItemNames.map(name => getOrGenerateItemTemplate(name, roundData)));
    const templates = new Map(uniqueItemNames.map((name, index) => [name, templateResults[index]?.template]));

    for (const change of itemChanges) {
        const { action, itemName, quantity = 1 } = change;
        if (!itemName || !templates.has(itemName)) continue;

        const template = templates.get(itemName);
        const isStackable = ['材料', '財寶', '道具', '其他', '秘笈', '書籍'].includes(template.itemType);

        if (action === 'add') {
            if (isStackable) {
                batch.set(userInventoryRef.doc(itemName), {
                    templateId: itemName,
                    quantity: admin.firestore.FieldValue.increment(quantity)
                }, { merge: true });
            } else {
                for (let i = 0; i < quantity; i++) {
                    batch.set(userInventoryRef.doc(uuidv4()), { templateId: itemName, createdAt: admin.firestore.FieldValue.serverTimestamp() });
                }
            }
        } else if (action === 'remove') {
            const docRef = userInventoryRef.doc(itemName);
            const doc = await docRef.get(); 
            if (isStackable && doc.exists && doc.data().quantity > quantity) {
                batch.update(docRef, { quantity: admin.firestore.FieldValue.increment(-quantity) });
            } else {
                batch.delete(docRef);
            }
        }
    }
    await batch.commit();
    console.log(`[物品系統] 已為玩家 ${userId} 完成批次庫存更新。`);
}

async function getInventoryState(userId) {
    const playerInventoryRef = db.collection('users').doc(userId).collection('inventory_items');
    const snapshot = await playerInventoryRef.get();
    if (snapshot.empty) return { money: 0, itemsString: '身無長物' };
    let money = 0;
    const itemCounts = {};
    for(const doc of snapshot.docs){
        const item = doc.data();
        const itemName = item.templateId;
        if (itemName === '銀兩' || itemName === '賞金') {
            money += item.quantity || 0;
        } else {
            itemCounts[itemName] = (itemCounts[itemName] || 0) + (item.quantity || 1);
        }
    }
    const otherItems = Object.entries(itemCounts).map(([name, count]) => `${name} x${count}`);
    return { money, itemsString: otherItems.length > 0 ? otherItems.join('、') : '身無長物' };
}

async function getRawInventory(userId) {
    const playerInventoryRef = db.collection('users').doc(userId).collection('inventory_items');
    const snapshot = await playerInventoryRef.get();
    if (snapshot.empty) return {};
    const inventoryData = {};
    for (const doc of snapshot.docs) {
        const playerData = doc.data();
        const templateId = playerData.templateId;
        if (!templateId) continue;
        const templateDataResult = await getOrGenerateItemTemplate(templateId);
        if (templateDataResult?.template) {
            inventoryData[doc.id] = { ...templateDataResult.template, ...playerData, instanceId: doc.id };
        }
    }
    return inventoryData;
}

async function updateSkills(userId, skillChanges, playerProfile) {
    if (!skillChanges || skillChanges.length === 0) return { levelUpEvents: [], customSkillCreationResult: null };
    const playerSkillsRef = db.collection('users').doc(userId).collection('skills');
    const userDocRef = db.collection('users').doc(userId);
    const levelUpEvents = [];
    let customSkillCreationResult = null;
    for (const skillChange of skillChanges) {
        const playerSkillDocRef = playerSkillsRef.doc(skillChange.skillName);
        try {
            await db.runTransaction(async (transaction) => {
                const latestPlayerProfile = (await transaction.get(userDocRef)).data();

                if (skillChange.isNewlyAcquired) {
                    const acquisitionMethod = skillChange.acquisitionMethod || 'created'; 

                    if (acquisitionMethod === 'created') {
                        const templateResult = await getOrGenerateSkillTemplate(skillChange.skillName);
                        if (!templateResult || !templateResult.template) {
                            console.error(`無法為「${skillChange.skillName}」獲取或生成模板，跳過。`);
                            return;
                        }

                        if (templateResult.isNew) {
                            const powerType = templateResult.template.power_type || 'none';
                            const maxPowerAchieved = latestPlayerProfile[`max${powerType.charAt(0).toUpperCase() + powerType.slice(1)}PowerAchieved`] || 0;
                            const createdSkillsCount = latestPlayerProfile.customSkillsCreated?.[powerType] || 0;
                            const totalCreatedSkills = Object.values(latestPlayerProfile.customSkillsCreated || {}).reduce((a, b) => a + b, 0);
                            const availableSlots = Math.floor(maxPowerAchieved / 100);

                            if (totalCreatedSkills >= 10) {
                                customSkillCreationResult = { success: false, reason: '你感覺腦中思緒壅塞，似乎再也無法容納更多的奇思妙想，此次自創武學失敗了。' };
                                return;
                            }

                            if (createdSkillsCount >= availableSlots) {
                                customSkillCreationResult = { success: false, reason: `你的${powerType === 'internal' ? '內功' : powerType === 'external' ? '外功' : '輕功'}修為尚淺，根基不穩，無法支撐你創造出新的招式。` };
                                return;
                            }

                            transaction.update(userDocRef, { [`customSkillsCreated.${powerType}`]: admin.firestore.FieldValue.increment(1) });
                            customSkillCreationResult = { success: true };
                        }
                    }
                    
                    if (customSkillCreationResult === null || customSkillCreationResult.success) {
                        const playerSkillData = { level: skillChange.level || 0, exp: skillChange.exp || 0, lastPractice: admin.firestore.FieldValue.serverTimestamp() };
                        transaction.set(playerSkillDocRef, playerSkillData);
                        console.log(`[武學系統] 玩家 ${userId} 習得新武學: ${skillChange.skillName}`);
                    }

                } else if (skillChange.expChange > 0) {
                    const playerSkillDoc = await transaction.get(playerSkillDocRef);
                    if (!playerSkillDoc.exists) return;
                    
                    const templateResult = await getOrGenerateSkillTemplate(skillChange.skillName);
                    if (!templateResult?.template) return;
                    
                    let { level = 0, exp = 0 } = playerSkillDoc.data();
                    const { max_level = 10 } = templateResult.template;

                    if (level >= max_level) return;

                    exp += skillChange.expChange;
                    let requiredExp = level * 100 + 100;

                    while (exp >= requiredExp && level < max_level) {
                        level++;
                        exp -= requiredExp;
                        levelUpEvents.push({ skillName: skillChange.skillName, levelUpTo: level });
                        requiredExp = level * 100 + 100;
                    }
                    transaction.update(playerSkillDocRef, { level, exp });
                    console.log(`[武學系統] 玩家 ${userId} 修練 ${skillChange.skillName}，熟練度增加 ${skillChange.expChange}。`);
                }
            });
        } catch (error) {
            console.error(`[武學系統] 更新武學 ${skillChange.skillName} 時發生錯誤:`, error);
        }
    }
    return { levelUpEvents, customSkillCreationResult };
}


async function getPlayerSkills(userId) {
    const playerSkillsRef = db.collection('users').doc(userId).collection('skills');
    const playerSkillsSnapshot = await playerSkillsRef.get();
    if (playerSkillsSnapshot.empty) return [];
    
    const skillPromises = playerSkillsSnapshot.docs.map(async (playerSkillDoc) => {
        const skillName = playerSkillDoc.id;
        const playerData = playerSkillDoc.data();
        const templateResult = await getOrGenerateSkillTemplate(skillName);
        if (templateResult?.template) {
            return { ...templateResult.template, ...playerData, skillName: templateResult.template.skillName || skillName };
        }
        return null;
    });

    const results = await Promise.all(skillPromises);
    return results.filter(skill => skill !== null);
}

module.exports = {
    getOrGenerateItemTemplate,
    getOrGenerateSkillTemplate,
    updateInventory,
    getInventoryState,
    getRawInventory,
    updateSkills,
    getPlayerSkills
};
