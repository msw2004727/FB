// client/engine/contextBuilder.js
// 客戶端版的遊戲上下文組裝器 — 精簡版
// 從 IndexedDB 讀取資料，組裝成 AI Proxy 需要的 context

import clientDB from '../db/clientDB.js';
import { toSafeNumber, deepMergeObjects } from '../utils/gameUtils.js';

/**
 * 組裝完整的遊戲上下文，供 AI Proxy 使用
 */
export async function buildContext(profileId) {
    // 先取 profile 和 summary，再根據回合數決定 recentHistory 數量
    const [profile, summaryData] = await Promise.all([
        clientDB.profiles.get(profileId),
        clientDB.state.get(profileId, 'summary'),
    ]);

    if (!profile) throw new Error(`找不到玩家檔案: ${profileId}`);

    // 動態回合數：前期多看、後期靠摘要+MemPalace
    const latestSave = await clientDB.saves.getLatest(profileId);
    const currentRound = latestSave?.R || 0;
    const recentCount = currentRound <= 5 ? Math.max(currentRound, 1) : (currentRound <= 20 ? 5 : 3);
    const storedRecentSaves = await clientDB.saves.getRecent(profileId, recentCount);
    // Old saves and provider output may contain null/non-object NPC entries.
    // Sanitize the context copy so one malformed historic round cannot prevent
    // every later paid turn from being built.
    const recentSaves = storedRecentSaves.map(save => ({
        ...save,
        NPC: Array.isArray(save?.NPC)
            ? save.NPC.filter(npc => npc && typeof npc === 'object' && !Array.isArray(npc))
            : [],
    }));

    const lastSave = recentSaves.length > 0 ? recentSaves[recentSaves.length - 1] : null;

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
        currentLocation: lastSave?.LOC || [],
        morality: toSafeNumber(profile.morality, 0),
        currentDate: {
            yearName: profile.yearName ?? '',
            year: toSafeNumber(profile.year, 1),
            month: toSafeNumber(profile.month, 1),
            day: toSafeNumber(profile.day, 1)
        },
        currentTimeOfDay: profile.timeOfDay || '上午',
        scenario: profile.scenario || 'wuxia'
    };

    // 從最近存檔組裝 NPC 上下文（名字、狀態、好感度）
    const npcContext = {};
    const knownActorNames = new Set();
    for (const save of recentSaves) {
        for (const npc of save.NPC) {
            const name = typeof npc?.name === 'string' ? npc.name.trim().slice(0, 60) : '';
            if (name) knownActorNames.add(name);
        }
    }
    const actorCandidates = [...knownActorNames];
    if (lastSave?.NPC && Array.isArray(lastSave.NPC)) {
        for (const npc of lastSave.NPC) {
            const name = typeof npc?.name === 'string' ? npc.name.trim().slice(0, 60) : '';
            if (name) {
                npcContext[name] = {
                    name,
                    status: npc.status || '',
                    friendliness: npc.friendliness || 'neutral',
                    friendlinessChange: npc.friendlinessChange || 0,
                    isNew: npc.isNew || false,
                    isDeceased: npc.isDeceased || false,
                };
            }
        }
    }

    return {
        player: playerContext,
        longTermSummary: String(summaryData?.text || summaryData || '遊戲剛剛開始...').slice(0, 2000),
        recentHistory: recentSaves,
        locationContext,
        npcContext,
        actorCandidates,
        currentRound: playerContext.R,
        isNewGame: !lastSave
    };
}

/**
 * 組裝精簡版上下文（用於非故事性 AI 任務）
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
            morality: profile?.morality || 0
        }
    };
}
