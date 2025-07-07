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
const moralityBarIndicator = document.getElementById('morality-bar-indicator');
const npcContent = document.getElementById('npc-content');
const itmContent = document.getElementById('itm-content');
const qstContent = document.getElementById('qst-content');
const psyContent = document.getElementById('psy-content');
const clsContent = document.getElementById('cls-content');
const actionSuggestion = document.getElementById('action-suggestion');
const moneyContent = document.getElementById('money-content');
const skillsContent = document.getElementById('skills-content'); // 【核心新增】


// --- UI 更新函式 ---

export function appendMessageToStory(htmlContent, className) {
    const p = document.createElement('p');
    p.innerHTML = htmlContent;
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
            const replacement = `<span class="npc-name npc-${npc.friendliness}" data-npc-name="${npc.name}">${npc.name}</span>`;
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

function updatePowerBar(barElement, valueElement, currentValue) {
    if (barElement && valueElement) {
        const percentage = Math.min(((currentValue || 0) / MAX_POWER) * 100, 100);
        barElement.style.width = `${percentage}%`;
        valueElement.textContent = `${currentValue || 0}/${MAX_POWER}`;
    }
}

export function updateUI(storyText, data, randomEvent) {
    if (randomEvent && randomEvent.description) {
        const eventDiv = document.createElement('div');
        eventDiv.className = 'random-event-message';
        eventDiv.innerHTML = `<strong>【奇遇】</strong> ${randomEvent.description}`;
        storyTextContainer.appendChild(eventDiv);
    }

    if (storyText) {
        const processedStory = highlightNpcNames(storyText, data.NPC);
        appendMessageToStory(processedStory, 'story-text');
    }
    if (!data) return;

    const atmosphere = data.ATM?.[0] || '未知';
    const weather = data.WRD || '晴朗';
    const location = data.LOC?.[0] || '未知之地';
    const dateString = `${data.yearName || '元祐'}${data.year || 1}年${data.month || 1}月${data.day || 1}日`;

    statusBarEl.innerHTML = `
        <div class="status-item"><i class="fas fa-calendar-alt"></i> ${dateString}</div>
        <div class="status-item"><i class="fas fa-clock"></i> 時辰: 約${data.timeOfDay || '未知'}</div>
        <div class="status-item"><i class="fas fa-cloud-sun"></i> 天氣: ${weather}</div>
        <div class="status-item"><i class="fas fa-theater-masks"></i> 氛圍: ${atmosphere}</div>
        <div class="status-item"><i class="fas fa-map-marked-alt"></i> 地點: ${location}</div>
    `;

    pcContent.textContent = data.PC || '狀態穩定';

    updatePowerBar(internalPowerBar, internalPowerValue, data.internalPower);
    updatePowerBar(externalPowerBar, externalPowerValue, data.externalPower);
    updatePowerBar(lightnessPowerBar, lightnessPowerValue, data.lightness);

    updateMoralityBar(data.morality);

    npcContent.innerHTML = '';
    if (data.NPC && Array.isArray(data.NPC) && data.NPC.length > 0) {
        data.NPC.forEach(npc => {
            const npcLine = document.createElement('div');
            npcLine.innerHTML = `<span class="npc-name npc-${npc.friendliness}" data-npc-name="${npc.name}">${npc.name}</span>: ${npc.status || '狀態不明'}`;
            npcContent.appendChild(npcLine);
        });
    } else {
        npcContent.textContent = '未見人煙';
    }

    if (moneyContent) {
        moneyContent.textContent = `${data.money || 0} 文錢`;
    }
    itmContent.textContent = data.ITM || '身無長物';

    // 【核心新增】更新武學列表
    if (skillsContent) {
        skillsContent.innerHTML = ''; // 先清空
        if (data.skills && Array.isArray(data.skills) && data.skills.length > 0) {
            data.skills.forEach(skill => {
                const skillLine = document.createElement('div');
                skillLine.className = 'skill-item';
                // 顯示武學名稱和等級
                skillLine.innerHTML = `<strong>${skill.name}</strong> <span class="skill-level">(Lv.${skill.level || 0})</span>`;
                // 將詳細描述放在滑鼠懸停提示中
                skillLine.title = `類型: ${skill.type}\n描述: ${skill.description}`;
                skillsContent.appendChild(skillLine);
            });
        } else {
            skillsContent.textContent = '尚未習得任何武學';
        }
    }

    qstContent.textContent = data.QST || '暫無要事';
    psyContent.textContent = data.PSY || '心如止水';
    clsContent.textContent = data.CLS || '尚無線索';

    actionSuggestion.textContent = data.suggestion ? `書僮小聲說：${data.suggestion}` : '';
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
