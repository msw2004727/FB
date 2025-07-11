// scripts/uiUpdater.js
import { MAX_POWER } from './config.js';

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
// 【核心新增】獲取負重顯示的DOM元素
const bulkStatus = document.getElementById('bulk-status');
const qstContent = document.getElementById('qst-content');
const psyContent = document.getElementById('psy-content');
const clsContent = document.getElementById('cls-content');
const actionSuggestion = document.getElementById('action-suggestion');
const moneyContent = document.getElementById('money-content');
const skillsContent = document.getElementById('skills-content'); 


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

// 【核心新增】更新負重狀態的函式
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
    
    // 【核心新增】在更新UI時呼叫負重更新函式
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
    
    itmContent.innerHTML = ''; 
    if (roundData.ITM && roundData.ITM !== '身無長物') {
        const items = roundData.ITM.split('、'); 
        items.forEach(itemText => {
            const itemDiv = document.createElement('div'); 
            itemDiv.textContent = itemText.trim();
            itmContent.appendChild(itemDiv); 
        });
    } else {
        itmContent.textContent = '身無長物';
    }

    if (skillsContent) {
        skillsContent.innerHTML = '';
        if (roundData.skills && Array.isArray(roundData.skills) && roundData.skills.length > 0) {
            data.skills.forEach(skill => {
                const skillLine = document.createElement('div');
                skillLine.className = 'skill-item';
                skillLine.innerHTML = `<strong>${skill.name}</strong> <span class="skill-level">(Lv.${skill.level || 0})</span>`;
                skillLine.title = `類型: ${skill.type}\n描述: ${skill.description}`;
                skillsContent.appendChild(skillLine);
            });
        } else {
            skillsContent.textContent = '尚未習得任何武學';
        }
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
