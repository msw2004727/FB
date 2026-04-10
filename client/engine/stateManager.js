// client/engine/stateManager.js
// 遊戲狀態更新管理器 — 精簡版
// 負責將 AI 回傳的 roundData 應用到 IndexedDB

import clientDB from '../db/clientDB.js';
import { clamp, toFiniteNumber, advanceDate } from '../utils/gameUtils.js';

/**
 * 將 AI 回傳的 roundData 完整應用到本機資料庫
 */
export async function applyAllChanges(profileId, roundData) {
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

    if (roundData.daysToAdvance > 0) {
        dateData = advanceDate(dateData, roundData.daysToAdvance);
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

    await clientDB.profiles.update(profileId, profileUpdates);

    // 4. 儲存回合
    const saveData = {
        ...roundData,
        morality: newMorality,
        timeOfDay,
        ...dateData
    };
    await clientDB.saves.add(profileId, saveData);

    // 5. 更新小說章節
    if (roundData.story) {
        await clientDB.novel.addChapter(profileId, roundData.R, roundData.story);
    }

    return {
        profile: await clientDB.profiles.get(profileId)
    };
}
