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

const CURRENCY_ITEM_NAMES = new Set([
    '\u9280\u5169',
    '\u9ec3\u91d1',
    '\u91d1\u5e63',
    '\u9280\u5e63',
    '\u9285\u9322',
    '\u788e\u9280'
]);

function isCurrencyLikeItem(item) {
    if (!item || typeof item !== 'object') return false;
    const name = String(item.itemName || item.templateId || '').trim();
    const type = String(item.itemType || '').trim();
    const category = String(item.category || '').trim();
    if (CURRENCY_ITEM_NAMES.has(name)) return true;
    if (category === '\u8ca8\u5e63') return true;
    if (type === '\u8ca8\u5e63') return true;
    return /[\u91d1\u9280\u9322]/.test(name) && /(幣|兩|金|銀|錢)/.test(name);
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
            if (templateData.itemType === '武器' && templateData.weaponType === undefined) {
                console.warn(`[數據校驗] 物品「${itemName}」模板為武器，但缺少 weaponType，已自動修正為 null。`);
                templateData.weaponType = null;
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
        if (newTemplateData.itemType === '武器' && newTemplateData.weaponType === undefined) {
            console.warn(`[數據校驗] AI生成的武器「${itemName}」缺少 weaponType，已自動修正為 null。`);
            newTemplateData.weaponType = null;
        }

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

async function getInventoryState(userId) {
    const inventory = await getRawInventory(userId);
    let money = 0;
    const visibleItems = [];

    for (const item of inventory) {
        if (!item) continue;
        if (isCurrencyLikeItem(item)) {
            const itemName = String(item.itemName || item.templateId || '');
            const qty = Number(item.quantity || 0);
            if (itemName === '\u9280\u5169' && Number.isFinite(qty)) {
                money += Math.max(0, qty);
            }
            continue;
        }
        visibleItems.push(item);
    }

    const itemsString = visibleItems.length > 0
        ? visibleItems.map(item => `${item.itemName}${item.quantity > 1 ? `x${item.quantity}` : ''}`).join('、')
        : '無';

    return {
        inventory,
        itemsString,
        money,
        bulkScore: calculateBulkScore(inventory)
    };
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
                const [playerSkillDoc, latestPlayerProfileDoc] = await transaction.getAll(playerSkillDocRef, userDocRef);
                const latestPlayerProfile = latestPlayerProfileDoc.data();
                
                // 【核心修正】將 isNewlyAcquired 和 expChange 的邏輯分開並加固
                
                // 情況一：處理經驗值變化 (無論 isNewlyAcquired 是真是假)
                if (typeof skillChange.expChange === 'number' && skillChange.expChange > 0) {
                    if (!playerSkillDoc.exists) return; // 如果武學不存在，無法增加經驗
                    
                    const templateResult = await getOrGenerateSkillTemplate(skillChange.skillName);
                    if (!templateResult?.template) return;
                    
                    let { level = 0, exp = 0 } = playerSkillDoc.data();
                    const { max_level = 10 } = templateResult.template;

                    // 【核心修正】即使達到滿級，也允許經驗值繼續增加，只是不再升級
                    exp += skillChange.expChange;
                    let requiredExp = level * 100 + 100;

                    while (exp >= requiredExp && level < max_level) {
                        level++;
                        exp -= requiredExp;
                        levelUpEvents.push({ skillName: skillChange.skillName, levelUpTo: level });
                        requiredExp = level * 100 + 100;
                    }
                    transaction.update(playerSkillDocRef, { level, exp, lastPractice: admin.firestore.FieldValue.serverTimestamp() });
                }
                
                // 情況二：處理新學武學 (只有當武學真的不存在時才執行)
                else if (skillChange.isNewlyAcquired && !playerSkillDoc.exists) {
                    const templateResult = await getOrGenerateSkillTemplate(skillChange.skillName);
                    if (!templateResult || !templateResult.template) return;

                    if (templateResult.template.isCustom) {
                        const powerType = templateResult.template.power_type || 'none';
                        let maxPowerAchieved = 0;
                        
                        switch(powerType) {
                            case 'internal': maxPowerAchieved = latestPlayerProfile.maxInternalPowerAchieved || 0; break;
                            case 'external': maxPowerAchieved = latestPlayerProfile.maxExternalPowerAchieved || 0; break;
                            case 'lightness': maxPowerAchieved = latestPlayerProfile.maxLightnessAchieved || 0; break;
                            default: maxPowerAchieved = 0;
                        }

                        const createdSkillsCount = latestPlayerProfile.customSkillsCreated?.[powerType] || 0;
                        const totalCreatedSkills = Object.values(latestPlayerProfile.customSkillsCreated || {}).reduce((a, b) => a + b, 0);
                        const availableSlots = Math.floor(maxPowerAchieved / 100);

                        console.log(`[創功資格審查] 正在為「${skillChange.skillName}」進行判定...`);
                        console.log(`  - 功體 (power_type): ${powerType}, 歷史最高成就: ${maxPowerAchieved}, 資格槽位: ${availableSlots}, 已創數量: ${createdSkillsCount}`);

                        if (totalCreatedSkills >= 10) {
                            customSkillCreationResult = { success: false, reason: '你感覺腦中思緒壅塞，似乎再也無法容納更多的奇思妙想，此次自創武學失敗了。' };
                            return; 
                        }

                        if (createdSkillsCount >= availableSlots) {
                             let powerTypeName = '基礎';
                             if (powerType === 'internal') powerTypeName = '內功';
                             if (powerType === 'external') powerTypeName = '外功';
                             if (powerType === 'lightness') powerTypeName = '輕功';
                            customSkillCreationResult = { success: false, reason: `你的${powerTypeName}修為尚淺，根基不穩，無法支撐你創造出新的招式。` };
                            return;
                        }

                        transaction.update(userDocRef, { [`customSkillsCreated.${powerType}`]: admin.firestore.FieldValue.increment(1) });
                        customSkillCreationResult = { success: true };
                    }
                    
                    if (customSkillCreationResult === null || customSkillCreationResult.success) {
                        const playerSkillData = { level: skillChange.level || 0, exp: skillChange.exp || 0, lastPractice: admin.firestore.FieldValue.serverTimestamp() };
                        transaction.set(playerSkillDocRef, playerSkillData);
                    }
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
    getInventoryState,
    getRawNpcInventory,
    updateSkills,
    getPlayerSkills,
    calculateBulkScore
};
