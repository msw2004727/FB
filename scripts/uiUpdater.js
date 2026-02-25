// scripts/uiUpdater.js
import { MAX_POWER } from './config.js';
import { api } from './api.js';
import { gameState } from './gameState.js';
import { DEFAULT_AI_MODEL, resetAiModelSelectionToDefault } from './aiModelPreference.js';

// --- DOM元素獲取 ---
const storyPanelWrapper = document.querySelector('.story-panel');
const storyTextContainer = document.getElementById('story-text-wrapper');
const statusBarEl = document.getElementById('status-bar');
const pcContent = document.getElementById('pc-content');
const internalPowerBar = document.getElementById('internal-power-bar');
const internalPowerValue = document.getElementById('internal-power-value');
const externalPowerBar = document.getElementById('external-power-bar');
const externalPowerValue = document.getElementById('external-power-value');
const lightnessPowerBar = document.getElementById('lightness-power-bar');
const lightnessPowerValue = document.getElementById('lightness-power-value');
const staminaBar = document.getElementById('stamina-bar');
const staminaValue = document.getElementById('stamina-value');
const moralityBarIndicator = document.getElementById('morality-bar-indicator');
const locationInfo = document.getElementById('location-info'); 
const npcContent = document.getElementById('npc-content');
const itmContent = document.getElementById('itm-content');
const bulkStatus = document.getElementById('bulk-status');
const qstContent = document.getElementById('qst-content');
const psyContent = document.getElementById('psy-content');
const clsContent = document.getElementById('cls-content');
const actionSuggestion = document.getElementById('action-suggestion');
const moneyContent = document.getElementById('money-content');

// --- 圖示對照表 ---
const slotConfig = {
    head: { icon: 'fa-user-ninja' },
    body: { icon: 'fa-user-shield' },
    hands: { icon: 'fa-hand-rock' },
    feet: { icon: 'fa-shoe-prints' },
    accessory1: { icon: 'fa-ring' },
    accessory2: { icon: 'fa-ring' },
    manuscript: { icon: 'fa-book' },
    weapon_right: { icon: 'fa-gavel' },
    weapon_left: { icon: 'fa-gavel' },
    weapon_back: { icon: 'fa-archive' },
};

const itemTypeConfig = {
    '武器': { icon: 'fa-gavel' },
    '裝備': { icon: 'fa-user-shield' },
    '秘笈': { icon: 'fa-book-reader' },
    '書籍': { icon: 'fa-book' },
    '道具': { icon: 'fa-flask-potion' },
    '材料': { icon: 'fa-gem' },
    '財寶': { icon: 'fa-coins' },
    '其他': { icon: 'fa-box' }
};
const CURRENCY_NAME_PRIORITY = ['\u9ec3\u91d1', '\u91d1\u689d', '\u91d1\u5e63', '\u9280\u7968', '\u9280\u5169', '\u788e\u9280', '\u9280\u5e63', '\u9285\u9322', '\u9285\u5e63'];
const CURRENCY_NAME_KEYWORDS = ['\u9ec3\u91d1', '\u91d1\u689d', '\u91d1\u5e63', '\u9280\u7968', '\u9280\u5169', '\u788e\u9280', '\u9280\u5e63', '\u9285\u9322', '\u9285\u5e63', '\u5143\u5bf6'];
const CURRENCY_TYPE_KEYWORDS = ['\u8ca1\u5bf6', '\u8ca8\u5e63', '\u91d1\u9322'];
const CURRENCY_CATEGORY_KEYWORDS = ['\u8ca8\u5e63', '\u8ca1\u5bf6'];

// 【規則修正】調整裝備顯示順序，以符合 "左腰 > 右腰 > 背後" 的規則
const equipOrder = ['weapon_left', 'weapon_right', 'weapon_back', 'head', 'body', 'hands', 'feet', 'accessory1', 'accessory2', 'manuscript'];

// --- UI 更新核心函式 ---

export function updateUI(storyText, roundData, randomEvent, locationData) {
    if (randomEvent && randomEvent.description) {
        const eventDiv = document.createElement('div');
        eventDiv.className = 'random-event-message';
        const eventLabel = document.createElement('strong');
        eventLabel.textContent = '【奇遇】';
        eventDiv.appendChild(eventLabel);
        eventDiv.append(` ${String(randomEvent.description)}`);
        storyTextContainer.appendChild(eventDiv);
    }

    if (storyText) {
        const processedStory = highlightNpcNames(storyText, roundData.NPC);
        appendMessageToStory(processedStory, 'story-text', { allowHtml: true });
    }
    if (!roundData) return;

    updateStatusBar(roundData);
    pcContent.textContent = roundData.PC || '狀態穩定';
    updateDeathCountdownUI(roundData.deathCountdown);
    updatePowerBars(roundData);
    updateMoralityBar(roundData.morality);
    updateBulkStatus(roundData.bulkScore || 0); 
    updateLocationInfo(locationData);
    updateNpcList(roundData.NPC);
    renderInventory(roundData.inventory);
    updateMoneyBagDisplay(roundData.inventory);

    qstContent.textContent = roundData.QST || '暫無要事';
    psyContent.textContent = roundData.PSY || '心如止水';
    clsContent.textContent = roundData.CLS || '尚無線索';
    actionSuggestion.textContent = roundData.suggestion ? `書僮小聲說：${roundData.suggestion}` : '';
}

function getItemDisplayName(item) {
    return String(item?.itemName || item?.templateId || '').trim();
}

function containsKeyword(text, keywords) {
    return keywords.some(keyword => text.includes(keyword));
}

export function isCurrencyItem(item) {
    if (!item || typeof item !== 'object') return false;

    const name = getItemDisplayName(item);
    const itemType = String(item.itemType || '').trim();
    const category = String(item.category || '').trim();

    if (itemType && containsKeyword(itemType, CURRENCY_TYPE_KEYWORDS)) return true;
    if (category && containsKeyword(category, CURRENCY_CATEGORY_KEYWORDS)) return true;
    if (name && containsKeyword(name, CURRENCY_NAME_KEYWORDS)) return true;

    return false;
}

function getCurrencyEntries(inventory) {
    const totals = new Map();

    (inventory || []).forEach((item) => {
        if (!isCurrencyItem(item)) return;
        const amount = Number(item.quantity) || 0;
        if (amount <= 0) return;

        const name = getItemDisplayName(item) || '\u8ca8\u5e63';
        totals.set(name, (totals.get(name) || 0) + amount);
    });

    const priorityIndex = new Map(CURRENCY_NAME_PRIORITY.map((name, index) => [name, index]));

    return [...totals.entries()]
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => {
            const aPriority = priorityIndex.has(a.name) ? priorityIndex.get(a.name) : Number.MAX_SAFE_INTEGER;
            const bPriority = priorityIndex.has(b.name) ? priorityIndex.get(b.name) : Number.MAX_SAFE_INTEGER;
            if (aPriority !== bPriority) return aPriority - bPriority;
            return a.name.localeCompare(b.name, 'zh-Hant');
        });
}

export function updateMoneyBagDisplay(inventory) {
    if (!moneyContent) return;

    const currencyEntries = getCurrencyEntries(inventory);
    if (currencyEntries.length === 0) {
        moneyContent.classList.remove('money-display-list');
        moneyContent.textContent = '\u7121\u8ca8\u5e63';
        return;
    }

    if (currencyEntries.length === 1 && currencyEntries[0].name === '\u9280\u5169') {
        moneyContent.classList.remove('money-display-list');
        moneyContent.textContent = `${currencyEntries[0].amount} \u5169\u9280\u5b50`;
        return;
    }

    moneyContent.classList.add('money-display-list');
    moneyContent.innerHTML = currencyEntries.map((entry) => {
        const safeName = escapeHtml(entry.name);
        return `<div class=\"money-line\"><span class=\"money-name\">${safeName}</span><span class=\"money-amount\">x${entry.amount}</span></div>`;
    }).join('');
}

export function appendMessageToStory(htmlContent, className, options = {}) {
    const p = document.createElement('p');
    if (className) p.className = className;
    const allowHtml = options.allowHtml === true;

    if (allowHtml) {
        p.innerHTML = typeof htmlContent === 'string' ? htmlContent.replace(/\n/g, '<br>') : String(htmlContent ?? '');
    } else {
        const safeText = String(htmlContent ?? '');
        const lines = safeText.split('\n');
        lines.forEach((line, index) => {
            if (index > 0) p.appendChild(document.createElement('br'));
            p.appendChild(document.createTextNode(line));
        });
    }

    storyTextContainer.appendChild(p);
    storyPanelWrapper.scrollTop = storyPanelWrapper.scrollHeight;
}

export function addRoundTitleToStory(titleText) {
    const titleEl = document.createElement('h2');
    titleEl.className = 'round-title';
    titleEl.textContent = titleText;
    storyTextContainer.appendChild(titleEl);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function truncateByChars(value, maxChars) {
    return Array.from(String(value ?? '').trim()).slice(0, maxChars).join('');
}

const ALLOWED_NPC_FRIENDLINESS_CLASSES = new Set([
    'devoted',
    'trusted',
    'friendly',
    'neutral',
    'wary',
    'hostile',
    'sworn_enemy'
]);

function normalizeNpcFriendlinessClass(value) {
    const normalized = String(value || 'neutral').trim();
    return ALLOWED_NPC_FRIENDLINESS_CLASSES.has(normalized) ? normalized : 'neutral';
}

function renderStatusChip(iconClass, label, value) {
    return `
        <div class="status-chip">
            <span class="status-chip-icon" aria-hidden="true"><i class="fas ${iconClass}"></i></span>
            <div class="status-chip-body">
                <span class="status-chip-label">${escapeHtml(label)}</span>
                <span class="status-chip-value">${escapeHtml(value)}</span>
            </div>
        </div>
    `;
}

function renderStatusRow(iconClass, label, value, { multiline = false } = {}) {
    const rowClass = multiline ? 'status-info-row status-info-row-multiline' : 'status-info-row';
    const valueClass = multiline ? 'status-info-value status-info-value-clamp-2' : 'status-info-value';

    return `
        <div class="${rowClass}" title="${escapeHtml(value)}">
            <span class="status-info-icon" aria-hidden="true"><i class="fas ${iconClass}"></i></span>
            <span class="status-info-label">${escapeHtml(label)}</span>
            <span class="${valueClass}">${escapeHtml(value)}</span>
        </div>
    `;
}

function updateStatusBar(roundData) {
    const atmosphere = truncateByChars(roundData.ATM?.[0] || '未知', 8) || '未知';
    const weather = roundData.WRD || '晴朗';
    const location = roundData.LOC?.[0] || '未知之地';
    const dateString = `${roundData.yearName || '元祐'}${roundData.year || 1}年${roundData.month || 1}月${roundData.day || 1}日`;
    const timeString = `約${roundData.timeOfDay || '未知'}`;

    statusBarEl.innerHTML = `
        <div class="status-chip-grid">
            ${renderStatusChip('fa-calendar-alt', '日期', dateString)}
            ${renderStatusChip('fa-clock', '時辰', timeString)}
        </div>
        <div class="status-info-list">
            ${renderStatusRow('fa-cloud-sun', '天氣', weather)}
            ${renderStatusRow('fa-theater-masks', '氛圍', atmosphere)}
            ${renderStatusRow('fa-map-marked-alt', '地點', location, { multiline: true })}
        </div>
    `;
}

function updatePowerBars(roundData) {
    updatePowerBar(internalPowerBar, internalPowerValue, roundData.internalPower, MAX_POWER);
    updatePowerBar(externalPowerBar, externalPowerValue, roundData.externalPower, MAX_POWER);
    updatePowerBar(lightnessPowerBar, lightnessPowerValue, roundData.lightness, MAX_POWER);

    if (staminaBar && staminaValue) {
        const currentStamina = roundData.stamina || 0;
        updatePowerBar(staminaBar, staminaValue, currentStamina, 100);
        
        if (currentStamina < 30) {
            staminaBar.classList.add('pulsing-danger');
        } else {
            staminaBar.classList.remove('pulsing-danger');
        }
    }
}

function updatePowerBar(barEl, valueEl, current, max) {
    if (barEl && valueEl) {
        const safeCurrent = Number.isFinite(Number(current)) ? Number(current) : 0;
        const percentage = Math.max(0, Math.min((safeCurrent / max) * 100, 100));
        barEl.style.width = `${percentage}%`;
        valueEl.textContent = `${safeCurrent}/${max}`;
    }
}

function updateMoralityBar(morality) {
    if (moralityBarIndicator) {
        const safeMorality = Number.isFinite(Number(morality)) ? Number(morality) : 0;
        const percentage = Math.max(0, Math.min(((safeMorality + 100) / 200) * 100, 100));
        moralityBarIndicator.style.left = `${percentage}%`;
        let colorVar;
        if (safeMorality > 10) colorVar = document.body.classList.contains('dark-theme') ? 'var(--morality-justice-dark)' : 'var(--morality-justice-light)';
        else if (safeMorality < -10) colorVar = document.body.classList.contains('dark-theme') ? 'var(--morality-evil-dark)' : 'var(--morality-evil-light)';
        else colorVar = document.body.classList.contains('dark-theme') ? 'var(--dark-text-secondary)' : 'var(--morality-neutral-light)';
        moralityBarIndicator.style.backgroundColor = colorVar;
    }
}

function updateDeathCountdownUI(countdownValue) {
    let countdownEl = document.getElementById('death-countdown-timer');
    if (countdownValue && countdownValue > 0) {
        if (!countdownEl) {
            countdownEl = document.createElement('div');
            countdownEl.id = 'death-countdown-timer';
            countdownEl.className = 'death-countdown';
            pcContent.parentNode.insertBefore(countdownEl, pcContent.nextSibling);
        }
        countdownEl.innerHTML = `<i class="fas fa-hourglass-half"></i> 氣息將絕 (剩餘 ${countdownValue} 回合)`;
    } else if (countdownEl) {
        countdownEl.remove();
    }
}

export function updateBulkStatus(score) {
    if (!bulkStatus) return;
    let emoji = '🎒';
    let text = '輕裝上陣';
    let colorClass = 'bulk-light';
    if (score > 30) { emoji = '🥵'; text = '不堪重負'; colorClass = 'bulk-extreme'; } 
    else if (score > 15) { emoji = '😫'; text = '重物纏身'; colorClass = 'bulk-heavy'; } 
    else if (score > 5) { emoji = '🤔'; text = '略有份量'; colorClass = 'bulk-medium'; }
    bulkStatus.innerHTML = `${emoji} 負重：${text}`;
    bulkStatus.className = `bulk-status-display ${colorClass}`;
}

function updateLocationInfo(locationData) {
    if (!locationInfo) return;

    if (!locationData) {
        locationInfo.innerHTML = '地區情報載入中...';
        return;
    }

    const summary = locationData.summary || locationData.current?.summary || null;
    const rulerName = escapeHtml(summary?.ruler || locationData.governance?.ruler || '未知');
    const locationDescription = escapeHtml(summary?.description || locationData.description || '地區情報載入中...');

    locationInfo.innerHTML = `
        <div class="location-ruler-info"><span class="location-ruler-label">統治者：</span><span class="location-ruler" title="${rulerName}">${rulerName}</span></div>
        <div class="location-desc-container">
            <p class="location-desc">${locationDescription}</p>
            <button id="view-location-details-btn" class="header-icon-btn" title="查看地區詳情">
                <i class="fas fa-info-circle"></i>
            </button>
        </div>
    `;
}

function updateNpcList(npcs) {
    npcContent.innerHTML = '';
    const aliveNpcs = (npcs || []).filter(npc => !npc.isDeceased);
    if (aliveNpcs.length > 0) {
        aliveNpcs.forEach(npc => {
            const npcLine = document.createElement('div');
            const npcName = escapeHtml(npc.name || '未知人物');
            const npcStatus = escapeHtml(npc.status || '狀態不明');
            const friendlinessClass = normalizeNpcFriendlinessClass(npc.friendliness);
            npcLine.innerHTML = `<span class="npc-name npc-${friendlinessClass}" data-npc-name="${npcName}">${npcName}</span>: ${npcStatus}`;
            npcContent.appendChild(npcLine);
        });
    } else {
        npcContent.textContent = '未見人煙';
    }
}

function highlightNpcNames(text, npcs) {
    if (!text) return '';
    let highlightedText = escapeHtml(text);
    if (npcs && Array.isArray(npcs) && npcs.length > 0) {
        const sortedNpcs = [...npcs].sort((a, b) => String(b?.name || '').length - String(a?.name || '').length);
        sortedNpcs.forEach(npc => {
            const rawNpcName = String(npc?.name || '').trim();
            if (!rawNpcName) return;

            const safeNpcName = escapeHtml(rawNpcName);
            const npcNamePattern = safeNpcName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(npcNamePattern, 'g');
            const friendlinessClass = normalizeNpcFriendlinessClass(npc.friendliness);
            const isDeceasedAttr = npc.isDeceased ? ' data-is-deceased="true"' : '';
            const replacement = `<span class="npc-name npc-${friendlinessClass}" data-npc-name="${safeNpcName}"${isDeceasedAttr}>${safeNpcName}</span>`;
            highlightedText = highlightedText.replace(regex, replacement);
        });
    }
    return highlightedText;
}

export function renderInventory(inventory) {
    if (!itmContent) return;
    itmContent.innerHTML = '';

    const allItems = (inventory || []).filter(item => !isCurrencyItem(item));

    allItems.sort((a, b) => {
        const isEquippedA = a.isEquipped;
        const isEquippedB = b.isEquipped;

        if (isEquippedA && !isEquippedB) return -1;
        if (!isEquippedA && isEquippedB) return 1;
        if (isEquippedA && isEquippedB) {
            return equipOrder.indexOf(a.equipSlot) - equipOrder.indexOf(b.equipSlot);
        }
        return (a.itemName || '').localeCompare(b.itemName || '', 'zh-Hant');
    });

    if (allItems.length === 0) {
        itmContent.textContent = '\u7121\u4e00\u822c\u7269\u54c1';
        return;
    }

    allItems.forEach(item => {
        const itemEl = createItemEntry(item);
        itmContent.appendChild(itemEl);
    });
}


function createItemEntry(item) {
    const entry = document.createElement('div');
    entry.className = `item-entry ${item.isEquipped ? 'equipped' : ''}`;
    entry.dataset.id = item.instanceId;
    const safeItemId = escapeHtml(item.instanceId || '');
    const safeItemName = escapeHtml(item.itemName || '未知物品');
    const quantity = Number(item.quantity) || 0;

    let iconClass = 'fa-box';
    if (item.itemType && itemTypeConfig[item.itemType]) {
        iconClass = itemTypeConfig[item.itemType].icon;
    }
    if (item.isEquipped && item.equipSlot && slotConfig[item.equipSlot]) {
        iconClass = slotConfig[item.equipSlot].icon;
    }

    let equipControls = '';
    if (item.itemType === '武器' || item.itemType === '裝備') {
        equipControls = `
            <div class="item-controls">
                <label class="switch">
                    <input type="checkbox" ${item.isEquipped ? 'checked' : ''} data-item-id="${safeItemId}">
                    <span class="slider"></span>
                </label>
            </div>
        `;
    }

    entry.innerHTML = `
        <div class="item-info">
             <i class="item-icon fa-solid ${iconClass}"></i>
            <div>
                 <a href="#" class="item-link" data-item-id="${safeItemId}">${safeItemName}</a>
                 ${quantity > 1 ? `<span class="item-quantity">x${quantity}</span>` : ''}
            </div>
        </div>
        ${equipControls}
    `;

    const checkbox = entry.querySelector('input[type="checkbox"]');
    if (checkbox) {
        checkbox.addEventListener('change', (e) => {
            const itemId = e.target.dataset.itemId;
            handleEquipToggle(itemId, e.target.checked);
        });
    }
    return entry;
}

// 【核心修正】前端操作裝備的函式
async function handleEquipToggle(itemId, shouldEquip) {
    if (gameState.isRequesting) return;
    gameState.isRequesting = true;
    try {
        let result;
        // 根據是裝備還是卸下，呼叫不同的API函式
        if (shouldEquip) {
            result = await api.equipItem(itemId);
        } else {
            result = await api.unequipItem(itemId);
        }

        if (result.success && result.inventory) {
             gameState.roundData.inventory = result.inventory;
             if (result.bulkScore !== undefined) {
                 gameState.roundData.bulkScore = result.bulkScore;
                 updateBulkStatus(gameState.roundData.bulkScore);
             }
             renderInventory(gameState.roundData.inventory); 
        } else {
            throw new Error(result.message || '操作失敗');
        }
    } catch (error) {
        console.error('裝備操作失敗:', error);
        handleApiError(error);
        renderInventory(gameState.roundData.inventory); 
    } finally {
        gameState.isRequesting = false;
    }
}


export function handleApiError(error) {
    console.error('API error:', error);
    const errorMessage = String(error?.message || '');
    const normalizedError = errorMessage.toLowerCase();

    if (isAiModelRuntimeFailure(errorMessage)) {
        const aiSelector = document.getElementById('ai-model-selector');
        const previousModel = aiSelector?.value || '';
        const resetModel = resetAiModelSelectionToDefault(aiSelector);
        if (previousModel && previousModel !== resetModel) {
            appendMessageToStory(`AI core failed and was reset to default GPT (${DEFAULT_AI_MODEL}/gpt-5.2).`, 'system-message');
        }
    }

    appendMessageToStory(`[System] Connection failed... (${errorMessage})`, 'system-message');
    if (
        errorMessage.includes('\u672a\u7d93\u6388\u6b0a') ||
        errorMessage.includes('\u7121\u6548\u7684\u8eab\u4efd\u4ee4\u724c') ||
        normalizedError.includes('unauthorized') ||
        normalizedError.includes('invalid token') ||
        normalizedError.includes('jwt')
    ) {
        setTimeout(() => {
            localStorage.removeItem('jwt_token');
            localStorage.removeItem('username');
            window.location.href = 'login.html';
        }, 3000);
    }
}

function isAiModelRuntimeFailure(message) {
    const normalized = String(message || '').toLowerCase();
    if (!normalized) return false;

    const hasAiSignal =
        normalized.includes('ai') ||
        normalized.includes('openai') ||
        normalized.includes('gemini') ||
        normalized.includes('grok') ||
        normalized.includes('claude') ||
        normalized.includes('cluade') ||
        normalized.includes('deepseek');

    const hasFailureSignal =
        normalized.includes('api') ||
        normalized.includes('model') ||
        normalized.includes('\u6a21\u578b') ||
        normalized.includes('\u5931\u6557') ||
        normalized.includes('failed') ||
        normalized.includes('timeout');

    return hasAiSignal && hasFailureSignal;
}
