// scripts/gameLoop.js

import { api } from './api.js';
import { gameState } from './gameState.js';
import { updateUI, handleApiError, appendMessageToStory, addRoundTitleToStory } from './uiUpdater.js';
import { getScenarioTips } from './tips.js';
import { dom } from './dom.js';

// ... (setLoading, handlePlayerDeath, startProactiveChat ????????) ...
const loadingDisclaimers = [
    '正在連接你的世界，讀取記憶中...',
    '江湖傳聞正在匯聚...',
    '整理命運線索與人物動向...',
    '世界狀態更新中，請稍候...',
    '正在準備下一回合...'
];
let tipInterval = null;
let disclaimerInterval = null;
let timerInterval = null;
let timerStart = 0;

export function setLoading(isLoading, text = '') {
    gameState.isRequesting = isLoading;
    if (dom.playerInput) dom.playerInput.disabled = isLoading;
    if (dom.submitButton) {
        dom.submitButton.disabled = isLoading;
        dom.submitButton.textContent = isLoading ? '送出中...' : '動作';
    }
    if (dom.actionOptionButtons) {
        dom.actionOptionButtons.forEach(btn => btn.disabled = isLoading);
    }

    if (dom.aiThinkingLoader) {
        const loaderDisclaimerElement = dom.aiThinkingLoader.querySelector('.loader-disclaimer');
        const loaderTextElement = dom.aiThinkingLoader.querySelector('.loader-text');
        const loaderTipElement = dom.aiThinkingLoader.querySelector('.loader-tip');

        if(loaderTextElement) loaderTextElement.textContent = text;

        const showGlobalLoader = isLoading && !document.getElementById('epilogue-modal').classList.contains('visible');

        const loaderTimerElement = dom.aiThinkingLoader.querySelector('.loader-timer');

        if (showGlobalLoader) {
            const rotateDisclaimer = () => {
                if (loadingDisclaimers.length > 0) {
                    if(loaderDisclaimerElement) {
                        loaderDisclaimerElement.innerHTML = loadingDisclaimers.sort(() => 0.5 - Math.random())[0];
                    }
                }
            };
            rotateDisclaimer();
            disclaimerInterval = setInterval(rotateDisclaimer, 10000);

            const scenarioTips = getScenarioTips(localStorage.getItem('wenjiang_scenario') || 'wuxia');
            const rotateTip = () => {
                if (scenarioTips.length > 0) {
                    if (loaderTipElement) {
                        loaderTipElement.innerHTML = scenarioTips.sort(() => 0.5 - Math.random())[0];
                    }
                }
            };
            rotateTip();
            tipInterval = setInterval(rotateTip, 10000);

            // 計時器
            timerStart = Date.now();
            if (loaderTimerElement) loaderTimerElement.textContent = '0s';
            clearInterval(timerInterval);
            timerInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - timerStart) / 1000);
                if (loaderTimerElement) loaderTimerElement.textContent = `${elapsed}s`;
            }, 1000);

        } else {
            clearInterval(tipInterval);
            clearInterval(disclaimerInterval);
            clearInterval(timerInterval);
            disclaimerInterval = null;
            timerInterval = null;
        }
        dom.aiThinkingLoader.classList.toggle('visible', showGlobalLoader);
    }

}

export async function handlePlayerDeath(preloadedEpilogue = null) {
    const epilogueModal = document.getElementById('epilogue-modal');
    const epilogueStory = document.getElementById('epilogue-story');
    const epilogueTitle = document.getElementById('epilogue-title');

    // 劇本感知的標題和載入提示
    const scnId = window.__activeScenario?.id || 'wuxia';
    const titles = {
        wuxia: '江湖路遠 有緣再會', school: '校園的鐘聲已遠',
        mecha: '鐵殼歸於寂靜', animal: '翠谷的風繼續吹',
        modern: '城市依舊運轉', hero: '英雄的故事暫停',
    };
    const loadingHints = {
        wuxia: 'AI 正在為你撰寫江湖結局回顧，請稍候...',
        school: 'AI 正在為你撰寫校園結局回顧，請稍候...',
        mecha: 'AI 正在為你撰寫最後的戰役紀錄，請稍候...',
        animal: 'AI 正在為你撰寫翠谷最後的記憶，請稍候...',
        modern: 'AI 正在為你撰寫在這座城市的最後篇章，請稍候...',
        hero: 'AI 正在為你撰寫英雄世界的結局，請稍候...',
    };

    if (epilogueTitle) epilogueTitle.textContent = titles[scnId] || titles.wuxia;
    if (epilogueModal) epilogueModal.classList.add('visible');

    // 如果結局已預載（並行呼叫），直接顯示
    if (preloadedEpilogue && preloadedEpilogue.epilogue) {
        if (epilogueStory) epilogueStory.innerHTML = preloadedEpilogue.epilogue.replace(/\n/g, '<br><br>');
        return;
    }

    // 否則顯示載入動畫 + 等待
    if (epilogueStory) {
        epilogueStory.innerHTML = `
            <div class="epilogue-loading">
                <div class="loader-dots"><span></span><span></span><span></span></div>
                <p>${loadingHints[scnId] || loadingHints.wuxia}</p>
                <p style="font-size:.75rem;opacity:.5;margin-top:.5rem;">精彩回顧即將呈現，請不要離開這個頁面 ✨</p>
            </div>`;
    }

    try {
        const data = await api.getEpilogue();
        if (data && data.epilogue) {
            if (epilogueStory) epilogueStory.innerHTML = data.epilogue.replace(/\n/g, '<br><br>');
        }
    } catch (error) {
        if (epilogueStory) epilogueStory.innerHTML = `<p>結局載入失敗。(${error.message})</p>`;
    }
}



/**
 * ?????????????v2.0 - ????畾???????選??????
 * ??????謏???????????????????????????????????????????? `gameState`
 * @param {object} data - ???????????謅???∴???????????????
 */
export async function processNewRoundData(data) {
    if (!data.roundData) {
        console.error('API 回應缺少 roundData', data);
        return;
    }
    
    // ??????????????????????????????雓??????????????選??????????????????????????
    const newSuggestion = data.suggestion || "書僮暫時沒有建議。";
    data.roundData.suggestion = newSuggestion;

    // ????????????????????????????????
    addRoundTitleToStory(data.roundData.EVT || `第${data.roundData.R}回合`);

    // 每回合預設收起 footer
    const footer = document.querySelector('.story-footer');
    if (footer) footer.classList.add('footer-collapsed');

    // 同步 gameState
    Object.assign(gameState.roundData, data.roundData);
    gameState.currentRound = data.roundData.R;
    if (data.locationData) gameState.currentLocationData = data.locationData;

    // ?????????????????????? gameState.roundData ???????????
    updateUI(data.story, gameState.roundData, data.randomEvent, gameState.currentLocationData);

    if (data.roundData.playerState === 'dead') {
        setLoading(false);
        handlePlayerDeath();
        return;
    }

    // 根據下一回合決定輸入模式
    const nextRound = (data.roundData.R || 0) + 1;
    const isTextTurn = (nextRound === 1 || nextRound % 5 === 0);
    if (isTextTurn) {
        switchToTextInputMode();
    } else {
        const options = data.roundData.actionOptions;
        if (options && Array.isArray(options) && options.length >= 3) {
            switchToOptionsMode(options, data.roundData.actionMorality);
        } else {
            switchToTextInputMode();
        }
    }
}


export async function handlePlayerAction(actionOverride, optionMorality = 0) {
    let actionText;
    if (actionOverride) {
        actionText = actionOverride;
    } else {
        actionText = (dom.playerInput ? dom.playerInput.value.trim() : '');
        if (!actionText) return;
    }
    if (gameState.isRequesting) return;

    if (actionText.toUpperCase() === '/*GM') {
        if (dom.playerInput) dom.playerInput.value = '';
        if (dom.gmPanel) dom.gmPanel.classList.add('visible');
        return;
    }

    if (dom.playerInput) dom.playerInput.value = '';
    if (dom.charCounter) dom.charCounter.textContent = '0/10';

    const prequelElement = dom.storyTextContainer.querySelector('.prequel-summary');
    if (prequelElement) {
        dom.storyTextContainer.innerHTML = '';
    }

    setLoading(true, '正在處理你的行動...');
    appendMessageToStory(`> ${actionText}`, 'player-action-log');

    try {
        const data = await api.interact({
            action: actionText,
            round: gameState.currentRound,
            model: dom.aiModelSelector.value,
            optionMorality
        });
        
        if (data && data.roundData) {
            processNewRoundData(data);
        } else {
            throw new Error('API 未回傳有效的 roundData。');
        }

    } catch (error) {
        console.error('API 互動請求失敗', error);
        const errorMessage = String(error.message || '');
        const retryContainer = document.createElement('div');
        retryContainer.className = 'system-message retry-message';
        retryContainer.innerHTML = `操作失敗：${errorMessage.replace(/</g,'&lt;')} <button class="retry-btn">重試</button>`;
        retryContainer.querySelector('.retry-btn').addEventListener('click', () => {
            retryContainer.remove();
            handlePlayerAction(actionOverride, optionMorality);
        });
        const wrapper = document.getElementById('story-text-wrapper');
        if (wrapper) wrapper.appendChild(retryContainer);
    } finally {
        if (!document.getElementById('epilogue-modal').classList.contains('visible')) {
             setLoading(false);
        }
    }
}


// ??????獢??????????????獢?????????
// --- 輸入模式切換 ---
export function switchToOptionsMode(options, morality) {
    gameState.inputMode = 'options';
    gameState.currentActionOptions = options.slice(0, 3);
    gameState.currentActionMorality = (morality || [0, 0, 0]).slice(0, 3);
    if (dom.actionOptionButtons) {
        dom.actionOptionButtons.forEach((btn, i) => {
            const textEl = btn.querySelector('.option-text');
            const optText = options[i] || '';
            if (textEl) textEl.textContent = optText;
            else btn.textContent = optText;
            btn.disabled = false;
            btn.setAttribute('aria-label', `選項${['一','二','三'][i]}：${optText}`);
            // 善惡徽章
            const m = gameState.currentActionMorality[i] || 0;
            let badge = btn.querySelector('.morality-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'morality-badge';
                btn.appendChild(badge);
            }
            if (m > 0) { badge.textContent = '善'; badge.className = 'morality-badge morality-good'; }
            else if (m < 0) { badge.textContent = '惡'; badge.className = 'morality-badge morality-evil'; }
            else { badge.textContent = '中'; badge.className = 'morality-badge morality-neutral'; }
        });
    }
    if (dom.optionsMode) dom.optionsMode.style.display = '';
    if (dom.textInputMode) dom.textInputMode.style.display = 'none';
}

export function switchToTextInputMode() {
    gameState.inputMode = 'text';
    gameState.currentActionOptions = [];
    if (dom.optionsMode) dom.optionsMode.style.display = 'none';
    if (dom.textInputMode) dom.textInputMode.style.display = '';
    if (dom.playerInput) {
        dom.playerInput.value = '';
        dom.playerInput.disabled = false;
    }
    if (dom.charCounter) dom.charCounter.textContent = '0/10';
}

// --- 初始載入 ---
export async function loadInitialGame() {
    setLoading(true, '正在連接你的世界，讀取記憶中...');
    try {
        const data = await api.getLatestGame();

        // 存檔損壞偵測：如果 roundData 缺少關鍵欄位，自動重建 R0
        if (data.roundData && (data.roundData.R === undefined || data.roundData.R === null)) {
            console.warn('[GameLoop] 偵測到損壞存檔（R 欄位缺失），自動重建...');
            await api.startNewGame();
            window.location.reload();
            return;
        }

        dom.storyTextContainer.innerHTML = '';
        if (data.gameState === 'deceased') {
            if(data.roundData) {
                if (data.locationData) gameState.currentLocationData = data.locationData;
                updateUI('', data.roundData, null, data.locationData);
            }
            handlePlayerDeath();
        } else {
            if (data.prequel) {
                const prequelDiv = document.createElement('div');
                prequelDiv.className = 'prequel-summary';
                prequelDiv.innerHTML = `<h3>前情提要</h3><p>${data.prequel.replace(/\n/g, '<br>')}</p>`;
                dom.storyTextContainer.appendChild(prequelDiv);
            }
            // ?????????????????????????????????????????????? gameState
            gameState.roundData = data.roundData;
            gameState.currentLocationData = data.locationData;
            gameState.currentRound = data.roundData.R;
            updateUI(data.story, data.roundData, null, data.locationData);

            // 初始化輸入模式
            const nextRound = (data.roundData.R || 0) + 1;
            const isTextTurn = (nextRound === 1 || nextRound % 5 === 0);
            const cachedOptions = data.roundData.actionOptions;
            if (isTextTurn || !cachedOptions || cachedOptions.length < 3) {
                switchToTextInputMode();
            } else {
                switchToOptionsMode(cachedOptions, data.roundData.actionMorality);
            }
        }
    } catch (error) {
        handleApiError(error);
    }
    finally {
         if (!document.getElementById('epilogue-modal').classList.contains('visible')) {
             setLoading(false);
        }
    }
}
