// client/engine/contextBuilder.js
// 客戶端版的遊戲上下文組裝器 — 從 IndexedDB 讀取所有資料，組裝成 AI Proxy 需要的 context

import clientDB from '../db/clientDB.js';
import { calculateBulkScore, toSafeNumber, deepClone, deepMergeObjects } from '../utils/gameUtils.js';

/**
 * 組裝完整的遊戲上下文，供 AI Proxy 使用
 * @param {string} profileId - 玩家檔案 ID
 * @returns {Promise<object>} 完整的遊戲上下文
 */
export async function buildContext(profileId) {
    const [
        profile,
        recentSaves,
        skillsList,
        inventoryList,
        summaryData,
        npcStates,
    ] = await Promise.all([
        clientDB.profiles.get(profileId),
        clientDB.saves.getRecent(profileId, 3),
        clientDB.skills.list(profileId),
        clientDB.inventory.list(profileId),
        clientDB.state.get(profileId, 'summary'),
        clientDB.npcs.listStates(profileId),
    ]);

    if (!profile) throw new Error(`找不到玩家檔案: ${profileId}`);

    const lastSave = recentSaves.length > 0 ? recentSaves[recentSaves.length - 1] : null;
    const totalBulkScore = calculateBulkScore(inventoryList);

    // 組裝 NPC 上下文
    const npcContext = {};
    if (lastSave?.NPC && Array.isArray(lastSave.NPC)) {
        for (const npcInScene of lastSave.NPC) {
            const name = npcInScene.name;
            const template = await clientDB.npcs.getTemplate(name);
            const state = npcStates.find(s => s.npcName === name);
            if (template || state) {
                npcContext[name] = {
                    ...(template || {}),
                    ...(state || {}),
                    name,
                    friendlinessValue: state?.friendlinessValue ?? 0,
                    romanceValue: state?.romanceValue ?? 0,
                    interactionSummary: state?.interactionSummary || ''
                };
            } else {
                npcContext[name] = { name, ...npcInScene };
            }
        }
    }

    // 組裝地點上下文
    let locationContext = null;
    if (lastSave?.LOC) {
        const locName = Array.isArray(lastSave.LOC) ? lastSave.LOC[lastSave.LOC.length - 1] : lastSave.LOC;
        const staticLoc = await clientDB.locations.getTemplate(locName);
        const dynamicLoc = await clientDB.locations.getState(profileId, locName);
        if (staticLoc && dynamicLoc) {
            locationContext = deepMergeObjects(staticLoc, dynamicLoc);
        } else {
            locationContext = staticLoc || dynamicLoc || { locationName: locName };
        }
    }

    // 組裝玩家上下文
    const playerContext = {
        ...profile,
        R: lastSave?.R || 0,
        skills: skillsList,
        inventory: inventoryList,
        currentLocation: lastSave?.LOC || [],
        stamina: toSafeNumber(profile.stamina, 100),
        morality: toSafeNumber(profile.morality, 0),
        power: {
            internal: toSafeNumber(profile.internalPower, 5),
            external: toSafeNumber(profile.externalPower, 5),
            lightness: toSafeNumber(profile.lightness, 5)
        },
        currentDate: {
            yearName: profile.yearName || '元祐',
            year: toSafeNumber(profile.year, 1),
            month: toSafeNumber(profile.month, 1),
            day: toSafeNumber(profile.day, 1)
        },
        currentTimeOfDay: profile.timeOfDay || '上午'
    };

    return {
        player: playerContext,
        longTermSummary: summaryData?.text || summaryData || '遊戲剛剛開始...',
        recentHistory: recentSaves,
        locationContext,
        npcContext,
        bulkScore: totalBulkScore,
        isNewGame: !lastSave
    };
}

/**
 * 組裝精簡版上下文（用於非故事性 AI 任務，減少 payload）
 */
export async function buildLightContext(profileId) {
    const profile = await clientDB.profiles.get(profileId);
    const lastSave = await clientDB.saves.getLatest(profileId);
    const summary = await clientDB.state.get(profileId, 'summary');
    return {
        username: profile?.username || '無名俠客',
        profileId,
        lastRound: lastSave?.R || 0,
        summary: summary?.text || summary || '',
        player: {
            internalPower: profile?.internalPower || 5,
            externalPower: profile?.externalPower || 5,
            lightness: profile?.lightness || 5,
            morality: profile?.morality || 0,
            stamina: profile?.stamina || 100
        }
    };
}
