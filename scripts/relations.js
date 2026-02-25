import { api } from './api.js';
import { ensureLocalPreviewAuthSession } from './localPreviewMode.js';

const NS = 'http://www.w3.org/2000/svg';
const GKEY = 'fb_relations_graph_cache_v3:';
const FKEY = 'fb_relations_hidden_types_v1:';
const TYPE_ORDER = ['family', 'romance', 'faction', 'friend', 'enemy', 'acquaintance', 'unfamiliar', 'other'];
const TYPE_META = {
    family: { label: '親人', color: '#d97706' },
    romance: { label: '情感', color: '#db2777' },
    faction: { label: '門派', color: '#2563eb' },
    friend: { label: '朋友', color: '#16a34a' },
    enemy: { label: '敵對', color: '#dc2626' },
    acquaintance: { label: '熟識', color: '#0f766e' },
    unfamiliar: { label: '不熟', color: '#64748b' },
    other: { label: '其他', color: '#6d28d9' }
};

const S = {
    u: '',
    g: null,
    l: null,
    v: null,
    hidden: new Set(),
    vp: { w: 800, h: 600 },
    t: { x: 400, y: 300, k: 1 },
    manual: false,
    drag: { on: false, id: null, sx: 0, sy: 0, bx: 0, by: 0 },
    clickLock: 0,
    r: {}
};

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const str = (v) => (v == null ? '' : String(v));
const j = (v) => { try { return JSON.parse(v); } catch { return null; } };
const clr = (el) => { while (el?.firstChild) el.removeChild(el.firstChild); };
const typeW = (t) => (TYPE_ORDER.indexOf(t) >= 0 ? TYPE_ORDER.indexOf(t) : 99);
function h(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(16); }
function svg(tag, attrs = {}) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v)); return e; }
function info(type, graph = S.g) {
    const d = Array.isArray(graph?.relationTypes) ? graph.relationTypes.find(x => x?.key === type) : null;
    const b = TYPE_META[type] || TYPE_META.other;
    return { label: str(d?.label).trim() || b.label, color: str(d?.color).trim() || b.color };
}

function setTop(text) { if (S.r.cacheStatus) S.r.cacheStatus.textContent = text; }
function setGS(text) { if (S.r.graphStatusText) S.r.graphStatusText.textContent = text; }
function setSrc(text) { if (S.r.graphSource) S.r.graphSource.textContent = text; }
function overlay({ loading = false, empty = false, text } = {}) {
    S.r.graphLoadingOverlay?.classList.toggle('hidden', !loading);
    S.r.graphEmptyOverlay?.classList.toggle('hidden', !empty);
    if (text && S.r.graphEmptyText) S.r.graphEmptyText.textContent = text;
}

function cacheKey() { return `${GKEY}${S.u || 'anon'}`; }
function filterKey() { return `${FKEY}${S.u || 'anon'}`; }
function readCache() { return j(localStorage.getItem(cacheKey()) || ''); }
function writeCache(graph) { localStorage.setItem(cacheKey(), JSON.stringify({ savedAt: new Date().toISOString(), graph })); }
function readHidden() { const a = j(localStorage.getItem(filterKey()) || ''); return Array.isArray(a) ? new Set(a.map(str).filter(Boolean)) : new Set(); }
function writeHidden() { localStorage.setItem(filterKey(), JSON.stringify([...S.hidden])); }

function norm(resp) {
    if (!resp || typeof resp !== 'object') return null;
    const src = resp.graph && Array.isArray(resp.graph.nodes) ? resp.graph : (Array.isArray(resp.nodes) ? resp : null);
    if (!src) {
        if (typeof resp.mermaidSyntax === 'string') return { centerNodeId: 'player', cacheKey: `legacy-${h(resp.mermaidSyntax)}`, nodes: [{ id: 'player', kind: 'player', name: S.u || '主角', label: S.u || '主角', statusTitle: '主角', degree: 0 }], edges: [], relationTypes: [], meta: { nodeCount: 1, edgeCount: 0 } };
        return null;
    }
    const center = str(src.centerNodeId).trim() || 'player';
    const nmap = new Map();
    for (const n of src.nodes || []) {
        const id = str(n?.id).trim(); if (!id) continue;
        nmap.set(id, {
            id, kind: str(n.kind).trim() || 'npc',
            name: str(n.name).trim() || id,
            label: str(n.label).trim() || str(n.name).trim() || id,
            statusTitle: str(n.statusTitle || n.status_title).trim(),
            allegiance: str(n.allegiance).trim(),
            friendlinessValue: Number(n.friendlinessValue) || 0,
            romanceValue: Number(n.romanceValue) || 0,
            isDeceased: !!n.isDeceased,
            inCurrentScene: !!n.inCurrentScene,
            degree: 0
        });
    }
    if (!nmap.has(center)) nmap.set(center, { id: center, kind: 'player', name: S.u || '主角', label: S.u || '主角', statusTitle: '主角', allegiance: '', friendlinessValue: 0, romanceValue: 0, isDeceased: false, inCurrentScene: false, degree: 0 });
    const edges = []; const seen = new Set();
    for (const e of src.edges || []) {
        const a = str(e?.source).trim(), b = str(e?.target).trim(); if (!a || !b || a === b || !nmap.has(a) || !nmap.has(b)) continue;
        const type = str(e.type).trim() || 'other'; const label = str(e.label).trim() || info(type, src).label; const d = !!e.directed;
        const pair = d ? [a, b] : [a, b].sort(); const k = `${pair[0]}|${pair[1]}|${type}|${label}|${d ? 'd' : 'u'}`; if (seen.has(k)) continue; seen.add(k);
        edges.push({ id: str(e.id).trim() || `edge:${h(k)}`, source: a, target: b, type, label, directed: d, strength: Number(e.strength) || 0, color: str(e.color).trim() || info(type, src).color });
    }
    for (const e of edges) { nmap.get(e.source).degree++; nmap.get(e.target).degree++; }
    return {
        version: Number(src.version) || 2,
        cacheKey: str(src.cacheKey).trim() || `client-${h(JSON.stringify({ n: [...nmap.values()], e: edges }))}`,
        centerNodeId: center,
        relationTypes: Array.isArray(src.relationTypes) ? src.relationTypes : [],
        generatedAt: str(src.generatedAt).trim() || null,
        nodes: [...nmap.values()],
        edges,
        meta: { ...(src.meta && typeof src.meta === 'object' ? src.meta : {}), nodeCount: nmap.size, edgeCount: edges.length }
    };
}

function indexes(g) {
    const nodeById = new Map(g.nodes.map(n => [n.id, n]));
    const pEdges = new Map();
    for (const e of g.edges) { if (e.source === g.centerNodeId) pEdges.set(e.target, e); if (e.target === g.centerNodeId) pEdges.set(e.source, e); }
    return { nodeById, pEdges };
}
function pType(n, pEdge) { if (n.kind === 'player') return 'other'; if (pEdge?.type) return pEdge.type; return Math.abs(n.friendlinessValue || 0) <= 10 ? 'unfamiliar' : 'acquaintance'; }
function score(n, pEdge) { return (n.degree || 0) * 16 + Math.abs(n.friendlinessValue || 0) * .45 + Math.abs(n.romanceValue || 0) * .85 + Math.abs(pEdge?.strength || 0) * .35 + (n.inCurrentScene ? 12 : 0); }
function baseR(type) { if (type === 'family' || type === 'romance') return 220; if (type === 'friend' || type === 'faction') return 305; if (type === 'acquaintance') return 385; if (type === 'enemy') return 435; return 490; }

function layout(g) {
    const { pEdges } = indexes(g); const center = g.centerNodeId || 'player'; const npcs = g.nodes.filter(n => n.id !== center); const total = npcs.length;
    const groups = new Map(TYPE_ORDER.map(t => [t, []])); groups.set('other', []);
    for (const n of npcs) { const pe = pEdges.get(n.id); const t = pType(n, pe); (groups.get(t) || groups.get('other')).push({ n, t: groups.has(t) ? t : 'other', s: score(n, pe) }); }
    for (const list of groups.values()) list.sort((a, b) => b.s - a.s || a.n.name.localeCompare(b.n.name, 'zh-Hant'));
    const nonEmpty = [...groups.entries()].filter(([, l]) => l.length); const gap = nonEmpty.length > 1 ? clamp(6 - total * .04, 2, 6) : 0; const avail = 360 - gap * nonEmpty.length; const units = Math.max(1, nonEmpty.reduce((s, [, l]) => s + Math.max(1, l.length), 0));
    const minAng = total > 60 ? 9 : total > 35 ? 12 : 16; const ringGap = total > 70 ? 86 : total > 45 ? 98 : 112;
    const pos = new Map(); pos.set(center, { x: 0, y: 0, type: 'center' }); let cursor = -90;
    for (const [type, list] of nonEmpty) {
        const span = avail * (Math.max(1, list.length) / units); const cap = Math.max(1, Math.floor(span / minAng)); const start = cursor;
        list.forEach((item, i) => { const ring = Math.floor(i / cap); const slot = i % cap; const count = Math.min(cap, list.length - ring * cap); const deg = start + ((slot + 1) / (count + 1)) * span; const rad = deg * Math.PI / 180; const r = baseR(type) + ring * ringGap; pos.set(item.n.id, { x: Math.cos(rad) * r, y: Math.sin(rad) * r, type, ring: ring + 1 }); });
        cursor += span + gap;
    }
    return { pos };
}

function computeVisible() {
    const edges = S.g.edges.filter(e => !S.hidden.has(e.type));
    const ids = new Set([S.g.centerNodeId || 'player']); for (const e of edges) { ids.add(e.source); ids.add(e.target); }
    S.v = { edges, nodes: S.g.nodes.filter(n => ids.has(n.id)), ids };
}

function updateMeta() {
    clr(S.r.graphMeta); if (!S.g || !S.v) return;
    const rows = [['節點', S.g.meta?.nodeCount ?? S.g.nodes.length], ['連線', S.g.meta?.edgeCount ?? S.g.edges.length], ['可見節點', S.v.nodes.length], ['可見連線', S.v.edges.length], ['最新回合', S.g.meta?.latestRound ?? '—']];
    for (const [k, v] of rows) { const li = document.createElement('li'); li.className = 'panel-item'; const a = document.createElement('span'); const b = document.createElement('strong'); a.textContent = k; b.textContent = String(v); li.append(a, b); S.r.graphMeta.appendChild(li); }
}

function drawLegendFilters() {
    clr(S.r.graphLegend); clr(S.r.relationTypeFilters); if (!S.g) return;
    const types = [...new Set(S.g.edges.map(e => e.type))].sort((a, b) => typeW(a) - typeW(b));
    if (!types.length) { const x = document.createElement('div'); x.className = 'legend-item'; x.textContent = '尚無關係資料'; S.r.graphLegend.appendChild(x); return; }
    for (const t of types) {
        const m = info(t);
        const li = document.createElement('div'); li.className = 'legend-item'; li.style.color = m.color;
        li.append(Object.assign(document.createElement('span'), { className: 'legend-line' }), Object.assign(document.createElement('span'), { textContent: m.label }));
        li.lastChild.style.color = '';
        S.r.graphLegend.appendChild(li);
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'filter-chip'; btn.dataset.type = t; btn.style.color = m.color; btn.title = `${S.hidden.has(t) ? '顯示' : '隱藏'} ${m.label}`; btn.setAttribute('aria-pressed', String(!S.hidden.has(t))); if (S.hidden.has(t)) btn.classList.add('hidden-type');
        btn.append(Object.assign(document.createElement('span'), { className: 'chip-dot' }), Object.assign(document.createElement('span'), { textContent: m.label }));
        S.r.relationTypeFilters.appendChild(btn);
    }
}

function viewport() {
    const rect = S.r.relationsContent.getBoundingClientRect();
    S.vp.w = Math.max(320, Math.round(rect.width || S.r.relationsContent.clientWidth || 800));
    S.vp.h = Math.max(320, Math.round(rect.height || S.r.relationsContent.clientHeight || 600));
    S.r.relationsSvg.setAttribute('viewBox', `0 0 ${S.vp.w} ${S.vp.h}`);
}

function setTransform(t, persist = false) {
    S.t = { x: Number(t.x) || 0, y: Number(t.y) || 0, k: clamp(Number(t.k) || 1, .18, 5) };
    S.r.relationsWorld.setAttribute('transform', `translate(${S.t.x} ${S.t.y}) scale(${S.t.k})`);
    if (persist) localStorage.setItem(`${filterKey()}:view`, JSON.stringify(S.t));
}
function readTransform() { const x = j(localStorage.getItem(`${filterKey()}:view`) || ''); return x && Number.isFinite(Number(x.x)) && Number.isFinite(Number(x.y)) && Number.isFinite(Number(x.k)) ? { x: Number(x.x), y: Number(x.y), k: Number(x.k) } : null; }

function fit(preserve = true) {
    if (!S.v || !S.l) return;
    if (preserve && S.manual) return setTransform(S.t);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of S.v.nodes) {
        const p = S.l.pos.get(n.id); if (!p) continue; const r = n.id === S.g.centerNodeId ? 36 : 24; const lw = n.id === S.g.centerNodeId ? 130 : 150;
        minX = Math.min(minX, p.x - r - lw); maxX = Math.max(maxX, p.x + r + lw); minY = Math.min(minY, p.y - r - 32); maxY = Math.max(maxY, p.y + r + 32);
    }
    if (!Number.isFinite(minX)) { minX = -120; maxX = 120; minY = -120; maxY = 120; }
    const pad = Math.min(S.vp.w, S.vp.h) < 560 ? 28 : 48; const w = Math.max(100, maxX - minX); const h2 = Math.max(100, maxY - minY); const k = clamp(Math.min((S.vp.w - pad * 2) / w, (S.vp.h - pad * 2) / h2), .22, 2.2);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const saved = !S.manual ? readTransform() : null;
    if (saved) { S.manual = true; return setTransform(saved); }
    S.manual = false;
    setTransform({ x: S.vp.w / 2 - cx * k, y: S.vp.h / 2 - cy * k, k });
}

function zoom(f, p = null) {
    const q = p || { x: S.vp.w / 2, y: S.vp.h / 2 }; const k2 = clamp(S.t.k * f, .18, 5); const wx = (q.x - S.t.x) / S.t.k; const wy = (q.y - S.t.y) / S.t.k;
    S.manual = true;
    setTransform({ x: q.x - wx * k2, y: q.y - wy * k2, k: k2 }, true);
}

function render() {
    clr(S.r.relationsWorld);
    if (!S.g) return overlay({ loading: false, empty: true, text: '尚無關係資料。' });
    if (!S.v?.nodes?.length) return overlay({ loading: false, empty: true, text: '目前篩選條件已隱藏所有關係。' });
    overlay({ loading: false, empty: false });
    const { nodeById, pEdges } = indexes(S.g);
    const grid = svg('g', { opacity: .45, 'pointer-events': 'none' });
    for (const r of [220, 305, 385, 490, 600]) grid.appendChild(svg('circle', { cx: 0, cy: 0, r, fill: 'none', stroke: '#94a3b8', 'stroke-width': 1, 'stroke-dasharray': r === 220 ? '6 5' : '4 6' }));
    const eLayer = svg('g'), lLayer = svg('g'), nLayer = svg('g'); const showELabel = S.v.edges.length <= 28;
    for (const e of S.v.edges) {
        const a = S.l.pos.get(e.source), b = S.l.pos.get(e.target); if (!a || !b) continue; const m = info(e.type); const pe = e.source === S.g.centerNodeId || e.target === S.g.centerNodeId;
        const line = svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: m.color, 'stroke-width': pe ? 2.6 : 1.9, opacity: pe ? .9 : .72, 'stroke-linecap': 'round', 'stroke-dasharray': e.type === 'unfamiliar' ? '4 5' : (e.type === 'faction' ? '7 5' : null) });
        const tt = svg('title'); tt.textContent = `${e.label}：${nodeById.get(e.source)?.name || e.source} ↔ ${nodeById.get(e.target)?.name || e.target}`; line.appendChild(tt); eLayer.appendChild(line);
        if (showELabel && !pe) {
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, tx = mx + nx * 12, ty = my + ny * 12;
            const txt = (str(e.label) || m.label).slice(0, 8), w = Math.max(22, txt.length * 12);
            lLayer.appendChild(svg('rect', { x: tx - w / 2, y: ty - 9, width: w, height: 18, rx: 7, ry: 7, fill: 'rgba(255,255,255,0.82)', stroke: m.color, 'stroke-width': 1 }));
            const t = svg('text', { x: tx, y: ty, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 10, 'font-weight': 600, fill: '#334155' }); t.textContent = txt; lLayer.appendChild(t);
        }
    }
    const nodes = [...S.v.nodes].sort((a, b) => (a.id === S.g.centerNodeId ? 1 : b.id === S.g.centerNodeId ? -1 : ((S.l.pos.get(a.id)?.y || 0) - (S.l.pos.get(b.id)?.y || 0))));
    for (const n of nodes) {
        const p = S.l.pos.get(n.id); if (!p) continue; const isP = n.id === S.g.centerNodeId; const t = isP ? 'other' : pType(n, pEdges.get(n.id)); const m = isP ? { label: '主角', color: '#b45309' } : info(t); const r = isP ? 21 : (n.inCurrentScene ? 15 : 13);
        const g = svg('g', { transform: `translate(${p.x} ${p.y})`, cursor: n.kind === 'npc' ? 'pointer' : 'default' });
        g.appendChild(svg('circle', { cx: 0, cy: 0, r: r + 6, fill: m.color, opacity: isP ? .22 : .12 }));
        g.appendChild(svg('circle', { cx: 0, cy: 0, r, fill: isP ? '#f9d48d' : (n.isDeceased ? 'rgba(148,163,184,0.30)' : 'rgba(255,255,255,0.92)'), stroke: m.color, 'stroke-width': isP ? 3 : 2.2 }));
        if (isP) { const mk = svg('text', { x: 0, y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 14, 'font-weight': 700, fill: '#7c2d12' }); mk.textContent = '主'; g.appendChild(mk); }
        else g.appendChild(svg('circle', { cx: r - 2, cy: -(r - 2), r: 3.5, fill: n.inCurrentScene ? '#f59e0b' : (n.isDeceased ? '#94a3b8' : '#22c55e'), stroke: '#fff', 'stroke-width': 1 }));
        const tt = svg('title'); tt.textContent = [n.name, n.statusTitle ? `身份：${n.statusTitle}` : '', n.allegiance ? `門派：${n.allegiance}` : '', n.kind === 'npc' ? `好感：${n.friendlinessValue}` : '', n.kind === 'npc' ? `心動：${n.romanceValue}` : '', n.inCurrentScene ? '目前在場' : '', n.isDeceased ? '已死亡' : ''].filter(Boolean).join('\n'); g.appendChild(tt);
        const anc = p.x >= 0 ? 'start' : 'end', tx = p.x >= 0 ? r + 8 : -(r + 8);
        const main = svg('text', { class: 'node-label-main', x: tx, y: -4, 'text-anchor': anc, fill: isP ? '#7c2d12' : '#0f172a' }); main.textContent = n.label.length > 9 ? `${n.label.slice(0, 8)}…` : n.label;
        const subText = n.statusTitle || (n.allegiance ? `門派：${n.allegiance}` : m.label);
        const sub = svg('text', { class: 'node-label-sub', x: tx, y: 11, 'text-anchor': anc }); sub.textContent = subText.length > 10 ? `${subText.slice(0, 9)}…` : subText;
        g.append(main, sub);
        if (n.kind === 'npc') g.addEventListener('click', () => { if (Date.now() < S.clickLock) return; showPortrait(n.name); });
        nLayer.appendChild(g);
    }
    S.r.relationsWorld.append(grid, eLayer, lLayer, nLayer);
}

function refresh(preserve = true) { computeVisible(); updateMeta(); drawLegendFilters(); viewport(); render(); fit(preserve); }
function setGraph(g, src, stat, fromCache = false) { S.g = g; S.l = layout(g); setSrc(src); setGS(stat); if (!fromCache) S.manual = false; refresh(fromCache); }

async function load({ force = false } = {}) {
    if (force) { overlay({ loading: true }); setTop('正在重新載入關係圖...'); setGS('重新載入中'); }
    else if (S.g) { setTop('已載入快取，正在檢查更新...'); setGS('檢查更新中'); }
    else { overlay({ loading: true }); setTop('正在載入關係圖...'); setGS('載入中'); }
    try {
        const g = norm(await api.getRelations()); if (!g) throw new Error('關係圖資料格式錯誤');
        const changed = force || !S.g || g.cacheKey !== S.g.cacheKey; writeCache(g);
        if (changed) setGraph(g, '伺服器', force ? '已重新載入並更新' : (S.g ? '檢測到新變動，已更新' : '已從伺服器載入'));
        else { overlay({ loading: false, empty: false }); setSrc('快取 + 伺服器確認'); setGS('資料無變更（沿用目前畫面）'); }
        const t = new Date().toLocaleTimeString('zh-TW', { hour12: false });
        setTop(changed ? `已同步最新資料（${t}）` : `已檢查完成，資料未變更（${t}）`);
    } catch (e) {
        console.error('載入人物關係圖失敗:', e);
        if (!S.g) overlay({ loading: false, empty: true, text: `載入失敗：${e.message}` }); else overlay({ loading: false, empty: false });
        setGS('載入失敗'); setTop(S.g ? '伺服器連線失敗，已保留快取畫面' : '載入失敗');
    }
}

async function showPortrait(name) {
    const { portraitModal, portraitImage, portraitName, portraitTitle } = S.r;
    portraitModal?.classList.add('visible');
    if (!portraitImage || !portraitName || !portraitTitle) return;
    portraitName.textContent = '載入中...'; portraitTitle.textContent = '正在整理人物資料'; clr(portraitImage);
    portraitImage.appendChild(Object.assign(document.createElement('i'), { className: 'fas fa-spinner fa-spin fa-2x' }));
    try {
        if (name === S.u) {
            portraitName.textContent = S.u; portraitTitle.textContent = '主角'; clr(portraitImage);
            const span = document.createElement('span'); span.innerHTML = '<i class="fas fa-user-circle"></i> 玩家'; portraitImage.appendChild(span); return;
        }
        const p = await api.getNpcProfile(name); portraitName.textContent = str(p?.name).trim() || name; portraitTitle.textContent = str(p?.status_title).trim() || '身份不明'; clr(portraitImage);
        if (p?.avatarUrl) { const img = document.createElement('img'); img.src = p.avatarUrl; img.alt = portraitName.textContent; portraitImage.appendChild(img); }
        else { const span = document.createElement('span'); span.innerHTML = '<i class="fas fa-image"></i> 暫無頭像'; portraitImage.appendChild(span); }
    } catch (e) {
        console.error('載入 NPC 頭像失敗:', e); portraitName.textContent = name; portraitTitle.textContent = '載入失敗'; clr(portraitImage);
        const span = document.createElement('span'); span.innerHTML = '<i class="fas fa-exclamation-triangle"></i> 無法取得人物資料'; portraitImage.appendChild(span);
    }
}

function bind() {
    S.r.portraitModal?.addEventListener('click', (e) => { if (e.target === S.r.portraitModal) S.r.portraitModal.classList.remove('visible'); });
    S.r.relationTypeFilters?.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-type]'); if (!b) return; const t = b.dataset.type; if (!t) return;
        if (S.hidden.has(t)) S.hidden.delete(t); else S.hidden.add(t); writeHidden(); setGS('已更新顯示類型'); refresh(true);
    });
    S.r.filterResetBtn?.addEventListener('click', () => { S.hidden.clear(); writeHidden(); setGS('已顯示全部關係類型'); refresh(true); });
    S.r.zoomInBtn?.addEventListener('click', () => zoom(1.15));
    S.r.zoomOutBtn?.addEventListener('click', () => zoom(1 / 1.15));
    S.r.fitBtn?.addEventListener('click', () => { S.manual = false; viewport(); fit(false); });
    S.r.resetViewBtn?.addEventListener('click', () => { S.manual = true; viewport(); setTransform({ x: S.vp.w / 2, y: S.vp.h / 2, k: 1 }, true); });
    S.r.refreshRelationsBtn?.addEventListener('click', () => load({ force: true }));
    S.r.relationsSvg?.addEventListener('wheel', (e) => { e.preventDefault(); const r = S.r.relationsSvg.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.08 : 1 / 1.08, { x: e.clientX - r.left, y: e.clientY - r.top }); }, { passive: false });
    S.r.relationsSvg?.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; S.drag = { on: true, id: e.pointerId, sx: e.clientX, sy: e.clientY, bx: S.t.x, by: S.t.y }; S.r.relationsContent?.classList.add('is-dragging'); S.r.relationsSvg?.setPointerCapture?.(e.pointerId); });
    S.r.relationsSvg?.addEventListener('pointermove', (e) => { if (!S.drag.on || S.drag.id !== e.pointerId) return; const dx = e.clientX - S.drag.sx, dy = e.clientY - S.drag.sy; if (Math.abs(dx) > 3 || Math.abs(dy) > 3) S.clickLock = Date.now() + 120; S.manual = true; setTransform({ x: S.drag.bx + dx, y: S.drag.by + dy, k: S.t.k }); });
    const end = (e) => { if (!S.drag.on) return; if (e && S.drag.id != null && e.pointerId !== S.drag.id) return; S.drag.on = false; S.drag.id = null; S.r.relationsContent?.classList.remove('is-dragging'); if (S.manual) setTransform(S.t, true); };
    S.r.relationsSvg?.addEventListener('pointerup', end); S.r.relationsSvg?.addEventListener('pointercancel', end); S.r.relationsSvg?.addEventListener('pointerleave', (e) => { if ((e.buttons & 1) === 0) end(e); });
    let rt = null; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { viewport(); render(); fit(true); }, 120); });
}

function refs() {
    S.r = {
        relationsTitle: $('relations-title'),
        cacheStatus: $('cache-status'),
        relationTypeFilters: $('relation-type-filters'),
        filterResetBtn: $('filter-reset-btn'),
        zoomInBtn: $('zoom-in-btn'),
        zoomOutBtn: $('zoom-out-btn'),
        fitBtn: $('fit-btn'),
        resetViewBtn: $('reset-view-btn'),
        refreshRelationsBtn: $('refresh-relations-btn'),
        relationsContent: $('relations-content'),
        relationsSvg: $('relations-svg'),
        relationsWorld: $('relations-world'),
        graphLoadingOverlay: $('graph-loading-overlay'),
        graphEmptyOverlay: $('graph-empty-overlay'),
        graphEmptyText: $('graph-empty-text'),
        graphMeta: $('graph-meta'),
        graphLegend: $('graph-legend'),
        graphSource: $('graph-source'),
        graphStatusText: $('graph-status-text'),
        portraitModal: $('portrait-modal'),
        portraitImage: $('portrait-image'),
        portraitName: $('portrait-name'),
        portraitTitle: $('portrait-title')
    };
}

async function init() {
    ensureLocalPreviewAuthSession();
    refs();
    bind();
    const token = localStorage.getItem('jwt_token');
    if (!token) { window.location.href = 'login.html'; return; }
    S.u = localStorage.getItem('username') || '主角';
    S.hidden = readHidden();
    if (S.r.relationsTitle) S.r.relationsTitle.textContent = `${S.u} 的人物關係圖`;
    viewport();
    setTransform({ x: S.vp.w / 2, y: S.vp.h / 2, k: 1 });
    const c = readCache();
    if (c?.graph) {
        const g = norm({ graph: c.graph });
        if (g) {
            setGraph(g, '本地快取', '已載入快取資料', true);
            const t = c.savedAt ? new Date(c.savedAt).toLocaleTimeString('zh-TW', { hour12: false }) : '未知時間';
            setTop(`已載入快取（${t}）`);
        }
    }
    await load();
}

document.addEventListener('DOMContentLoaded', init);
