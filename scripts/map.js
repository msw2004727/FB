import { api } from './api.js';
import { ensureLocalPreviewAuthSession } from './localPreviewMode.js';

document.addEventListener('DOMContentLoaded', () => {
    initializeMapPage().catch(error => {
        console.error('[Map Page] Initialization failed:', error);
        const mapContent = document.getElementById('map-content');
        if (mapContent) {
            mapContent.innerHTML = `<p class="loading-text">錯誤：地圖初始化失敗。<br>(${error.message || error})</p>`;
        }
    });
});

async function initializeMapPage() {
    ensureLocalPreviewAuthSession();

    const mapContent = document.getElementById('map-content');
    const mapContainer = document.querySelector('.map-container');
    if (!mapContent || !mapContainer) return;

    const token = localStorage.getItem('jwt_token');
    if (!token) {
        mapContent.innerHTML = '<p class="loading-text">尚未登入，正在返回登入頁...</p>';
        setTimeout(() => { window.location.href = 'login.html'; }, 1500);
        return;
    }

    const { toolbarEl, metaEl } = ensureMapUiElements(mapContainer, mapContent);

    try {
        const data = await api.getMap();
        const normalized = normalizeMapPayload(data);

        renderMapToolbar(toolbarEl, normalized);
        renderMapMeta(metaEl, normalized.meta);

        const initialViewKey = normalized.defaultView || normalized.viewOrder[0];
        await renderSelectedView(normalized, initialViewKey, mapContent, toolbarEl);
    } catch (error) {
        console.error('[Map Page] Failed to load map:', error);
        const message = String(error?.message || error || 'Unknown error');

        if (/unsupported endpoint/i.test(message) && message.includes('/api/map/world-map')) {
            mapContent.innerHTML = '<p class="loading-text">本地預覽 mock 已啟用，但地圖 API 尚未載入完成。請重新整理頁面再試一次。</p>';
            return;
        }

        mapContent.innerHTML = `<p class="loading-text">錯誤：輿圖司的繪圖師似乎喝醉了，無法提供地圖。<br>(${message})</p>`;
    }
}

function ensureMapUiElements(mapContainer, mapContent) {
    let toolbarEl = document.getElementById('map-toolbar');
    if (!toolbarEl) {
        toolbarEl = document.createElement('div');
        toolbarEl.id = 'map-toolbar';
        toolbarEl.className = 'map-toolbar';
        mapContainer.insertBefore(toolbarEl, mapContent);
    }

    let metaEl = document.getElementById('map-meta');
    if (!metaEl) {
        metaEl = document.createElement('div');
        metaEl.id = 'map-meta';
        metaEl.className = 'map-meta';
        mapContainer.insertBefore(metaEl, mapContent);
    }

    return { toolbarEl, metaEl };
}

function normalizeMapPayload(data) {
    if (data && data.views && typeof data.views === 'object') {
        const views = {};
        const viewOrder = [];
        for (const [key, view] of Object.entries(data.views)) {
            if (!view || typeof view.mermaidSyntax !== 'string') continue;
            views[key] = {
                key,
                title: view.title || key,
                mermaidSyntax: view.mermaidSyntax,
                nodes: Array.isArray(view.nodes) ? view.nodes : [],
                edges: Array.isArray(view.edges) ? view.edges : [],
            };
            viewOrder.push(key);
        }
        if (viewOrder.length > 0) {
            return {
                defaultView: data.defaultView && views[data.defaultView] ? data.defaultView : viewOrder[0],
                views,
                viewOrder,
                meta: data.meta || null,
            };
        }
    }

    const legacySyntax = String(data?.mermaidSyntax || '').trim();
    if (!legacySyntax) {
        throw new Error('地圖資料格式錯誤：缺少 mermaidSyntax');
    }

    return {
        defaultView: 'default',
        viewOrder: ['default'],
        views: {
            default: {
                key: 'default',
                title: '地圖',
                mermaidSyntax: legacySyntax,
                nodes: [],
                edges: [],
            },
        },
        meta: null,
    };
}

function renderMapToolbar(toolbarEl, payload) {
    if (!toolbarEl) return;

    toolbarEl.innerHTML = '';
    if (!payload || payload.viewOrder.length <= 1) {
        toolbarEl.hidden = true;
        return;
    }

    const label = document.createElement('span');
    label.className = 'map-toolbar-label';
    label.textContent = '地圖視圖';
    toolbarEl.appendChild(label);

    for (const key of payload.viewOrder) {
        const view = payload.views[key];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'map-view-btn';
        button.dataset.viewKey = key;
        button.textContent = view.title || key;
        toolbarEl.appendChild(button);
    }

    toolbarEl.hidden = false;
}

function renderMapMeta(metaEl, meta) {
    if (!metaEl) return;

    if (!meta || typeof meta !== 'object') {
        metaEl.hidden = true;
        metaEl.textContent = '';
        return;
    }

    const chips = [
        `已探索 ${Number(meta.discoveredCount) || 0}`,
        `顯示節點 ${Number(meta.renderedNodeCount) || 0}`,
        `補全節點 ${Number(meta.contextNodeCount) || 0}`,
        `階層線 ${Number(meta.hierarchyEdgeCount) || 0}`,
        `鄰接線 ${Number(meta.adjacencyEdgeCount) || 0}`,
    ];

    metaEl.textContent = chips.join(' ・ ');
    metaEl.hidden = false;
}

function setActiveToolbarButton(toolbarEl, activeKey) {
    if (!toolbarEl) return;
    toolbarEl.querySelectorAll('.map-view-btn').forEach(button => {
        const isActive = button.dataset.viewKey === activeKey;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
}

async function renderSelectedView(payload, viewKey, mapContent, toolbarEl) {
    const view = payload.views[viewKey];
    if (!view) throw new Error(`未知地圖視圖：${viewKey}`);

    setActiveToolbarButton(toolbarEl, viewKey);

    if (!window.mermaid || typeof window.mermaid.run !== 'function') {
        throw new Error('Mermaid 載入失敗（CDN 或網路問題）');
    }

    mapContent.innerHTML = '';
    const mermaidContainer = document.createElement('div');
    mermaidContainer.className = 'mermaid';
    mermaidContainer.textContent = view.mermaidSyntax;
    mapContent.appendChild(mermaidContainer);

    await window.mermaid.run();

    if (toolbarEl) {
        toolbarEl.onclick = async (event) => {
            const button = event.target.closest('.map-view-btn');
            if (!button) return;
            const nextViewKey = button.dataset.viewKey;
            if (!nextViewKey || nextViewKey === viewKey) return;
            await renderSelectedView(payload, nextViewKey, mapContent, toolbarEl);
        };
    }
}
