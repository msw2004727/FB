// scripts/uiUpdater.js
import { MAX_POWER } from './config.js';
import { DEFAULT_AI_MODEL, resetAiModelSelectionToDefault } from './aiModelPreference.js';
import * as timeEffects from './timeEffects.js';

// --- DOM元素獲取 ---
const storyPanelWrapper = document.querySelector('.story-panel');
const storyTextContainer = document.getElementById('story-text-wrapper');
const statusBarEl = document.getElementById('status-bar');
const storyFooter = document.querySelector('.story-footer');

// --- Footer 收折 + 滑到底抖動 ---
if (storyFooter) {
    storyFooter.classList.add('footer-collapsed');

    const toggleBtn = document.getElementById('footer-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            storyFooter.classList.toggle('footer-collapsed');
        });
    }

    if (storyPanelWrapper) {
        let shakeTimer = null;
        storyPanelWrapper.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = storyPanelWrapper;
            const atBottom = scrollHeight - scrollTop - clientHeight < 30;
            if (atBottom && storyFooter.classList.contains('footer-collapsed')) {
                if (shakeTimer) return;
                storyFooter.classList.add('footer-shake');
                shakeTimer = setTimeout(() => {
                    storyFooter.classList.remove('footer-shake');
                    shakeTimer = null;
                }, 600);
            }
        });
    }
}
const pcContent = document.getElementById('pc-content');
const moralityBarIndicator = document.getElementById('morality-bar-indicator');
const actionSuggestion = document.getElementById('action-suggestion');
const roundCounter = document.getElementById('round-counter');
const questJournal = document.getElementById('quest-journal');

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
        appendMessageToStory(storyText, 'story-text', { allowHtml: true });
    }
    if (!roundData) return;

    updateStatusBar(roundData);
    // 角色狀態：30字上限，可換行
    const pcText = String(roundData.PC || '狀態穩定');
    pcContent.textContent = pcText.length > 30 ? pcText.slice(0, 30) + '…' : pcText;
    pcContent.title = pcText;
    updateDeathCountdownUI(roundData.deathCountdown);
    updateMoralityBar(roundData.morality);

    // 回合計數
    if (roundCounter) roundCounter.textContent = `第 ${roundData.R || 0} 回`;

    // 歸途印記
    updateMilestoneRunes(roundData.milestonesCount);

    // 任務日誌（來自 AI 的線索追蹤）
    if (questJournal && roundData.questJournal) {
        questJournal.textContent = roundData.questJournal;
    }

    actionSuggestion.textContent = roundData.suggestion ? `書僮小聲說：${roundData.suggestion}` : '';
}

function updateMilestoneRunes(count) {
    const container = document.getElementById('milestone-runes');
    if (!container) return;
    const runes = container.querySelectorAll('.rune');
    const lit = typeof count === 'number' ? count : 0;
    runes.forEach((r, i) => r.classList.toggle('lit', i < lit));
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

    // DOM 回收：超過 60 個子元素時移除最舊的
    const MAX_STORY_ELEMENTS = 60;
    while (storyTextContainer.children.length > MAX_STORY_ELEMENTS) {
        storyTextContainer.removeChild(storyTextContainer.firstChild);
    }
}

export function addRoundTitleToStory(titleText) {
    // 將既有內容標記為歷史（變淡）
    const existingItems = storyTextContainer.querySelectorAll(':scope > :not(.story-history)');
    existingItems.forEach(el => el.classList.add('story-history'));

    const titleEl = document.createElement('h2');
    titleEl.className = 'round-title round-title-current';
    titleEl.textContent = titleText;
    storyTextContainer.appendChild(titleEl);

    // 捲動到新回合標題
    requestAnimationFrame(() => {
        titleEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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

// --- 時辰 SVG 圖示 ---
const TIME_SVGS = {
    '清晨': `<svg viewBox="0 0 64 64" fill="none"><path d="M22 36 a10 10 0 0 1 20 0" fill="#FBBF24"/><line x1="32" y1="20" x2="32" y2="14" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="18" y1="28" x2="14" y2="24" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="46" y1="28" x2="50" y2="24" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="12" y1="36" x2="6" y2="36" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="52" y1="36" x2="58" y2="36" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/></svg>`,
    '上午': `<svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="10" fill="#FBBF24"/><line x1="32" y1="14" x2="32" y2="8" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="32" y1="56" x2="32" y2="50" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="14" y1="32" x2="8" y2="32" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="50" y1="32" x2="56" y2="32" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="19" y1="19" x2="15" y2="15" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="45" y1="45" x2="49" y2="49" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="45" y1="19" x2="49" y2="15" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="19" y1="45" x2="15" y2="49" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/></svg>`,
    '中午': `<svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="12" fill="#F59E0B"/><line x1="32" y1="12" x2="32" y2="6" stroke="#D97706" stroke-width="2.5" stroke-linecap="round"/><line x1="32" y1="58" x2="32" y2="52" stroke="#D97706" stroke-width="2.5" stroke-linecap="round"/><line x1="12" y1="32" x2="6" y2="32" stroke="#D97706" stroke-width="2.5" stroke-linecap="round"/><line x1="52" y1="32" x2="58" y2="32" stroke="#D97706" stroke-width="2.5" stroke-linecap="round"/><line x1="17" y1="17" x2="13" y2="13" stroke="#D97706" stroke-width="2.5" stroke-linecap="round"/><line x1="47" y1="47" x2="51" y2="51" stroke="#D97706" stroke-width="2.5" stroke-linecap="round"/><line x1="47" y1="17" x2="51" y2="13" stroke="#D97706" stroke-width="2.5" stroke-linecap="round"/><line x1="17" y1="47" x2="13" y2="51" stroke="#D97706" stroke-width="2.5" stroke-linecap="round"/></svg>`,
    '下午': `<svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="10" fill="#FBBF24"/><line x1="32" y1="14" x2="32" y2="8" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="32" y1="56" x2="32" y2="50" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="14" y1="32" x2="8" y2="32" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="50" y1="32" x2="56" y2="32" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="19" y1="19" x2="15" y2="15" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="45" y1="45" x2="49" y2="49" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="45" y1="19" x2="49" y2="15" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/><line x1="19" y1="45" x2="15" y2="49" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/></svg>`,
    '黃昏': `<svg viewBox="0 0 64 64" fill="none"><path d="M20 40 a12 12 0 0 1 24 0" fill="#F97316"/><line x1="32" y1="22" x2="32" y2="16" stroke="#F97316" stroke-width="2.5" stroke-linecap="round"/><line x1="18" y1="30" x2="13" y2="26" stroke="#F97316" stroke-width="2.5" stroke-linecap="round"/><line x1="46" y1="30" x2="51" y2="26" stroke="#F97316" stroke-width="2.5" stroke-linecap="round"/><rect x="4" y="40" width="56" height="20" rx="2" fill="#F97316" opacity="0.15"/></svg>`,
    '夜晚': `<svg viewBox="0 0 64 64" fill="none"><path d="M36 12 A16 16 0 1 0 36 48 A12 12 0 1 1 36 12Z" fill="#CBD5E1"/><circle cx="16" cy="16" r="1.2" fill="#E2E8F0"/><circle cx="50" cy="12" r="1.5" fill="#E2E8F0"/><circle cx="48" cy="40" r="1" fill="#E2E8F0"/><circle cx="12" cy="44" r="1.2" fill="#E2E8F0"/><circle cx="54" cy="28" r="0.8" fill="#E2E8F0"/></svg>`,
    '深夜': `<svg viewBox="0 0 64 64" fill="none"><path d="M36 10 A18 18 0 1 0 36 50 A13 13 0 1 1 36 10Z" fill="#94A3B8"/><circle cx="14" cy="14" r="1.5" fill="#CBD5E1"/><circle cx="52" cy="10" r="1.8" fill="#CBD5E1"/><circle cx="8" cy="36" r="1.2" fill="#CBD5E1"/><circle cx="50" cy="44" r="1.5" fill="#CBD5E1"/><circle cx="56" cy="26" r="1" fill="#CBD5E1"/><circle cx="20" cy="50" r="0.8" fill="#CBD5E1"/><circle cx="42" cy="18" r="0.8" fill="#CBD5E1"/></svg>`,
};

// --- 天氣 SVG 圖示（優先於時辰） ---
const WEATHER_SVGS = {
    'rain': `<svg viewBox="0 0 64 64" fill="none"><ellipse cx="32" cy="22" rx="16" ry="10" fill="#94A3B8"/><ellipse cx="20" cy="24" rx="10" ry="8" fill="#A0AEC0"/><ellipse cx="44" cy="24" rx="10" ry="8" fill="#A0AEC0"/><line x1="20" y1="38" x2="18" y2="48" stroke="#60A5FA" stroke-width="2" stroke-linecap="round"/><line x1="32" y1="36" x2="30" y2="46" stroke="#60A5FA" stroke-width="2" stroke-linecap="round"/><line x1="44" y1="38" x2="42" y2="48" stroke="#60A5FA" stroke-width="2" stroke-linecap="round"/></svg>`,
    'thunder': `<svg viewBox="0 0 64 64" fill="none"><ellipse cx="32" cy="20" rx="16" ry="10" fill="#64748B"/><ellipse cx="20" cy="22" rx="10" ry="8" fill="#475569"/><ellipse cx="44" cy="22" rx="10" ry="8" fill="#475569"/><polygon points="34,28 28,40 33,40 29,54 40,36 35,36 38,28" fill="#FBBF24"/><line x1="18" y1="36" x2="16" y2="44" stroke="#60A5FA" stroke-width="1.5" stroke-linecap="round"/><line x1="46" y1="36" x2="44" y2="44" stroke="#60A5FA" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    'snow': `<svg viewBox="0 0 64 64" fill="none"><ellipse cx="32" cy="20" rx="16" ry="10" fill="#CBD5E1"/><ellipse cx="20" cy="22" rx="10" ry="8" fill="#E2E8F0"/><ellipse cx="44" cy="22" rx="10" ry="8" fill="#E2E8F0"/><circle cx="20" cy="40" r="2" fill="#E2E8F0"/><circle cx="32" cy="44" r="2.5" fill="#E2E8F0"/><circle cx="44" cy="38" r="2" fill="#E2E8F0"/><circle cx="26" cy="50" r="1.5" fill="#E2E8F0"/><circle cx="38" cy="52" r="1.5" fill="#E2E8F0"/></svg>`,
    'fog': `<svg viewBox="0 0 64 64" fill="none"><line x1="8" y1="20" x2="56" y2="20" stroke="#94A3B8" stroke-width="3" stroke-linecap="round" opacity="0.3"/><line x1="12" y1="30" x2="52" y2="30" stroke="#94A3B8" stroke-width="3" stroke-linecap="round" opacity="0.4"/><line x1="8" y1="40" x2="56" y2="40" stroke="#94A3B8" stroke-width="3" stroke-linecap="round" opacity="0.3"/><line x1="14" y1="50" x2="50" y2="50" stroke="#94A3B8" stroke-width="3" stroke-linecap="round" opacity="0.2"/></svg>`,
    'wind': `<svg viewBox="0 0 64 64" fill="none"><path d="M8 24 Q20 20 32 24 Q44 28 52 22" stroke="#94A3B8" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M8 36 Q24 32 40 36 Q50 38 56 34" stroke="#A0AEC0" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M12 46 Q28 42 44 46" stroke="#94A3B8" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>`,
    'overcast': `<svg viewBox="0 0 64 64" fill="none"><ellipse cx="32" cy="28" rx="18" ry="12" fill="#94A3B8"/><ellipse cx="18" cy="30" rx="12" ry="9" fill="#A0AEC0"/><ellipse cx="46" cy="30" rx="12" ry="9" fill="#A0AEC0"/></svg>`,
};

function detectWeatherType(wrd) {
    if (!wrd) return null;
    const w = wrd.toLowerCase();
    if (w.includes('雷') || w.includes('閃電')) return 'thunder';
    if (w.includes('雪') || w.includes('冰雹')) return 'snow';
    if (w.includes('雨') || w.includes('暴雨') || w.includes('陣雨') || w.includes('細雨')) return 'rain';
    if (w.includes('霧') || w.includes('霾')) return 'fog';
    if (w.includes('狂風') || w.includes('大風') || w.includes('風沙')) return 'wind';
    if (w.includes('陰') || w.includes('多雲') || w.includes('烏雲')) return 'overcast';
    return null;
}

function updateTimeIcon(timeOfDay, weather) {
    const el = document.getElementById('menu-toggle-time-icon');
    if (!el) return;
    const weatherType = detectWeatherType(weather);
    if (weatherType && WEATHER_SVGS[weatherType]) {
        el.innerHTML = WEATHER_SVGS[weatherType];
    } else {
        el.innerHTML = TIME_SVGS[timeOfDay] || TIME_SVGS['上午'];
    }
}

// --- 時辰主題 ---
const TIME_CLASS_MAP = {
    '清晨': 'time-dawn',
    '上午': 'time-morning',
    '中午': 'time-noon',
    '下午': 'time-afternoon',
    '黃昏': 'time-dusk',
    '夜晚': 'time-night',
    '深夜': 'time-midnight',
};
let _timeEffectsInited = false;
let _lastTimeClass = '';

function updateTimeTheme(timeOfDay) {
    const cls = TIME_CLASS_MAP[timeOfDay] || 'time-morning';
    if (cls === _lastTimeClass) return;

    const main = document.getElementById('main-content');
    if (main) {
        if (_lastTimeClass) main.classList.remove(_lastTimeClass);
        main.classList.add(cls);
    }
    _lastTimeClass = cls;

    // canvas 特效初始化
    if (!_timeEffectsInited) {
        const canvas = document.getElementById('time-effect-canvas');
        if (canvas) {
            timeEffects.init(canvas);
            _timeEffectsInited = true;
        }
    }
    if (_timeEffectsInited) {
        timeEffects.switchEffect(timeOfDay);
    }
}

function updateStatusBar(roundData) {
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
            ${renderStatusRow('fa-map-marked-alt', '地點', location, { multiline: true })}
        </div>
    `;
    updateTimeIcon(roundData.timeOfDay, roundData.WRD);
    updateTimeTheme(roundData.timeOfDay);
}

function updateMoralityBar(morality) {
    const safeMorality = Number.isFinite(Number(morality)) ? Number(morality) : 0;
    if (moralityBarIndicator) {
        const percentage = Math.max(0, Math.min(((safeMorality + 100) / 200) * 100, 100));
        moralityBarIndicator.style.left = `${percentage}%`;
        let colorVar;
        if (safeMorality > 10) colorVar = document.body.classList.contains('dark-theme') ? 'var(--morality-justice-dark)' : 'var(--morality-justice-light)';
        else if (safeMorality < -10) colorVar = document.body.classList.contains('dark-theme') ? 'var(--morality-evil-dark)' : 'var(--morality-evil-light)';
        else colorVar = document.body.classList.contains('dark-theme') ? 'var(--dark-text-secondary)' : 'var(--morality-neutral-light)';
        moralityBarIndicator.style.backgroundColor = colorVar;
    }
    const valueEl = document.getElementById('morality-value');
    if (valueEl) valueEl.textContent = safeMorality > 0 ? `(+${safeMorality})` : `(${safeMorality})`;
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

export function handleApiError(error) {
    console.error('API error:', error);
    const errorMessage = String(error?.message || '');
    const normalizedError = errorMessage.toLowerCase();

    if (isAiModelRuntimeFailure(errorMessage)) {
        const aiSelector = document.getElementById('ai-model-selector');
        const previousModel = aiSelector?.value || '';
        const resetModel = resetAiModelSelectionToDefault(aiSelector);
        if (previousModel && previousModel !== resetModel) {
            appendMessageToStory(`AI 核心呼叫失敗，已自動切換回預設模型 (${DEFAULT_AI_MODEL})。`, 'system-message');
        }
    }

    appendMessageToStory(`[System] Connection failed... (${errorMessage})`, 'system-message');
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
