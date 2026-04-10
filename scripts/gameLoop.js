// scripts/gameLoop.js

import { api } from './api.js';
import { gameState } from './gameState.js';
import { updateUI, handleApiError, appendMessageToStory, addRoundTitleToStory } from './uiUpdater.js';
import { gameTips } from './tips.js';
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


            const rotateTip = () => {
                if (gameTips.length > 0) {
                    const randomIndex = Math.floor(Math.random() * gameTips.length);
                    if (loaderTipElement) {
                        loaderTipElement.innerHTML = gameTips.length > 0 ? gameTips.sort(() => 0.5 - Math.random())[0] : '';
                    }
                }
            };
            rotateTip();
            tipInterval = setInterval(rotateTip, 10000);

        } else {
            clearInterval(tipInterval);
            if(disclaimerInterval) {
                 clearInterval(disclaimerInterval);
                 disclaimerInterval = null;
            }
        }
        dom.aiThinkingLoader.classList.toggle('visible', showGlobalLoader);
    }

}

export async function handlePlayerDeath() {
    // 顯示結局
    const epilogueModal = document.getElementById('epilogue-modal');
    const epilogueStory = document.getElementById('epilogue-story');
    const deceasedOverlay = document.getElementById('deceased-overlay');

    if (epilogueModal) epilogueModal.classList.add('visible');
    if (epilogueStory) epilogueStory.innerHTML = '<p>正在回顧你在江湖的最後足跡...</p>';

    try {
        const data = await api.getEpilogue();
        if (data && data.epilogue) {
            if (epilogueStory) epilogueStory.innerHTML = data.epilogue.replace(/\n/g, '<br><br>');
        }
    } catch (error) {
        if (epilogueStory) epilogueStory.innerHTML = `<p>結局載入失敗。(${error.message})</p>`;
        console.error('結局載入失敗:', error);
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
            switchToOptionsMode(options);
        } else {
            switchToTextInputMode();
        }
    }
}


export async function handlePlayerAction(actionOverride) {
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
            model: dom.aiModelSelector.value
        });
        
        if (data && data.roundData) {
            processNewRoundData(data);
        } else {
            throw new Error('API 未回傳有效的 roundData。');
        }

    } catch (error) {
        console.error('API 互動請求失敗', error);
        const errorMessage = String(error.message || '');
        const cultivationErrorKeywords = ['cultivation', 'training', 'stamina', 'internal', 'external', 'lightness'];
        const isCultivationError = cultivationErrorKeywords.some(keyword => errorMessage.includes(keyword));
        if (isCultivationError) {
            appendMessageToStory(errorMessage, 'system-message cultivation-error');
        } else {
            appendMessageToStory('操作失敗：' + errorMessage, 'system-message');
        }
    } finally {
        if (!document.getElementById('epilogue-modal').classList.contains('visible')) {
             setLoading(false);
        }
    }
}


// ??????獢??????????????獢?????????
// --- 輸入模式切換 ---
export function switchToOptionsMode(options) {
    gameState.inputMode = 'options';
    gameState.currentActionOptions = options.slice(0, 3);
    if (dom.actionOptionButtons) {
        dom.actionOptionButtons.forEach((btn, i) => {
            btn.textContent = options[i] || '';
            btn.disabled = false;
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
                switchToOptionsMode(cachedOptions);
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
