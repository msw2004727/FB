// client/utils/exportImport.js
// 存檔匯出/匯入工具

import clientDB from '../db/clientDB.js';

/**
 * 匯出存檔為 JSON 檔案下載
 * @param {string} profileId
 */
export async function exportSave(profileId) {
    const data = await clientDB.exportAll(profileId);
    const profile = data.profile;
    const filename = `wenjiang_save_${profile.username}_${new Date().toISOString().slice(0, 10)}.json`;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return filename;
}

/**
 * 從 JSON 檔案匯入存檔
 * @returns {Promise<string>} profileId
 */
export function importSave() {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (event) => {
            const file = event.target.files[0];
            if (!file) return reject(new Error('未選擇檔案'));

            try {
                const text = await file.text();
                const data = JSON.parse(text);
                const profileId = await clientDB.importAll(data);
                resolve(profileId);
            } catch (error) {
                reject(new Error(`匯入失敗: ${error.message}`));
            }
        };
        input.click();
    });
}

/**
 * 檢查是否應該提醒玩家備份
 */
export function shouldRemindBackup() {
    const lastRemind = localStorage.getItem('wenjiang_last_backup_remind');
    if (!lastRemind) return true;
    const daysSince = (Date.now() - Number(lastRemind)) / (1000 * 60 * 60 * 24);
    return daysSince >= 3; // 每 3 天提醒一次
}

export function markBackupReminded() {
    localStorage.setItem('wenjiang_last_backup_remind', String(Date.now()));
}

/**
 * 檢測是否為 iOS Safari（高風險平台）
 */
export function isIOSSafari() {
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) && /WebKit/.test(ua) && !/CriOS|FxiOS/.test(ua);
}
