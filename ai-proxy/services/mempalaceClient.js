// ai-proxy/services/mempalaceClient.js
// MemPalace Client v2.0 — Phase 1 (write) + Phase 2 (read) + Phase 3 (knowledge graph)

const MEMPALACE_URL = process.env.MEMPALACE_URL || 'http://localhost:8200';
const TIMEOUT_MS = 2000;

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
        return null;
    }
}

// ── Phase 1: 寫入記憶 ──────────────────────────────

function addMemory(wing, room, content, metadata = {}) {
    request('/add', { wing, room, content, metadata }).then(r => {
        if (r && r.success) console.log(`[MemPalace] Saved ${wing}/${room} (${r.total})`);
    }).catch(() => {});
}

function saveRoundMemory(playerId, roundData, story) {
    const wing = `player_${playerId}`;
    const roundId = `R${roundData.R || '?'}`;
    const loc = Array.isArray(roundData.LOC) ? roundData.LOC[roundData.LOC.length - 1] : (roundData.LOC || '');

    // 故事
    if (story) addMemory(wing, 'main_story', `[${roundId}] [${loc}] ${story}`, { round: roundData.R, location: loc });

    // NPC 互動
    if (roundData.NPC && Array.isArray(roundData.NPC)) {
        for (const npc of roundData.NPC) {
            if (npc.name) {
                addMemory(wing, 'npc_interactions', `[${roundId}] 在${loc}遇到${npc.name}：${npc.status || ''}`, { round: roundData.R, npc: npc.name });
                // Phase 3: 寫入 KG — NPC 位置
                addFact(wing, npc.name, 'located_at', loc, roundId);
            }
        }
    }

    // 事件
    if (roundData.EVT) addMemory(wing, 'events', `[${roundId}] ${roundData.EVT}`, { round: roundData.R });

    // Phase 3: 寫入 KG — 玩家位置
    if (loc) addFact(wing, '主角', 'located_at', loc, roundId);

    // Phase 3: 寫入 KG — 善惡變化
    if (roundData.moralityChange && roundData.moralityChange !== 0) {
        const direction = roundData.moralityChange > 0 ? '偏正' : '偏邪';
        addFact(wing, '主角', 'morality_shift', direction, roundId);
    }
}

// ── Phase 2: 讀取記憶（AI 生成前呼叫）──────────────

async function search(query, wing = null, limit = 5) {
    const result = await request('/search', { query, wing, limit });
    return (result && result.results) ? result.results : [];
}

/**
 * Phase 2 核心：為 AI 生成故事組裝深度記憶上下文
 * @param {string} playerId - 玩家 ID
 * @param {string} playerAction - 玩家當前行動
 * @param {Array} npcNames - 場景中的 NPC 名字
 * @returns {Promise<string>} 格式化的記憶上下文字串
 */
async function buildDeepMemoryContext(playerId, playerAction, npcNames = []) {
    const wing = `player_${playerId}`;

    try {
        const searches = [
            // 搜尋與當前行動相關的歷史記憶
            search(playerAction, wing, 3),
        ];

        // 搜尋與場景中 NPC 相關的記憶
        for (const name of npcNames.slice(0, 3)) {
            searches.push(search(name, wing, 2));
        }

        // 查詢 NPC 的知識圖譜事實
        const kgSearches = npcNames.slice(0, 3).map(name => queryEntity(name, wing));

        const [actionMemories, ...npcResults] = await Promise.all(searches);
        const kgResults = await Promise.all(kgSearches);

        let context = '';

        // 行動相關記憶
        if (actionMemories && actionMemories.length > 0) {
            const memories = actionMemories.map(m => m.content).join('\n');
            context += `\n【相關歷史記憶】\n${memories}\n`;
        }

        // NPC 記憶
        const npcMemParts = [];
        for (let i = 0; i < npcNames.length && i < npcResults.length; i++) {
            const results = npcResults[i];
            if (results && results.length > 0) {
                const memories = results.map(m => m.content).join('; ');
                npcMemParts.push(`${npcNames[i]}: ${memories}`);
            }
        }
        if (npcMemParts.length > 0) {
            context += `\n【NPC 互動歷史】\n${npcMemParts.join('\n')}\n`;
        }

        // KG 事實
        const factParts = [];
        for (let i = 0; i < npcNames.length && i < kgResults.length; i++) {
            const facts = kgResults[i];
            if (facts && facts.length > 0) {
                const factStr = facts.map(f => `${f.subject} ${f.predicate} ${f.object}`).join('; ');
                factParts.push(factStr);
            }
        }
        if (factParts.length > 0) {
            context += `\n【已知事實】\n${factParts.join('\n')}\n`;
        }

        return context.trim();
    } catch (err) {
        console.warn('[MemPalace] buildDeepMemoryContext failed:', err.message);
        return '';
    }
}

// ── Phase 3: 知識圖譜 ──────────────────────────────

function addFact(wing, subject, predicate, object, validFrom = '') {
    request('/kg/add', { wing, subject, predicate, object, valid_from: validFrom }).catch(() => {});
}

async function queryEntity(entity, wing = null) {
    const result = await request('/kg/query', { entity, wing });
    return (result && result.facts) ? result.facts : [];
}

function invalidateFact(wing, subject, predicate, object = '', ended = '') {
    request('/kg/invalidate', { wing, subject, predicate, object, ended }).catch(() => {});
}

// ── Health check ─────────────────────────────────────

async function isAvailable() {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1000);
        const res = await fetch(`${MEMPALACE_URL}/health`, { signal: controller.signal });
        clearTimeout(timer);
        return res.ok;
    } catch { return false; }
}

module.exports = {
    addMemory, search, saveRoundMemory, buildDeepMemoryContext,
    addFact, queryEntity, invalidateFact, isAvailable
};
