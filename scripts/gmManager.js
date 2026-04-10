// scripts/gmManager.js
// GM 面板 — 精簡版，僅保留可用功能
import { api } from './api.js';

let _gmPanel, _gmCloseBtn, _gmMenu, _gmContent;

export function initializeGmPanel(panel, closeBtn, menu, content) {
    _gmPanel = panel;
    _gmCloseBtn = closeBtn;
    _gmMenu = menu;
    _gmContent = content;
    if (!panel || !menu || !content) return;

    if (closeBtn) {
        closeBtn.addEventListener('click', () => panel.classList.remove('visible'));
    }

    menu.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (!link) return;
        e.preventDefault();
        menu.querySelectorAll('a').forEach(a => a.classList.remove('active'));
        link.classList.add('active');
        const pageId = link.getAttribute('href').substring(1);
        loadPageContent(pageId);
    });

    // 預設載入第一頁
    const firstLink = menu.querySelector('a');
    if (firstLink) {
        firstLink.classList.add('active');
        loadPageContent(firstLink.getAttribute('href').substring(1));
    }
}

async function loadPageContent(pageId) {
    if (!_gmContent) return;
    switch (pageId) {
        case 'player-stats': return loadPlayerStats();
        case 'locations': return loadLocations();
        default:
            _gmContent.innerHTML = `<p style="text-align:center;opacity:.5;">此功能尚未啟用</p>`;
    }
}

// --- 玩家屬性編輯（僅立場） ---
async function loadPlayerStats() {
    _gmContent.innerHTML = '<p class="loading-text">載入中...</p>';
    try {
        const state = await api.getPlayerStateForGM();
        _gmContent.innerHTML = `
            <h3><i class="fa-solid fa-user-pen"></i> 玩家屬性</h3>
            <div class="gm-form-section">
                <div class="gm-input-group">
                    <label for="gm-morality">立場傾向 (-100 ~ 100)</label>
                    <input type="number" id="gm-morality" class="gm-input" value="${state.morality || 0}" min="-100" max="100">
                    <button id="gm-save-morality" class="gm-button save"><i class="fa-solid fa-floppy-disk"></i> 儲存</button>
                </div>
            </div>
        `;
        document.getElementById('gm-save-morality').addEventListener('click', async () => {
            const val = parseInt(document.getElementById('gm-morality').value, 10);
            if (isNaN(val)) return alert('請輸入有效數字');
            const clamped = Math.max(-100, Math.min(100, val));
            await api.updatePlayerStateForGM({ morality: clamped });
            alert(`立場已設為 ${clamped}`);
        });
    } catch (error) {
        _gmContent.innerHTML = `<p class="error-message">載入失敗</p>`;
        console.error('[GM] loadPlayerStats error:', error);
    }
}

// --- 地點查看 ---
async function loadLocations() {
    _gmContent.innerHTML = '<p class="loading-text">載入中...</p>';
    try {
        const locations = await api.getLocationsForGM();
        if (!locations || locations.length === 0) {
            _gmContent.innerHTML = '<h3><i class="fa-solid fa-map"></i> 地點</h3><p>尚無已探索的地點</p>';
            return;
        }
        let html = '<h3><i class="fa-solid fa-map"></i> 已探索地點</h3><div class="gm-card-grid">';
        locations.forEach(loc => {
            const name = loc.locationName || loc.name || '未知';
            html += `<div class="gm-card"><div class="gm-card-header"><h4>${escapeHtml(name)}</h4></div></div>`;
        });
        html += '</div>';
        _gmContent.innerHTML = html;
    } catch (error) {
        _gmContent.innerHTML = `<p class="error-message">載入失敗</p>`;
        console.error('[GM] loadLocations error:', error);
    }
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
