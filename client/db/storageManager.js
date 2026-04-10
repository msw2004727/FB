// client/db/storageManager.js
// IndexedDB 容量管理 — 自動清理老舊資料 + 持久化儲存

import clientDB from './clientDB.js';

const SAVE_RETENTION = 10;
const CHECKPOINT_INTERVAL = 10;
const CHAPTER_RETENTION = 20;
const CLUE_SUMMARY_MAX_CHARS = 2000;
const CLUE_SUMMARY_TRIGGER = 3000;
const CLEANUP_INTERVAL_ROUNDS = 10;

/**
 * 清理舊存檔：保留最近 N 筆 + 每 M 回合的檢查點
 */
async function pruneGameSaves(profileId) {
    const allSaves = await clientDB.saves.getAll(profileId);
    if (allSaves.length <= SAVE_RETENTION) return 0;

    const toKeep = new Set();

    // 保留最近 N 筆
    const sorted = [...allSaves].sort((a, b) => (b.R || 0) - (a.R || 0));
    for (let i = 0; i < Math.min(SAVE_RETENTION, sorted.length); i++) {
        toKeep.add(sorted[i].R);
    }

    // 保留第 1 回合和每 CHECKPOINT_INTERVAL 回合
    for (const save of allSaves) {
        if (save.R <= 1 || save.R % CHECKPOINT_INTERVAL === 0) {
            toKeep.add(save.R);
        }
    }

    const toDelete = allSaves.filter(s => !toKeep.has(s.R));
    if (toDelete.length === 0) return 0;

    // 需要直接操作 IndexedDB transaction
    const db = await clientDB.init();
    const tx = db.transaction('game_saves', 'readwrite');
    const store = tx.objectStore('game_saves');
    for (const save of toDelete) {
        store.delete([save.profileId, save.R]);
    }
    await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });

    console.log(`[StorageManager] 清理了 ${toDelete.length} 筆舊存檔（保留 ${toKeep.size} 筆）`);
    return toDelete.length;
}

/**
 * 清理舊章節：保留最近 N 筆
 */
async function pruneNovelChapters(profileId) {
    const allChapters = await clientDB.novel.getAll(profileId);
    if (allChapters.length <= CHAPTER_RETENTION) return 0;

    const sorted = [...allChapters].sort((a, b) => (b.round || 0) - (a.round || 0));
    const toKeep = new Set(sorted.slice(0, CHAPTER_RETENTION).map(c => c.round));
    const toDelete = allChapters.filter(c => !toKeep.has(c.round));

    if (toDelete.length === 0) return 0;

    const db = await clientDB.init();
    const tx = db.transaction('novel_chapters', 'readwrite');
    const store = tx.objectStore('novel_chapters');
    for (const ch of toDelete) {
        store.delete([ch.profileId, ch.round]);
    }
    await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });

    console.log(`[StorageManager] 清理了 ${toDelete.length} 筆舊章節`);
    return toDelete.length;
}

/**
 * 截斷過長的 clues_summary
 */
async function trimCluesSummary(profileId) {
    const clues = await clientDB.state.get(profileId, 'clues_summary');
    if (!clues || typeof clues !== 'string') return false;
    if (clues.length <= CLUE_SUMMARY_TRIGGER) return false;

    const trimmed = clues.slice(-CLUE_SUMMARY_MAX_CHARS);
    const firstNewline = trimmed.indexOf('\n');
    const clean = firstNewline > 0 ? trimmed.slice(firstNewline + 1) : trimmed;

    await clientDB.state.set(profileId, 'clues_summary', clean);
    console.log(`[StorageManager] 截斷 clues_summary: ${clues.length} → ${clean.length} 字元`);
    return true;
}

/**
 * 請求持久化儲存（防止瀏覽器自動清除 IndexedDB）
 */
export async function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
        const granted = await navigator.storage.persist();
        console.log(`[StorageManager] 持久化儲存: ${granted ? '已授權' : '未授權'}`);
        return granted;
    }
    return false;
}

/**
 * 主清理函式 — 每 N 回合自動執行
 */
export async function runCleanup(profileId, currentRound) {
    if (currentRound > 0 && currentRound % CLEANUP_INTERVAL_ROUNDS !== 0) return;

    try {
        const [savedCount, chapterCount] = await Promise.all([
            pruneGameSaves(profileId),
            pruneNovelChapters(profileId),
        ]);
        await trimCluesSummary(profileId);

        if (savedCount > 0 || chapterCount > 0) {
            if (navigator.storage && navigator.storage.estimate) {
                const est = await navigator.storage.estimate();
                console.log(`[StorageManager] 使用量: ${((est.usage || 0) / 1024 / 1024).toFixed(2)} MB`);
            }
        }
    } catch (err) {
        console.warn('[StorageManager] 清理失敗（不影響遊戲）:', err.message);
    }
}

/**
 * 初始化時呼叫 — 請求持久化
 */
export async function initStorageManager() {
    await requestPersistentStorage();
}

export default { runCleanup, initStorageManager, requestPersistentStorage };
