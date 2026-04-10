// client/engine/stateManager.js
// 遊戲狀態更新管理器 — 取代後端的 stateUpdaters.js
// 負責將 AI 回傳的 roundData 應用到 IndexedDB

import clientDB from '../db/clientDB.js';
import {
    clamp, toFiniteNumber, normalizePowerChange, calculateBulkScore,
    MAX_POWER, deepClone, nextTimeOfDay, advanceDate, isCurrencyLikeItem
} from '../utils/gameUtils.js';

/**
 * 將 AI 回傳的 roundData 完整應用到本機資料庫
 * @param {string} profileId
 * @param {object} roundData - AI 回傳的遊戲資料
 * @param {object} options - 額外選項
 */
export async function applyAllChanges(profileId, roundData) {
    if (!roundData) return;

    const profile = await clientDB.profiles.get(profileId);
    if (!profile) throw new Error(`找不到檔案: ${profileId}`);

    // 1. 更新功力
    const pc = normalizePowerChange(roundData.powerChange);
    const newInternal = clamp(toFiniteNumber(profile.internalPower) + pc.internal, 0, MAX_POWER);
    const newExternal = clamp(toFiniteNumber(profile.externalPower) + pc.external, 0, MAX_POWER);
    const newLightness = clamp(toFiniteNumber(profile.lightness) + pc.lightness, 0, MAX_POWER);

    // 2. 更新善惡值
    const newMorality = clamp(toFiniteNumber(profile.morality) + toFiniteNumber(roundData.moralityChange), -100, 100);

    // 3. 更新體力
    let newStamina = toFiniteNumber(roundData.stamina, profile.stamina);
    newStamina = clamp(newStamina, 0, 100);

    // 4. 處理時間推進
    let timeOfDay = roundData.timeOfDay || profile.timeOfDay || '上午';
    let dateData = {
        yearName: roundData.yearName || profile.yearName || '元祐',
        year: toFiniteNumber(roundData.year, profile.year),
        month: toFiniteNumber(roundData.month, profile.month),
        day: toFiniteNumber(roundData.day, profile.day)
    };

    if (roundData.daysToAdvance > 0) {
        dateData = advanceDate(dateData, roundData.daysToAdvance);
    }

    // 5. 處理物品變動
    if (roundData.itemChanges && Array.isArray(roundData.itemChanges)) {
        await applyItemChanges(profileId, roundData.itemChanges);
    }

    // 6. 處理技能變動
    if (roundData.skillChanges && Array.isArray(roundData.skillChanges)) {
        await applySkillChanges(profileId, roundData.skillChanges);
    }

    // 7. 處理 NPC 更新
    if (roundData.NPC && Array.isArray(roundData.NPC)) {
        await applyNpcUpdates(profileId, roundData.NPC);
    }

    // 8. 處理戀愛值變動
    if (roundData.romanceChanges && Array.isArray(roundData.romanceChanges)) {
        await applyRomanceChanges(profileId, roundData.romanceChanges);
    }

    // 9. 更新後重新計算負重
    const updatedInventory = await clientDB.inventory.list(profileId);
    const newBulkScore = calculateBulkScore(updatedInventory);

    // 10. 更新玩家檔案
    const profileUpdates = {
        internalPower: newInternal,
        externalPower: newExternal,
        lightness: newLightness,
        morality: newMorality,
        stamina: newStamina,
        bulkScore: newBulkScore,
        timeOfDay,
        ...dateData,
        maxInternalPowerAchieved: Math.max(toFiniteNumber(profile.maxInternalPowerAchieved), newInternal),
        maxExternalPowerAchieved: Math.max(toFiniteNumber(profile.maxExternalPowerAchieved), newExternal),
        maxLightnessAchieved: Math.max(toFiniteNumber(profile.maxLightnessAchieved), newLightness),
    };

    if (roundData.playerState === 'dead') {
        profileUpdates.isDeceased = true;
    }

    await clientDB.profiles.update(profileId, profileUpdates);

    // 11. 儲存回合
    const saveData = {
        ...roundData,
        internalPower: newInternal,
        externalPower: newExternal,
        lightness: newLightness,
        morality: newMorality,
        stamina: newStamina,
        bulkScore: newBulkScore,
        timeOfDay,
        ...dateData
    };
    await clientDB.saves.add(profileId, saveData);

    // 12. 更新小說章節
    if (roundData.story) {
        await clientDB.novel.addChapter(profileId, roundData.R, roundData.story);
    }

    return {
        profile: await clientDB.profiles.get(profileId),
        inventory: updatedInventory,
        bulkScore: newBulkScore
    };
}

/**
 * 處理物品變動
 */
async function applyItemChanges(profileId, itemChanges) {
    for (const change of itemChanges) {
        const action = change.action || 'add';
        const itemName = change.itemName;
        const quantity = toFiniteNumber(change.quantity, 1);

        if (action === 'add') {
            // 查找是否已有同名物品
            const existing = await findItemByName(profileId, itemName);
            if (existing && (isCurrencyLikeItem(existing) || existing.itemType === '消耗品')) {
                // 可堆疊物品：增加數量
                await clientDB.inventory.update(profileId, existing.instanceId, {
                    quantity: toFiniteNumber(existing.quantity) + quantity
                });
            } else {
                // 新物品
                await clientDB.inventory.add(profileId, {
                    itemName,
                    templateId: change.templateId || itemName,
                    quantity,
                    itemType: change.itemType || '雜物',
                    category: change.category || '',
                    bulk: change.bulk || '中',
                    baseDescription: change.baseDescription || '',
                    value: change.value || 0,
                    stats: change.stats || null,
                    isEquipped: false,
                    equipSlot: null
                });
            }
        } else if (action === 'remove' || action === 'remove_all') {
            const existing = await findItemByName(profileId, itemName);
            if (existing) {
                if (action === 'remove_all' || toFiniteNumber(existing.quantity) <= quantity) {
                    await clientDB.inventory.remove(profileId, existing.instanceId);
                } else {
                    await clientDB.inventory.update(profileId, existing.instanceId, {
                        quantity: toFiniteNumber(existing.quantity) - quantity
                    });
                }
            }
        }
    }
}

async function findItemByName(profileId, itemName) {
    const all = await clientDB.inventory.list(profileId);
    return all.find(item => item.itemName === itemName || item.templateId === itemName) || null;
}

/**
 * 處理技能變動
 */
async function applySkillChanges(profileId, skillChanges) {
    for (const change of skillChanges) {
        const skillName = change.skillName;
        const existing = await clientDB.skills.get(profileId, skillName);

        if (existing) {
            const updates = {};
            if (change.exp !== undefined) updates.exp = toFiniteNumber(change.exp);
            if (change.expChange) updates.exp = toFiniteNumber(existing.exp) + toFiniteNumber(change.expChange);
            if (change.level !== undefined) updates.level = toFiniteNumber(change.level);
            if (Object.keys(updates).length > 0) {
                await clientDB.skills.update(profileId, skillName, updates);
            }
        } else if (change.isNewlyAcquired) {
            await clientDB.skills.add(profileId, {
                skillName,
                level: toFiniteNumber(change.level, 0),
                exp: toFiniteNumber(change.exp, 0),
                power_type: change.power_type || 'external',
                combatCategory: change.combatCategory || 'attack',
                base_description: change.base_description || '',
                isCustom: change.isCustom || false,
                skillType: change.skillType || ''
            });
        }
    }
}

/**
 * 處理 NPC 更新
 */
async function applyNpcUpdates(profileId, npcList) {
    for (const npc of npcList) {
        if (!npc.name) continue;
        const existing = await clientDB.npcs.getState(profileId, npc.name);

        const updates = {};
        if (npc.friendlinessChange) {
            const currentVal = toFiniteNumber(existing?.friendlinessValue, 0);
            updates.friendlinessValue = clamp(currentVal + toFiniteNumber(npc.friendlinessChange), -100, 100);
        }
        if (npc.isDeceased) {
            updates.isDeceased = true;
        }
        if (npc.status) {
            updates.lastKnownStatus = npc.status;
        }

        if (existing) {
            if (Object.keys(updates).length > 0) {
                await clientDB.npcs.setState(profileId, npc.name, { ...existing, ...updates });
            }
        } else if (npc.isNew) {
            await clientDB.npcs.setState(profileId, npc.name, {
                friendlinessValue: toFiniteNumber(npc.friendlinessChange, 0),
                romanceValue: 0,
                interactionSummary: '',
                isDeceased: false,
                ...updates
            });
        }
    }
}

/**
 * 處理戀愛值變動
 */
async function applyRomanceChanges(profileId, romanceChanges) {
    for (const change of romanceChanges) {
        if (!change.npcName) continue;
        const existing = await clientDB.npcs.getState(profileId, change.npcName);
        if (existing) {
            const newVal = clamp(toFiniteNumber(existing.romanceValue) + toFiniteNumber(change.romanceChange), 0, 100);
            await clientDB.npcs.setState(profileId, change.npcName, {
                ...existing, romanceValue: newVal
            });
        }
    }
}
