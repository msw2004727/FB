// scripts/gmManager.js
// GM 面板：所有動態資料一律透過 textContent / DOM API 寫入，避免匯入資料造成 XSS。
import { api } from './api.js';
import * as gameEngine from '../client/engine/gameEngine.js';

let _gmPanel;
let _gmMenu;
let _gmContent;

export function initializeGmPanel(panel, closeBtn, menu, content) {
    _gmPanel = panel;
    _gmMenu = menu;
    _gmContent = content;
    if (!panel || !menu || !content) return;

    closeBtn?.addEventListener('click', () => panel.classList.remove('visible'));

    menu.addEventListener('click', (event) => {
        const link = event.target.closest('a');
        if (!link || !menu.contains(link)) return;
        event.preventDefault();
        menu.querySelectorAll('a').forEach((item) => item.classList.remove('active'));
        link.classList.add('active');
        loadPageContent(link.getAttribute('href')?.slice(1));
    });

    const firstLink = menu.querySelector('a');
    if (firstLink) {
        firstLink.classList.add('active');
        loadPageContent(firstLink.getAttribute('href')?.slice(1));
    }
}

function clearContent() {
    _gmContent?.replaceChildren();
}

function appendTitle(iconClass, text) {
    const title = document.createElement('h3');
    const icon = document.createElement('i');
    icon.className = iconClass;
    icon.setAttribute('aria-hidden', 'true');
    title.append(icon, document.createTextNode(` ${text}`));
    _gmContent.append(title);
    return title;
}

function showMessage(text, className = '') {
    clearContent();
    const message = document.createElement('p');
    if (className) message.className = className;
    message.textContent = text;
    _gmContent.append(message);
}

function createButton(id, label, iconClass, className = 'gm-button') {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.className = className;
    const icon = document.createElement('i');
    icon.className = iconClass;
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon, document.createTextNode(` ${label}`));
    return button;
}

async function loadPageContent(pageId) {
    if (!_gmContent) return;
    switch (pageId) {
        case 'player-stats':
            return loadPlayerStats();
        case 'character-manage':
            return loadCharacterManage();
        case 'locations':
            return loadLocations();
        default:
            showMessage('此功能尚未開放。');
    }
}

async function loadPlayerStats() {
    showMessage('載入中…', 'loading-text');
    try {
        const state = await api.getPlayerStateForGM();
        clearContent();
        appendTitle('fa-solid fa-user-pen', '玩家屬性');

        const section = document.createElement('div');
        section.className = 'gm-form-section';
        const group = document.createElement('div');
        group.className = 'gm-input-group';
        const label = document.createElement('label');
        label.htmlFor = 'gm-morality';
        label.textContent = '立場傾向 (-100 ~ 100)';
        const input = document.createElement('input');
        input.type = 'number';
        input.id = 'gm-morality';
        input.className = 'gm-input';
        input.value = String(Number.isFinite(Number(state?.morality)) ? Number(state.morality) : 0);
        input.min = '-100';
        input.max = '100';
        const saveButton = createButton(
            'gm-save-morality',
            '儲存',
            'fa-solid fa-floppy-disk',
            'gm-button save'
        );
        group.append(label, input, saveButton);
        section.append(group);
        _gmContent.append(section);

        saveButton.addEventListener('click', async () => {
            const value = Number.parseInt(input.value, 10);
            if (Number.isNaN(value)) return alert('請輸入有效的數字。');
            const clamped = Math.max(-100, Math.min(100, value));
            await api.updatePlayerStateForGM({ morality: clamped });
            input.value = String(clamped);
            alert(`立場傾向已設定為 ${clamped}`);
        });
    } catch (error) {
        showMessage('載入失敗。', 'error-message');
        console.error('[GM] loadPlayerStats error:', error);
    }
}

async function loadCharacterManage() {
    showMessage('載入中…', 'loading-text');
    try {
        const state = await api.getPlayerStateForGM();
        const currentName = state?.username || localStorage.getItem('username') || '無名氏';
        clearContent();
        appendTitle('fa-solid fa-id-card', '角色管理');

        const renameSection = document.createElement('div');
        renameSection.className = 'gm-form-section';
        const group = document.createElement('div');
        group.className = 'gm-input-group';
        const label = document.createElement('label');
        label.htmlFor = 'gm-rename';
        label.textContent = '角色名稱（1-8 字）';
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'gm-rename';
        input.className = 'gm-input';
        input.value = String(currentName).slice(0, 8);
        input.maxLength = 8;
        input.autocomplete = 'off';
        const renameButton = createButton('gm-save-rename', '改名', 'fa-solid fa-pen', 'gm-button save');
        group.append(label, input, renameButton);
        renameSection.append(group);
        _gmContent.append(renameSection);

        const divider = document.createElement('hr');
        divider.style.cssText = 'border-color:#333;margin:1.5rem 0;';
        _gmContent.append(divider);

        const restartSection = document.createElement('div');
        restartSection.className = 'gm-form-section';
        const warningTitle = document.createElement('h4');
        warningTitle.style.color = '#e74c3c';
        warningTitle.textContent = '危險操作';
        const warning = document.createElement('p');
        warning.style.cssText = 'font-size:.85rem;opacity:.6;margin-bottom:.8rem;';
        warning.textContent = '重新開始會清除目前角色的存檔、小說章節與記憶；角色名稱會保留。此操作無法復原。';
        const restartButton = createButton(
            'gm-restart-game',
            '重新開始遊戲',
            'fa-solid fa-rotate-right'
        );
        restartButton.style.background = '#e74c3c';
        restartSection.append(warningTitle, warning, restartButton);
        _gmContent.append(restartSection);

        renameButton.addEventListener('click', async () => {
            const newName = input.value.trim();
            if (!newName || newName.length > 8) return alert('名稱需為 1-8 個字。');
            try {
                await gameEngine.renamePlayer(newName);
                alert(`改名成功：${newName}`);
                document.querySelectorAll('[data-player-name]').forEach((element) => {
                    element.textContent = newName;
                });
            } catch (error) {
                alert(`改名失敗：${error.message}`);
            }
        });

        restartButton.addEventListener('click', async () => {
            if (!confirm('確定要重新開始嗎？\n\n目前的存檔、小說章節與記憶都會被清除，且無法復原。')) return;
            if (!confirm('最後確認：真的要重新開始遊戲嗎？')) return;
            try {
                await gameEngine.startNewGame();
                alert('已重新開始遊戲，頁面即將重新載入。');
                window.location.reload();
            } catch (error) {
                alert(`重新開始失敗：${error.message}`);
            }
        });
    } catch (error) {
        showMessage('載入失敗。', 'error-message');
        console.error('[GM] loadCharacterManage error:', error);
    }
}

async function loadLocations() {
    showMessage('載入中…', 'loading-text');
    try {
        const locations = await api.getLocationsForGM();
        clearContent();
        appendTitle('fa-solid fa-map', locations?.length ? '已探索地點' : '地點');
        if (!locations?.length) {
            const empty = document.createElement('p');
            empty.textContent = '目前尚未探索任何地點。';
            _gmContent.append(empty);
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'gm-card-grid';
        locations.forEach((location) => {
            const card = document.createElement('div');
            card.className = 'gm-card';
            const header = document.createElement('div');
            header.className = 'gm-card-header';
            const name = document.createElement('h4');
            name.textContent = String(location?.locationName || location?.name || '未知地點');
            header.append(name);
            card.append(header);
            grid.append(card);
        });
        _gmContent.append(grid);
    } catch (error) {
        showMessage('載入失敗。', 'error-message');
        console.error('[GM] loadLocations error:', error);
    }
}
