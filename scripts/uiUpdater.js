// scripts/uiUpdater.js
import { MAX_POWER } from './config.js';
import { api } from './api.js';
import { gameState } from './gameState.js';

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

const equipOrder = ['weapon_right', 'weapon_left', 'weapon_back', 'head', 'body', 'hands', 'feet', 'accessory1', 'accessory2', 'manuscript'];

// --- UI 更新核心函式 ---

export function updateUI(storyText, roundData, randomEvent, locationData) {
    if (randomEvent && randomEvent.description) {
        const eventDiv = document.createElement('div');
        eventDiv.className = 'random-event-message';
        eventDiv.innerHTML = `<strong>【奇遇】</strong> ${randomEvent.description}`;
        storyTextContainer.appendChild(eventDiv);
    }

    if (storyText) {
        const processedStory = highlightNpcNames(storyText, roundData.NPC);
        appendMessageToStory(processedStory, 'story-text');
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
    
    // 【核心修正】將顯示單位從 "文錢" 改為 "銀兩"
    moneyContent.textContent = `${roundData.money || 0} 銀兩`;
    
    qstContent.textContent = roundData.QST || '暫無要事';
    psyContent.textContent = roundData.PSY || '心如止水';
    clsContent.textContent = roundData.CLS || '尚無線索';
    actionSuggestion.textContent = roundData.suggestion ? `書僮小聲說：${roundData.suggestion}` : '';
}

export function appendMessageToStory(htmlContent, className) {
    const p = document.createElement('p');
    p.innerHTML = typeof htmlContent === 'string' ? htmlContent.replace(/\n/g, '<br>') : htmlContent;
    if (className) p.className = className;
    storyTextContainer.appendChild(p);
    storyPanelWrapper.scrollTop = storyPanelWrapper.scrollHeight;
}

export function addRoundTitleToStory(titleText) {
    const titleEl = document.createElement('h2');
    titleEl.className = 'round-title';
    titleEl.textContent = titleText;
    storyTextContainer.appendChild(titleEl);
}

function updateStatusBar(roundData) {
    const atmosphere = roundData.ATM?.[0] || '未知';
    const weather = roundData.WRD || '晴朗';
    const location = roundData.LOC?.[0] || '未知之地';
    const dateString = `${roundData.yearName || '元祐'}${roundData.year || 1}年${roundData.month || 1}月${roundData.day || 1}日`;
    statusBarEl.innerHTML = `
        <div class="status-item"><i class="fas fa-calendar-alt"></i> ${dateString}</div>
        <div class="status-item"><i class="fas fa-clock"></i> 時辰: 約${roundData.timeOfDay || '未知'}</div>
        <div class="status-item"><i class="fas fa-cloud-sun"></i> 天氣: ${weather}</div>
        <div class="status-item"><i class="fas fa-theater-masks"></i> 氛圍: ${atmosphere}</div>
        <div class="status-item"><i class="fas fa-map-marked-alt"></i> 地點: ${location}</div>
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
        const percentage = Math.min(((current || 0) / max) * 100, 100);
        barEl.style.width = `${percentage}%`;
        valueEl.textContent = `${current || 0}/${max}`;
    }
}

function updateMoralityBar(morality) {
    if (moralityBarIndicator) {
        const percentage = ((morality || 0) + 100) / 200 * 100;
        moralityBarIndicator.style.left = `${percentage}%`;
        let colorVar;
        if (morality > 10) colorVar = document.body.classList.contains('dark-theme') ? 'var(--morality-justice-dark)' : 'var(--morality-justice-light)';
        else if (morality < -10) colorVar = document.body.classList.contains('dark-theme') ? 'var(--morality-evil-dark)' : 'var(--morality-evil-light)';
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

function updateBulkStatus(score) {
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
     if (locationInfo) {
        if (locationData) {
            locationInfo.innerHTML = `
                <div>統治者：<span class="location-ruler">${locationData.governance?.ruler || '未知'}</span></div>
                <div class="location-desc">${locationData.description || '此地詳情尚在傳聞之中...'}</div>
            `;
        } else {
            locationInfo.innerHTML = '此地詳情尚在傳聞之中...';
        }
    }
}

function updateNpcList(npcs) {
    npcContent.innerHTML = '';
    const aliveNpcs = (npcs || []).filter(npc => !npc.isDeceased);
    if (aliveNpcs.length > 0) {
        aliveNpcs.forEach(npc => {
            const npcLine = document.createElement('div');
            const npcClass = npc.status_title === '丐幫弟子' ? 'npc-name-beggar' : `npc-${npc.friendliness}`;
            npcLine.innerHTML = `<span class="npc-name ${npcClass}" data-npc-name="${npc.name}">${npc.name}</span>: ${npc.status || '狀態不明'}`;
            npcContent.appendChild(npcLine);
        });
    } else {
        npcContent.textContent = '未見人煙';
    }
}

function highlightNpcNames(text, npcs) {
    if (!text) return '';
    let highlightedText = text;
    if (npcs && Array.isArray(npcs) && npcs.length > 0) {
        const sortedNpcs = [...npcs].sort((a, b) => b.name.length - a.name.length);
        sortedNpcs.forEach(npc => {
            const npcNameEscaped = npc.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(npcNameEscaped, 'g');
            const isDeceasedAttr = npc.isDeceased ? ' data-is-deceased="true"' : '';
            const npcClass = npc.status_title === '丐幫弟子' ? 'npc-name-beggar' : `npc-${npc.friendliness || 'neutral'}`;
            const replacement = `<span class="npc-name ${npcClass}" data-npc-name="${npc.name}"${isDeceasedAttr}>${npc.name}</span>`;
            highlightedText = highlightedText.replace(regex, replacement);
        });
    }
    return highlightedText;
}

function renderInventory(inventory) {
    if (!itmContent) return;
    itmContent.innerHTML = '';
    
    const allItems = inventory || [];

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
        itmContent.textContent = '身無長物';
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

    let iconClass = item.icon || 'fa-box';
    if (item.isEquipped && item.equipSlot && slotConfig[item.equipSlot]) {
        iconClass = slotConfig[item.equipSlot].icon;
    }

    let equipControls = '';
    if (item.equipSlot) {
        equipControls = `
            <div class="item-controls">
                <label class="switch">
                    <input type="checkbox" ${item.isEquipped ? 'checked' : ''} data-item-id="${item.instanceId}">
                    <span class="slider"></span>
                </label>
            </div>
        `;
    }

    entry.innerHTML = `
        <div class="item-info">
             <i class="item-icon fa-solid ${iconClass}"></i>
            <div>
                 <span class="item-name">${item.itemName}</span>
                 ${item.quantity > 1 ? `<span class="item-quantity">x${item.quantity}</span>` : ''}
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

async function handleEquipToggle(itemId, shouldEquip) {
    if (gameState.isRequesting) return;
    gameState.isRequesting = true;
    try {
        const payload = {
            itemId: itemId,
            equip: shouldEquip,
        };
        const result = await api.equipItem(payload); 

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
    console.error('API 錯誤:', error);

    const inGameErrorKeywords = ['並未見到', '銀兩不足', '無法', '不是可裝備', '沒有', '未指定'];

    if (error && error.message && inGameErrorKeywords.some(keyword => error.message.includes(keyword))) {
        appendMessageToStory(error.message, 'system-message');
    } else {
        appendMessageToStory(`[系統] 連接失敗... (${error.message || '未知錯誤'})`, 'system-message');
    }

    if (error && error.message && (error.message.includes('未經授權') || error.message.includes('無效的身份令牌'))) {
        setTimeout(() => {
            localStorage.removeItem('jwt_token');
            localStorage.removeItem('username');
            window.location.href = 'login.html';
        }, 3000);
    }
}
