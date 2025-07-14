// api/playerStateHelpers.js
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const { callAI, aiConfig } = require('../services/aiService');
const { getItemGeneratorPrompt } = require('../prompts/itemGeneratorPrompt.js');
const { getSkillGeneratorPrompt } = require('../prompts/skillGeneratorPrompt.js');

const db = admin.firestore();
const skillTemplateCache = new Map();

const BULK_TO_SCORE_MAP = { '輕': 0, '中': 2, '重': 5, '極重': 10 };

function calculateBulkScore(inventoryList) {
    if (!Array.isArray(inventoryList)) return 0;
    return inventoryList.reduce((score, item) => {
        const quantity = item.quantity || 1;
        const bulkValue = item.bulk || '中';
        return score + (BULK_TO_SCORE_MAP[bulkValue] || 0) * quantity;
    }, 0);
}


async function getOrGenerateItemTemplate(itemName, roundData = {}) {
    if (!itemName) return null;
    const templateRef = db.collection('items').doc(itemName);
    try {
        const doc = await templateRef.get();
        if (doc.exists) {
            let templateData = doc.data();
            let needsUpdate = false;
            
            if (templateData.bulk === undefined) {
                templateData.bulk = '中'; 
                needsUpdate = true;
            }
            if (templateData.equipSlot === undefined) {
                templateData.equipSlot = null;
                needsUpdate = true;
            }
            if (templateData.hands === undefined) {
                templateData.hands = null;
                needsUpdate = true;
            }

            if(needsUpdate) {
                await templateRef.set(templateData, { merge: true });
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
        
        if (newTemplateData.bulk === undefined) newTemplateData.bulk = '中';
        if (newTemplateData.equipSlot === undefined) newTemplateData.equipSlot = null;
        if (newTemplateData.hands === undefined) newTemplateData.hands = null;

        newTemplateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        await templateRef.set(newTemplateData);
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
            }
            if (templateData.combatCategory === undefined) {
                templateData.combatCategory = '攻擊';
                needsUpdate = true;
            }
            
            if (templateData.requiredWeaponType === undefined) {
                templateData.requiredWeaponType = '無';
                needsUpdate = true;
            }
            
            if (needsUpdate) {
                await skillTemplateRef.set(templateData, { merge: true });
            }

            skillTemplateCache.set(skillName, templateData);
            return { template: templateData, isNew: false };
        }

        console.log(`[武學總綱] 武學「${skillName}」的總綱不存在，啟動AI生成...`);
        const prompt = getSkillGeneratorPrompt(skillName);
        const skillJsonString = await callAI(aiConfig.skillTemplate || 'openai', prompt, true);
        const newTemplateData = JSON.parse(skillJsonString);
        if (!newTemplateData.skillName) throw new Error('AI生成的武學模板缺少skillName。');
        
        if (newTemplateData.requiredWeaponType === undefined) {
             newTemplateData.requiredWeaponType = '無';
        }
        
        newTemplateData.isCustom = true;
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
            const newItemData = {
                templateId: itemName,
                isEquipped: false,
                equipSlot: null, 
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            };
            if (isStackable || template.itemName === '銀兩') {
                batch.set(userInventoryRef.doc(itemName), {
                    ...newItemData,
                    quantity: admin.firestore.FieldValue.increment(quantity)
                }, { merge: true });
            } else {
                for (let i = 0; i < quantity; i++) {
                    batch.set(userInventoryRef.doc(uuidv4()), newItemData);
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
}

async function getRawInventory(userId) {
    const playerInventoryRef = db.collection('users').doc(userId).collection('inventory_items');
    const snapshot = await playerInventoryRef.get();
    if (snapshot.empty) return [];

    const itemPromises = snapshot.docs.map(async (doc) => {
        const instanceData = doc.data();
        const templateId = instanceData.templateId;
        if (!templateId) return null;

        const templateDataResult = await getOrGenerateItemTemplate(templateId);
        if (templateDataResult?.template) {
            const templateData = templateDataResult.template;
            return {
                ...templateData, 
                ...instanceData,  
                instanceId: doc.id,
                itemName: templateData.itemName, 
            };
        }
        return null;
    });
    
    const results = await Promise.all(itemPromises);
    return results.filter(item => item !== null);
}

async function getRawNpcInventory(npcProfile) {
    if (!npcProfile) return [];

    const allItems = [];
    const itemPromises = [];

    if (npcProfile.inventory && typeof npcProfile.inventory === 'object') {
        for (const [itemName, quantity] of Object.entries(npcProfile.inventory)) {
            if (quantity > 0) {
                 itemPromises.push(
                    getOrGenerateItemTemplate(itemName).then(res => {
                        if (res?.template) {
                            allItems.push({
                                ...res.template,
                                itemName: res.template.itemName || itemName,
                                quantity: quantity,
                                instanceId: itemName,
                                isEquipped: false
                            });
                        }
                    })
                );
            }
        }
    }
    
    if (npcProfile.equipment && Array.isArray(npcProfile.equipment)) {
         for (const equip of npcProfile.equipment) {
            if (equip.templateId) {
                itemPromises.push(
                    getOrGenerateItemTemplate(equip.templateId).then(res => {
                        if (res?.template) {
                            allItems.push({
                                ...res.template,
                                ...equip,
                                itemName: res.template.itemName || equip.templateId,
                                quantity: 1,
                                isEquipped: true
                            });
                        }
                    })
                );
            }
        }
    }
    
    await Promise.all(itemPromises);
    return allItems;
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
                    const templateResult = await getOrGenerateSkillTemplate(skillChange.skillName);
                    if (!templateResult || !templateResult.template) return;

                    if (templateResult.template.isCustom) {
                        const powerType = templateResult.template.power_type || 'none';
                        const maxPowerAchieved = latestPlayerProfile[`max${powerType.charAt(0).toUpperCase() + powerType.slice(1)}PowerAchieved`] || 0;
                        const createdSkillsCount = latestPlayerProfile.customSkillsCreated?.[powerType] || 0;
                        const totalCreatedSkills = Object.values(latestPlayerProfile.customSkillsCreated || {}).reduce((a, b) => a + b, 0);
                        const availableSlots = Math.floor(maxPowerAchieved / 100);

                        // --- 【真言鏡】植入開始 ---
                        console.log(`[創功資格審查] 正在為「${skillChange.skillName}」進行判定...`);
                        console.log(`  - 功體 (power_type): ${powerType}`);
                        console.log(`  - 功體歷史最高成就 (maxPowerAchieved): ${maxPowerAchieved}`);
                        console.log(`  - 計算出的資格槽位 (availableSlots): ${availableSlots}`);
                        console.log(`  - 已創的同類武學數量 (createdSkillsCount): ${createdSkillsCount}`);
                        console.log(`  - 總自創武學數量 (totalCreatedSkills): ${totalCreatedSkills}`);
                        console.log(`  - 判定條件: (${createdSkillsCount} >= ${availableSlots})`);
                        // --- 【真言鏡】植入結束 ---

                        if (totalCreatedSkills >= 10) {
                            customSkillCreationResult = { success: false, reason: '你感覺腦中思緒壅塞，似乎再也無法容納更多的奇思妙想，此次自創武學失敗了。' };
                            return; 
                        }

                        if (createdSkillsCount >= availableSlots) {
                            customSkillCreationResult = { success: false, reason: `你的${powerType === 'internal' ? '內功' : powerType === 'external' ? '外功' : powerType === 'lightness' ? '輕功' : '基礎'}修為尚淺，根基不穩，無法支撐你創造出新的招式。` };
                            return;
                        }

                        transaction.update(userDocRef, { [`customSkillsCreated.${powerType}`]: admin.firestore.FieldValue.increment(1) });
                        customSkillCreationResult = { success: true };
                    }
                    
                    if (customSkillCreationResult === null || customSkillCreationResult.success) {
                        const playerSkillData = { level: skillChange.level || 0, exp: skillChange.exp || 0, lastPractice: admin.firestore.FieldValue.serverTimestamp() };
                        transaction.set(playerSkillDocRef, playerSkillData);
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
    getRawInventory,
    getRawNpcInventory,
    updateSkills,
    getPlayerSkills,
    calculateBulkScore
};
