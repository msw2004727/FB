// ai-proxy/services/mempalaceClient.js
// MemPalace Client v3.0 — 5 項優化
//   1. 中文 Embedding (server 端)
//   2. Hall 分類 + importance 評分
//   3. Recency weighted search (/search_ranked)
//   4. 寫入時去重 (dedup flag)
//   5. KG Timeline 查詢

const MEMPALACE_URL = process.env.MEMPALACE_URL || 'https://mempalace-server-322557520154.asia-east2.run.app';
const TIMEOUT_MS = 3000; // 加大至 3 秒（ranked search 需多取 3 倍再排序）
const TOKEN_BUDGET = 800; // deepMemoryContext 最大 token 預算

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
        if (!res.ok) {
            console.warn(`[MemPalace] ${path} HTTP ${res.status}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        clearTimeout(timer);
        return null;
    }
}

// ── 優化 #2: Hall 分類器（規則式）──────────────────────

const COMBAT_KW = ['攻擊', '劍', '拳', '戰鬥', '閃避', '受傷', '招式', '內力', '功力', '出招'];
const DISCOVERY_KW = ['發現', '找到', '學會', '獲得', '領悟', '秘笈', '寶物', '藏寶', '密道'];
const FACT_KW = ['原來', '真相', '其實', '身份', '真名', '來歷', '師承'];

function classifyHalls(roundData, story) {
    const halls = [];
    if (roundData.moralityChange && roundData.moralityChange !== 0) halls.push('hall_decisions');
    if (roundData.NPC && Array.isArray(roundData.NPC) && roundData.NPC.length > 0) halls.push('hall_relationships');
    if (roundData.EVT) halls.push('hall_events');
    if (story) {
        if (COMBAT_KW.some(kw => story.includes(kw))) halls.push('hall_combat');
        if (DISCOVERY_KW.some(kw => story.includes(kw))) halls.push('hall_discoveries');
        if (FACT_KW.some(kw => story.includes(kw))) halls.push('hall_facts');
    }
    return halls.length > 0 ? [...new Set(halls)] : ['hall_events'];
}

function estimateImportance(roundData, story) {
    let score = 0.5;
    if (roundData.moralityChange && Math.abs(roundData.moralityChange) >= 5) score += 0.2;
    if (roundData.EVT) score += 0.1;
    if (roundData.NPC && roundData.NPC.some(n => n.isNew)) score += 0.15;
    if (story && story.length > 500) score += 0.1;
    return Math.min(1.0, Math.round(score * 100) / 100);
}

// ── Phase 1: 寫入記憶 ──────────────────────────────────

function addMemory(wing, room, content, metadata = {}, dedup = false) {
    request('/add', { wing, room, content, metadata, dedup }).then(r => {
        if (r && r.success) {
            const tag = r.deduplicated ? 'DEDUP' : 'NEW';
            console.log(`[MemPalace] [${tag}] ${wing}/${room} (${r.total})`);
        } else if (r === null) {
            console.warn(`[MemPalace] Write failed (network) ${wing}/${room}`);
        } else {
            console.warn(`[MemPalace] Write rejected ${wing}/${room}:`, r?.error || 'unknown');
        }
    }).catch(err => {
        console.warn(`[MemPalace] Write error ${wing}/${room}:`, err.message);
    });
}

function saveRoundMemory(playerId, roundData, story) {
    const wing = `player_${playerId}`;
    const roundNum = roundData.R || 0;
    const roundId = `R${roundNum}`;
    const loc = Array.isArray(roundData.LOC) ? roundData.LOC[roundData.LOC.length - 1] : (roundData.LOC || '');

    // 優化 #2: Hall 分類 + importance
    const halls = classifyHalls(roundData, story);
    const importance = estimateImportance(roundData, story);

    // 故事（不去重 — 每回合故事都是獨特的）
    if (story) {
        addMemory(wing, 'main_story', `[${roundId}] [${loc}] ${story}`, {
            round: roundNum, location: loc, halls: halls.join(','), importance
        }, false);
    }

    // NPC 互動 — 每個 NPC 存入自己的 room（記憶隔離）
    if (roundData.NPC && Array.isArray(roundData.NPC)) {
        for (const npc of roundData.NPC) {
            if (npc.name) {
                // per-NPC room: 只有搜索該 NPC 時才會找到這些記憶
                addMemory(wing, `npc_${npc.name}`,
                    `[${roundId}] 在${loc}遇到${npc.name}：${npc.status || ''}`,
                    { round: roundNum, npc: npc.name, halls: 'hall_relationships', importance },
                    true
                );
                // 同時寫入共用 room（供行動搜索使用）
                addMemory(wing, 'npc_interactions',
                    `[${roundId}] 在${loc}遇到${npc.name}：${npc.status || ''}`,
                    { round: roundNum, npc: npc.name, halls: 'hall_relationships', importance },
                    true
                );
                // KG: 先 invalidate 舊的 located_at，再寫新的
                invalidateFact(wing, npc.name, 'located_at', '', roundId);
                addFact(wing, npc.name, 'located_at', loc, roundId);
            }
        }
    }

    // 事件（去重）
    if (roundData.EVT) {
        addMemory(wing, 'events', `[${roundId}] ${roundData.EVT}`, {
            round: roundNum, halls: halls.join(','), importance
        }, true);
    }

    // KG: 玩家位置（invalidate 舊的再寫新的）
    if (loc) {
        invalidateFact(wing, '主角', 'located_at', '', roundId);
        addFact(wing, '主角', 'located_at', loc, roundId);
    }

    // KG: 善惡變化
    if (roundData.moralityChange && roundData.moralityChange !== 0) {
        const direction = roundData.moralityChange > 0 ? '偏正' : '偏邪';
        addFact(wing, '主角', 'morality_shift', direction, roundId);
    }
}

// ── Phase 2: 讀取記憶 ──────────────────────────────────

async function search(query, wing = null, limit = 5) {
    const result = await request('/search', { query, wing, limit });
    return (result && result.results) ? result.results : [];
}

// 優化 #3: Recency Weighted Search（支援 room 過濾）
async function searchRanked(query, wing = null, limit = 5, currentRound = 0, room = null) {
    const body = {
        query, wing, limit,
        current_round: currentRound,
        decay_rate: 0.98,
        w_relevance: 0.5,
        w_recency: 0.35,
        w_importance: 0.15,
        max_distance: 0.5
    };
    if (room) body.room = room;
    const result = await request('/search_ranked', body);
    return (result && result.results) ? result.results : [];
}

// 優化 #5: KG Timeline
async function getTimeline(entity, wing = null, limit = 10) {
    const result = await request('/kg/timeline', { entity, wing, limit });
    return (result && result.timeline) ? result.timeline : [];
}

function buildTimelineString(entity, timeline) {
    if (!timeline || timeline.length === 0) return '';
    const lines = timeline.map(f => {
        const status = f.ended ? `(R${f.round}~${f.ended})` : `(R${f.round}~now)`;
        return `${f.subject} ${f.predicate} ${f.object} ${status}`;
    });
    return `[${entity}] ${lines.join('; ')}`;
}

function estimateTokens(text) {
    if (!text) return 0;
    let cn = 0;
    for (const c of text) {
        if (c.charCodeAt(0) >= 0x4e00 && c.charCodeAt(0) <= 0x9fff) cn++;
    }
    return Math.round(cn * 0.6 + (text.length - cn) * 0.25);
}

/**
 * v3.0 核心：組裝深度記憶上下文（含 recency + timeline + token 預算）
 */
async function buildDeepMemoryContext(playerId, playerAction, npcNames = [], currentRound = 0) {
    const wing = `player_${playerId}`;

    try {
        // 優化: 所有搜索並行執行（vector + KG 同時跑）
        const MAX_NPCS = 3;
        const effectiveNpcs = npcNames.slice(0, MAX_NPCS);

        const searches = [
            searchRanked(playerAction, wing, 3, currentRound),
        ];
        const npcSearches = [];
        const timelineSearches = [];

        for (const name of effectiveNpcs) {
            // 搜索該 NPC 自己的 room（記憶隔離：NPC 只記得自己經歷的事）
            npcSearches.push(searchRanked(name, wing, 2, currentRound, `npc_${name}`));
            timelineSearches.push(getTimeline(name, wing, 5));
        }

        const allResults = await Promise.all([...searches, ...npcSearches, ...timelineSearches]);

        const actionMemories = allResults[0];
        const npcMemResults = allResults.slice(1, 1 + effectiveNpcs.length);
        const npcTimelines = allResults.slice(1 + effectiveNpcs.length);

        let context = '';
        let tokens = 0;

        // 1. 行動相關記憶
        if (actionMemories && actionMemories.length > 0) {
            const memories = actionMemories.map(m => m.content).join('\n');
            const section = `\n【相關歷史記憶】\n${memories}\n`;
            const sectionTokens = estimateTokens(section);
            if (tokens + sectionTokens < TOKEN_BUDGET) {
                context += section;
                tokens += sectionTokens;
            }
        }

        // 2. NPC Timeline（KG 時間線）
        const timelineParts = [];
        for (let i = 0; i < effectiveNpcs.length && i < npcTimelines.length; i++) {
            const tl = buildTimelineString(effectiveNpcs[i], npcTimelines[i]);
            if (tl) timelineParts.push(tl);
        }
        if (timelineParts.length > 0) {
            const section = `\n【NPC 時間線】\n${timelineParts.join('\n')}\n`;
            const sectionTokens = estimateTokens(section);
            if (tokens + sectionTokens < TOKEN_BUDGET) {
                context += section;
                tokens += sectionTokens;
            }
        }

        // 3. NPC 互動記憶（如果 token 預算允許）
        if (tokens < TOKEN_BUDGET - 100) {
            const npcMemParts = [];
            for (let i = 0; i < effectiveNpcs.length && i < npcMemResults.length; i++) {
                const results = npcMemResults[i];
                if (results && results.length > 0) {
                    const memories = results.map(m => m.content).join('; ');
                    npcMemParts.push(`${effectiveNpcs[i]}: ${memories}`);
                }
            }
            if (npcMemParts.length > 0) {
                const section = `\n【NPC 互動歷史】\n${npcMemParts.join('\n')}\n`;
                const sectionTokens = estimateTokens(section);
                if (tokens + sectionTokens < TOKEN_BUDGET) {
                    context += section;
                    tokens += sectionTokens;
                }
            }
        }

        return context.trim();
    } catch (err) {
        console.warn('[MemPalace] buildDeepMemoryContext failed:', err.message);
        return '';
    }
}

// ── Phase 3: 知識圖譜 ──────────────────────────────────

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

// ── Health check ─────────────────────────────────────────

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
    addMemory, search, searchRanked, saveRoundMemory, buildDeepMemoryContext,
    addFact, queryEntity, invalidateFact, getTimeline, isAvailable
};
