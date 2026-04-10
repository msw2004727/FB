// ai-proxy/services/mempalaceClient.js
// Node.js 客戶端 — 與 MemPalace Python HTTP Server 通訊

const MEMPALACE_URL = process.env.MEMPALACE_URL || 'http://localhost:8200';
const TIMEOUT_MS = 2000;

/**
 * 發送 HTTP 請求到 MemPalace server
 */
async function request(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(`${MEMPALACE_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        clearTimeout(timer);
        return await res.json();
    } catch (err) {
        clearTimeout(timer);
        console.warn(`[MemPalace Client] ${path} failed:`, err.message);
        return null;
    }
}

/**
 * 寫入一條記憶（fire-and-forget）
 * @param {string} wing - 玩家 Wing ID
 * @param {string} room - 記憶分類
 * @param {string} content - 記憶內容
 * @param {object} metadata - 額外元資料
 */
function addMemory(wing, room, content, metadata = {}) {
    // fire-and-forget: 不等待、不阻塞
    request('/add', { wing, room, content, metadata }).then(result => {
        if (result && result.success) {
            console.log(`[MemPalace] Saved to ${wing}/${room} (total: ${result.total})`);
        }
    }).catch(() => {});
}

/**
 * 語意搜尋相關記憶
 * @param {string} query - 搜尋查詢
 * @param {string} wing - Wing 過濾器
 * @param {number} limit - 最多回傳幾筆
 * @returns {Promise<Array>} 記憶片段陣列
 */
async function search(query, wing = null, limit = 5) {
    const result = await request('/search', { query, wing, limit });
    if (result && result.results) {
        return result.results;
    }
    return [];
}

/**
 * 檢查 MemPalace server 是否可用
 */
async function isAvailable() {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1000);
        const res = await fetch(`${MEMPALACE_URL}/health`, { signal: controller.signal });
        clearTimeout(timer);
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * 儲存一回合的遊戲記憶（由 AI 回應後觸發）
 * @param {string} playerId - 玩家 ID
 * @param {object} roundData - 回合資料
 * @param {string} story - 故事文字
 */
function saveRoundMemory(playerId, roundData, story) {
    const wing = `player_${playerId}`;
    const roundId = `R${roundData.R || '?'}`;
    const loc = Array.isArray(roundData.LOC)
        ? roundData.LOC[roundData.LOC.length - 1]
        : (roundData.LOC || '未知');

    // 1. 儲存完整故事
    if (story) {
        addMemory(wing, 'main_story', `[${roundId}] [${loc}] ${story}`, {
            round: roundData.R,
            location: loc,
            event: roundData.EVT || ''
        });
    }

    // 2. 儲存 NPC 互動
    if (roundData.NPC && Array.isArray(roundData.NPC)) {
        for (const npc of roundData.NPC) {
            if (npc.name && npc.status) {
                addMemory(wing, 'npc_interactions',
                    `[${roundId}] 在${loc}遇到${npc.name}：${npc.status}`,
                    { round: roundData.R, npc: npc.name }
                );
            }
        }
    }

    // 3. 儲存事件標題
    if (roundData.EVT) {
        addMemory(wing, 'events',
            `[${roundId}] ${roundData.EVT}`,
            { round: roundData.R }
        );
    }
}

module.exports = {
    addMemory,
    search,
    isAvailable,
    saveRoundMemory
};
