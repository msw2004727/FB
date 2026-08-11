// client/engine/stateManager.js
// 遊戲狀態更新管理器 — 精簡版
// 負責將 AI 回傳的 roundData 應用到 IndexedDB

import clientDB from '../db/clientDB.js';
import { clamp, toFiniteNumber, advanceDate } from '../utils/gameUtils.js';
import { runCleanup } from '../db/storageManager.js';

/**
 * 將 AI 回傳的 roundData 完整應用到本機資料庫
 */
export async function applyAllChanges(profileId, roundData, stateUpdates = {}) {
    if (!roundData) return;

    const profile = await clientDB.profiles.get(profileId);
    if (!profile) throw new Error(`找不到檔案: ${profileId}`);

    // 1. 更新善惡值
    const newMorality = clamp(
        toFiniteNumber(profile.morality) + toFiniteNumber(roundData.moralityChange),
        -100, 100
    );

    // 2. 處理時間推進
    let timeOfDay = roundData.timeOfDay || profile.timeOfDay || '上午';
    let dateData = {
        yearName: roundData.yearName || profile.yearName || '元祐',
        year: toFiniteNumber(roundData.year, profile.year),
        month: toFiniteNumber(roundData.month, profile.month),
        day: toFiniteNumber(roundData.day, profile.day)
    };

    const safeDaysToAdvance = typeof roundData.daysToAdvance === 'number' && Number.isFinite(roundData.daysToAdvance)
        ? clamp(Math.trunc(roundData.daysToAdvance), 0, 3650)
        : 0;
    if (safeDaysToAdvance > 0) {
        dateData = advanceDate(dateData, safeDaysToAdvance);
    }

    // 3. 更新玩家檔案
    const profileUpdates = {
        morality: newMorality,
        timeOfDay,
        ...dateData
    };

    if (roundData.playerState === 'dead') {
        profileUpdates.isDeceased = true;
    }

    // 4. 組合回合資料
    const saveData = {
        ...roundData,
        daysToAdvance: safeDaysToAdvance,
        morality: newMorality,
        timeOfDay,
        ...dateData
    };

    // 5. 原子提交 profile、save、chapter 與衍生狀態。若其他分頁已先提交
    // 同一回合，commitRound 會拒絕而不是以舊結果覆蓋新進度。
    const committed = await clientDB.commitRound(profileId, saveData, {
        profileUpdates,
        stateUpdates,
        expectedPreviousRound: Number(roundData.R) - 1,
    });

    // Phase 2: 定期清理舊資料（每 10 回合，fire-and-forget）
    runCleanup(profileId, roundData.R).catch(() => {});

    return {
        profile: committed.profile
    };
}
