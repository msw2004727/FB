// scripts/uiUpdater.js
import { MAX_POWER } from './config.js';
import { api } from './api.js';
import { gameState } from './gameState.js';
import * as gameLoop from './gameLoop.js';

// --- 獲取所有和UI更新相關的DOM元素 ---
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


// --- UI 更新函式 ---

export function appendMessageToStory(htmlContent, className) {
    const p = document.createElement('p');
    if (typeof htmlContent === 'string') {
        p.innerHTML = htmlContent.replace(/\n/g, '<br>');
    } else {
        p.innerHTML = htmlContent;
    }
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

function updateMoralityBar(moralityValue) {
    if (moralityBarIndicator) {
        const percentage = ((moralityValue || 0) + 100) / 200 * 100;
        moralityBarIndicator.style.left = `${percentage}%`;

        let colorVar;
        if (moralityValue > 10) {
            colorVar = 'var(--morality-justice-light)';
        } else if (moralityValue < -10) {
            colorVar = 'var(--morality-evil-light)';
        } else {
            colorVar = 'var(--morality-neutral-light)';
        }

        if (document.body.classList.contains('dark-theme')) {
             if (moralityValue > 10) {
                colorVar = 'var(--morality-justice-dark)';
            } else if (moralityValue < -10) {
                colorVar = 'var(--morality-evil-dark)';
            } else {
                colorVar = 'var(--dark-text-secondary)';
            }
        }
        moralityBarIndicator.style.backgroundColor = colorVar;
    }
}

function updatePowerBar(barElement, valueElement, currentValue, maxValue, barId = '') {
    if (barElement && valueElement) {
        const percentage = Math.min(((currentValue || 0) / maxValue) * 100, 100);
        barElement.style.width = `${percentage}%`;
        valueElement.textContent = `${currentValue || 0}/${maxValue}`;

        if (barId === 'stamina-bar') {
            if (currentValue < 30) {
                barElement.classList.add('low-stamina');
            } else {
                barElement.classList.remove('low-stamina');
            }
        }
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
    } else {
        if (countdownEl) {
            countdownEl.remove();
        }
    }
}

function updateBulkStatus(score) {
    if (!bulkStatus) return;

    let emoji = '🎒';
    let text = '輕裝上陣';
    let colorClass = 'bulk-light';

    if (score > 30) {
        emoji = '🥵';
        text = '不堪重負';
        colorClass = 'bulk-extreme';
    } else if (score > 15) {
        emoji = '😫';
        text = '重物纏身';
        colorClass = 'bulk-heavy';
    } else if (score > 5) {
        emoji = '🤔';
        text = '略有份量';
        colorClass = 'bulk-medium';
    }

    bulkStatus.innerHTML = `${emoji} 負重：${text}`;
    bulkStatus.className = `bulk-status-display ${colorClass}`;
}

async function handleEquipToggle(itemId, isChecked) {
    const action = isChecked ? 'equip' : 'unequip';
    try {
        await api.equipItem({ itemId, action });
        // 操作成功後，重新加載遊戲狀態以刷新整個UI
        // 這是一種簡單但可靠的方式，確保前後端數據同步
        gameLoop.loadInitialGame(); 
    } catch (error) {
        console.error(`裝備操作失敗:`, error);
        alert(`操作失敗: ${error.message}`);
        // 操作失敗時，重新渲染一次以還原開關狀態
        gameLoop.loadInitialGame();
    }
}

function createItemEntry(item, equipment) {
    const entry = document.createElement('div');
    const isEquipped = Object.values(equipment).includes(item.instanceId);
    entry.className = `item-entry p-2 rounded-lg flex items-center justify-between ${isEquipped ? 'equipped' : ''}`;
    entry.dataset.id = item.instanceId;

    const slotConfig = {
        head: { icon: 'fa-user-ninja' }, body: { icon: 'fa-user-shield' },
        hands: { icon: 'fa-hand-rock' }, feet: { icon: 'fa-shoe-prints' },
        accessory1: { icon: 'fa-ring' }, accessory2: { icon: 'fa-ring' },
        manuscript: { icon: 'fa-book' }, weapon_right: { icon: 'fa-hand-paper' },
        weapon_left: { icon: 'fa-hand-paper' }, weapon_back: { icon: 'fa-archive' },
    };

    let equipControls = '';
    if (item.equipSlot && item.equipSlot !== 'none') {
        const currentSlot = Object.keys(equipment).find(key => equipment[key] === item.instanceId);
        const slotIcon = currentSlot ? slotConfig[currentSlot]?.icon || 'fa-question-circle' : '';
        
        equipControls = `
            <div class="flex items-center gap-2">
                <i class="equipped-slot-icon fa-solid ${slotIcon} ${isEquipped ? 'opacity-100' : 'opacity-0'}"></i>
                <label class="switch">
                    <input type="checkbox" ${isEquipped ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
        `;
    }

    entry.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="item-name font-semibold">${item.itemName} x${item.quantity || 1}</span>
        </div>
        ${equipControls}
    `;

    const checkbox = entry.querySelector('input[type="checkbox"]');
    if (checkbox) {
        checkbox.addEventListener('change', (e) => {
            handleEquipToggle(item.instanceId, e.target.checked);
        });
    }
    return entry;
}

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

    pcContent.textContent = roundData.PC || '狀態穩定';

    updateDeathCountdownUI(roundData.deathCountdown);

    updatePowerBar(internalPowerBar, internalPowerValue, roundData.internalPower, MAX_POWER);
    updatePowerBar(externalPowerBar, externalPowerValue, roundData.externalPower, MAX_POWER);
    updatePowerBar(lightnessPowerBar, lightnessPowerValue, roundData.lightness, MAX_POWER);
    updatePowerBar(staminaBar, staminaValue, roundData.stamina, 100, 'stamina-bar');

    updateMoralityBar(roundData.morality);
    
    updateBulkStatus(roundData.bulkScore || 0);

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


    npcContent.innerHTML = '';
    if (roundData.NPC && Array.isArray(roundData.NPC)) {
        const aliveNpcs = roundData.NPC.filter(npc => !npc.isDeceased);

        if (aliveNpcs.length > 0) {
            aliveNpcs.forEach(npc => {
                const npcLine = document.createElement('div');
                npcLine.innerHTML = `<span class="npc-name npc-${npc.friendliness}" data-npc-name="${npc.name}">${npc.name}</span>: ${npc.status || '狀態不明'}`;
                npcContent.appendChild(npcLine);
            });
        } else {
            npcContent.textContent = '未見人煙';
        }
    } else {
        npcContent.textContent = '未見人煙';
    }

    if (moneyContent) {
        moneyContent.textContent = `${roundData.money || 0} 文錢`;
    }
    
    // 【核心修改】重寫物品欄的渲染邏輯
    itmContent.innerHTML = '';
    const allItems = roundData.inventory || [];
    const equipment = roundData.equipment || {};
    const equipOrder = ['weapon_right', 'weapon_left', 'weapon_back', 'head', 'body', 'hands', 'feet', 'accessory1', 'accessory2', 'manuscript'];

    const sortedItems = allItems.sort((a, b) => {
        const equippedA = Object.values(equipment).includes(a.instanceId);
        const equippedB = Object.values(equipment).includes(b.instanceId);
        if (equippedA && !equippedB) return -1;
        if (!equippedA && equippedB) return 1;
        if (equippedA && equippedB) {
            const slotA = Object.keys(equipment).find(key => equipment[key] === a.instanceId);
            const slotB = Object.keys(equipment).find(key => equipment[key] === b.instanceId);
            return equipOrder.indexOf(slotA) - equipOrder.indexOf(slotB);
        }
        return a.itemName.localeCompare(b.itemName, 'zh-Hant');
    });

    if (sortedItems.length > 0) {
        sortedItems.forEach(item => {
            itmContent.appendChild(createItemEntry(item, equipment));
        });
    } else {
        itmContent.textContent = '身無長物';
    }


    qstContent.textContent = roundData.QST || '暫無要事';
    psyContent.textContent = roundData.PSY || '心如止水';
    clsContent.textContent = roundData.CLS || '尚無線索';

    actionSuggestion.textContent = roundData.suggestion ? `書僮小聲說：${roundData.suggestion}` : '';
}

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
