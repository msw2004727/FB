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
    updateBulkStatus(roundData.bulkScore || 0); // 更新負重
    updateLocationInfo(locationData);
    updateNpcList(roundData.NPC);
    renderInventory(roundData); // 【核心修改】使用新的物品渲染函式
    
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

// --- UI 更新輔助函式 ---

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
    updatePowerBar(staminaBar, staminaValue, roundData.stamina, 100);
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
            npcLine.innerHTML = `<span class="npc-name npc-${npc.friendliness}" data-npc-name="${npc.name}">${npc.name}</span>: ${npc.status || '狀態不明'}`;
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
            const replacement = `<span class="npc-name npc-${npc.friendliness || 'neutral'}" data-npc-name="${npc.name}"${isDeceasedAttr}>${npc.name}</span>`;
            highlightedText = highlightedText.replace(regex, replacement);
        });
    }
    return highlightedText;
}

// 【核心新增】物品渲染邏輯
function renderInventory(roundData) {
    if (!itmContent) return;
    itmContent.innerHTML = '';
    if (moneyContent) moneyContent.textContent = `${roundData.money || 0} 文錢`;

    const equipment = roundData.equipment || {};
    const inventory = roundData.inventory || [];

    const allItems = [
        ...Object.values(equipment).filter(Boolean), // 過濾掉null的已裝備物品
        ...inventory.map(item => item.instanceId)
    ];
    
    // 簡單地去重，因為雙手武器可能在equipment中出現兩次
    const uniqueItemIds = [...new Set(allPlayerItems)];
    
    // 將所有物品的完整資料存入一個map，方便查找
    const itemMasterList = {};
    Object.values(equipment).filter(Boolean).forEach(item => itemMasterList[item.instanceId] = item);
    inventory.forEach(item => itemMasterList[item.instanceId] = item);


    // 排序：已裝備的在前，背包在後
    const sortedItemIds = uniqueItemIds.sort((a, b) => {
        const itemA = itemMasterList[a];
        const itemB = itemMasterList[b];
        const equippedA = Object.values(equipment).some(eq => eq && eq.instanceId === a);
        const equippedB = Object.values(equipment).some(eq => eq && eq.instanceId === b);
        
        if (equippedA && !equippedB) return -1;
        if (!equippedA && equippedB) return 1;
        if (equippedA && equippedB) {
            const slotA = Object.keys(equipment).find(key => equipment[key] && equipment[key].instanceId === a);
            const slotB = Object.keys(equipment).find(key => equipment[key] && equipment[key].instanceId === b);
            return equipOrder.indexOf(slotA) - equipOrder.indexOf(slotB);
        }
        return (itemA.itemName || '').localeCompare(itemB.itemName || '', 'zh-Hant');
    });

    if (sortedItemIds.length === 0) {
        itmContent.textContent = '身無長物';
        return;
    }

    sortedItemIds.forEach(itemId => {
        const item = itemMasterList[itemId];
        if(!item) return;

        const isEquipped = Object.values(equipment).some(eq => eq && eq.instanceId === item.instanceId);
        const itemEl = createItemEntry(item, isEquipped, equipment);
        itmContent.appendChild(itemEl);
    });
}

function createItemEntry(item, isEquipped, equipment) {
    const entry = document.createElement('div');
    entry.className = `item-entry ${isEquipped ? 'equipped' : ''}`;
    entry.dataset.id = item.instanceId;

    let equipControls = '';
    if (item.equipSlot) {
        const currentSlot = Object.keys(equipment).find(key => equipment[key] && equipment[key].instanceId === item.instanceId);
        const slotIcon = currentSlot ? (slotConfig[currentSlot]?.icon || 'fa-question-circle') : '';
        
        equipControls = `
            <div class="item-controls">
                <i class="equipped-slot-icon fa-solid ${slotIcon} ${isEquipped ? 'visible' : ''}"></i>
                <label class="switch">
                    <input type="checkbox" ${isEquipped ? 'checked' : ''} data-slot="${item.equipSlot}">
                    <span class="slider"></span>
                </label>
            </div>
        `;
    }

    entry.innerHTML = `
        <div class="item-info">
            <span class="item-name">${item.itemName}</span>
            ${item.quantity > 1 ? `<span class="item-quantity">x${item.quantity}</span>` : ''}
        </div>
        ${equipControls}
    `;

    const checkbox = entry.querySelector('input[type="checkbox"]');
    if (checkbox) {
        checkbox.addEventListener('change', (e) => handleEquipToggle(item.instanceId, e.target.checked, e.target.dataset.slot));
    }
    return entry;
}

async function handleEquipToggle(itemId, shouldEquip, slot) {
    gameState.isRequesting = true; // 開始請求
    try {
        const payload = {
            itemId: itemId,
            equip: shouldEquip,
            slot: slot // 卸下時需要槽位資訊
        };
        // 注意：這裡我們直接呼叫api.js中的函式
        const result = await api.equipItem(payload); 

        if (result.success && result.playerState) {
            // 成功後，使用回傳的最新狀態重新渲染UI
            // 這裡需要一個方法來更新整個玩家的 roundData.inventory 和 equipment
            // 為了簡化，我們先重新渲染物品列表
             gameState.roundData.inventory = result.playerState.inventory;
             gameState.roundData.equipment = result.playerState.equipment;
             gameState.roundData.bulkScore = result.playerState.bulkScore;
             renderInventory(gameState.roundData);
             updateBulkStatus(gameState.roundData.bulkScore);

        } else {
            throw new Error(result.message || '操作失敗');
        }
    } catch (error) {
        console.error('裝備操作失敗:', error);
        // 操作失敗，可能需要將開關恢復原狀或提示使用者
        handleApiError(error);
    } finally {
        gameState.isRequesting = false; // 結束請求
    }
}

// 錯誤處理
export function handleApiError(error) {
    console.error('API 錯誤:', error);
    appendMessageToStory(`[系統] 連接失敗... (${error.message})`, 'system-message');
    if (error.message.includes('未經授權') || error.message.includes('無效的身份令牌')) {
        setTimeout(() => {
            localStorage.removeItem('jwt_token');
            localStorage.removeItem('username');
            window.location.href = 'login.html';
        }, 3000);
    }
}
