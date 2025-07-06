// scripts/main.js
import { api } from './api.js';
import { updateUI, handleApiError, appendMessageToStory } from './uiUpdater.js';
import * as modal from './modalManager.js';
import { gameTips } from './tips.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- 登入驗證 ---
    const token = localStorage.getItem('jwt_token');
    const username = localStorage.getItem('username');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    // --- 獲取主要互動的 DOM 元素 ---
    const storyHeader = document.querySelector('.story-header');
    const headerToggleButton = document.getElementById('header-toggle-btn');
    const playerInput = document.getElementById('player-input');
    const submitButton = document.getElementById('submit-button');
    const aiModelSelector = document.getElementById('ai-model-selector');
    const welcomeMessage = document.getElementById('welcome-message');
    const menuToggle = document.getElementById('menu-toggle');
    const gameContainer = document.querySelector('.game-container');
    const mainContent = document.getElementById('main-content');
    const themeSwitcher = document.getElementById('theme-switcher');
    const themeIcon = themeSwitcher.querySelector('i');
    const logoutButton = document.getElementById('logout-btn');
    const suicideButton = document.getElementById('suicide-btn');
    const restartButton = document.getElementById('restart-btn');
    const combatInput = document.getElementById('combat-input');
    const combatActionButton = document.getElementById('combat-action-btn');
    const storyTextContainer = document.getElementById('story-text-wrapper');
    const chatInput = document.getElementById('chat-input');
    const chatActionBtn = document.getElementById('chat-action-btn');
    const closeChatBtn = document.getElementById('close-chat-btn');
    const endChatBtn = document.getElementById('end-chat-btn');
    const giveItemBtn = document.getElementById('give-item-btn');
    const cancelGiveBtn = document.getElementById('cancel-give-btn');

    // --- 遊戲狀態變數 ---
    let gameState = {
        currentRound: 0,
        isRequesting: false,
        isInCombat: false,
        isInChat: false,
        currentChatNpc: null,
        chatHistory: [],
        roundData: null,
    };
    let tipInterval = null;

    // --- 全局讀取動畫 ---
    const aiThinkingLoader = document.createElement('div');
    aiThinkingLoader.className = 'ai-thinking-loader';
    aiThinkingLoader.innerHTML = `
        <div class="loader-text"></div>
        <div class="loader-dots"><span></span><span></span><span></span></div>
        <div class="loader-tip"></div>
    `;
    mainContent.appendChild(aiThinkingLoader);
    const loaderTipElement = aiThinkingLoader.querySelector('.loader-tip');

    function rotateTip() {
        if (gameTips.length > 0) {
            const randomIndex = Math.floor(Math.random() * gameTips.length);
            if (loaderTipElement) {
                loaderTipElement.textContent = gameTips[randomIndex];
            }
        }
    }

    function setLoadingState(isLoading, text = '') {
        gameState.isRequesting = isLoading;
        playerInput.disabled = isLoading || gameState.isInCombat || gameState.isInChat;
        submitButton.disabled = isLoading || gameState.isInCombat || gameState.isInChat;
        submitButton.textContent = isLoading ? '撰寫中...' : '動作';
        combatInput.disabled = isLoading;
        combatActionButton.disabled = isLoading;
        chatInput.disabled = isLoading;
        chatActionBtn.disabled = isLoading;
        endChatBtn.disabled = isLoading;

        const loaderTextElement = aiThinkingLoader.querySelector('.loader-text');
        if(loaderTextElement) loaderTextElement.textContent = text;

        if (isLoading && !gameState.isInCombat && !gameState.isInChat) {
            rotateTip();
            tipInterval = setInterval(rotateTip, 15000);
        } else {
            clearInterval(tipInterval);
        }

        aiThinkingLoader.classList.toggle('visible', isLoading && !gameState.isInCombat && !gameState.isInChat);
        modal.setCombatLoading(isLoading && gameState.isInCombat);
        modal.setChatLoading(isLoading && gameState.isInChat);
    }

    // --- 【核心修改】事件處理函式 ---
    async function handlePlayerAction() {
        // 【新增】在函式開始時，記錄開始時間
        const startTime = performance.now();

        const actionText = playerInput.value.trim();
        if (!actionText || gameState.isRequesting) return;
        playerInput.value = '';

        const prequelElement = storyTextContainer.querySelector('.prequel-summary');
        if (prequelElement) {
            storyTextContainer.innerHTML = '';
        }

        setLoadingState(true, '江湖百曉生正在構思...');
        appendMessageToStory(`> ${actionText}`, 'player-action-log');

        try {
            const data = await api.interact({
                action: actionText,
                round: gameState.currentRound,
                model: aiModelSelector.value
            });

            if (data && data.roundData) {
                data.roundData.suggestion = data.suggestion;
                updateUI(data.story, data.roundData, data.randomEvent);
                gameState.currentRound = data.roundData.R;
                gameState.roundData = data.roundData;
            } else {
                throw new Error("從伺服器收到的回應格式不正確。");
            }

            if (data.combatInfo && data.combatInfo.status === 'COMBAT_START') {
                startCombat(data.combatInfo.initialState);
            } else if (data.roundData.playerState === 'dead') {
                modal.showDeceasedScreen();
                setLoadingState(true);
            }
        } catch (error) {
            handleApiError(error);
        } finally {
            if (document.getElementById('deceased-overlay').classList.contains('visible') === false) {
                 setLoadingState(false);
            }
            // 【新增】在函式結束前，計算並印出總耗時
            const endTime = performance.now();
            const durationInSeconds = ((endTime - startTime) / 1000).toFixed(2);
            console.log(`[效能監控] 從按下「動作」到收到回應，總耗時: ${durationInSeconds} 秒。`);
        }
    }

    function startCombat(initialState) {
        gameState.isInCombat = true;
        modal.openCombatModal(initialState);
        combatInput.focus();
    }

    async function handleCombatAction() {
        const actionText = combatInput.value.trim();
        if (!actionText || gameState.isRequesting) return;
        combatInput.value = '';
        setLoadingState(true);
        modal.appendToCombatLog(`> ${actionText}`, 'player-action-log');

        try {
            const data = await api.combatAction({ action: actionText, model: aiModelSelector.value });
            if (data.status === 'COMBAT_ONGOING') {
                modal.appendToCombatLog(data.narrative);
            } else if (data.status === 'COMBAT_END') {
                data.newRound.roundData.suggestion = data.newRound.suggestion;
                modal.appendToCombatLog(data.newRound.story, 'combat-summary');
                setTimeout(() => endCombat(data.newRound), 2000);
            }
        } catch (error) {
            modal.appendToCombatLog(`[系統錯誤] ${error.message}`);
            setTimeout(() => endCombat(null), 2000);
        } finally {
            if (gameState.isInCombat) setLoadingState(false);
        }
    }

    function endCombat(newRoundData) {
        gameState.isInCombat = false;
        modal.closeCombatModal();
        if (newRoundData && newRoundData.roundData && newRoundData.story) {
            gameState.currentRound = newRoundData.roundData.R;
            gameState.roundData = newRoundData.roundData;
            updateUI(newRoundData.story, newRoundData.roundData, null);
        } else {
            appendMessageToStory("[系統] 戰鬥已結束，請繼續你的旅程。", 'system-message');
        }
        playerInput.focus();
    }

    async function handleNpcClick(event) {
        const target = event.target.closest('.npc-name');
        if (target && !gameState.isRequesting) {
            const npcName = target.dataset.npcName || target.textContent;
            setLoadingState(true, '正在查找此人檔案...');
            try {
                const profile = await api.getNpcProfile(npcName);
                gameState.isInChat = true;
                gameState.currentChatNpc = profile.name;
                gameState.chatHistory = [];
                modal.openChatModalUI(profile);
                chatInput.focus();
            } catch (error) {
                handleApiError(error);
            } finally {
                setLoadingState(false);
            }
        }
    }

    async function sendChatMessage() {
        const message = chatInput.value.trim();
        if (!message || gameState.isRequesting) return;
        chatInput.value = '';
        modal.appendChatMessage('player', message);
        gameState.chatHistory.push({ speaker: 'player', message });
        setLoadingState(true);

        try {
            const data = await api.npcChat({
                npcName: gameState.currentChatNpc,
                chatHistory: gameState.chatHistory,
                playerMessage: message,
                model: aiModelSelector.value
            });
            modal.appendChatMessage('npc', data.reply);
            gameState.chatHistory.push({ speaker: 'npc', message: data.reply });
        } catch (error) {
            modal.appendChatMessage('system', `[系統錯誤: ${error.message}]`);
        } finally {
            setLoadingState(false);
        }
    }

    async function endChatSession() {
        if (gameState.isRequesting || !gameState.currentChatNpc) return;
        const npcNameToSummarize = gameState.currentChatNpc;
        
        modal.closeChatModal();
        gameState.isInChat = false; 
        setLoadingState(true, '正在總結對話，更新江湖事態...');

        try {
            const data = await api.endChat({
                npcName: npcNameToSummarize,
                fullChatHistory: gameState.chatHistory,
                model: aiModelSelector.value
            });
            if (data && data.roundData && typeof data.roundData.R !== 'undefined') {
                appendMessageToStory(`<p class="system-message">結束了與${npcNameToSummarize}的交談。</p>`);
                data.roundData.suggestion = data.suggestion;
                updateUI(data.story, data.roundData, data.randomEvent);
                gameState.currentRound = data.roundData.R;
                gameState.roundData = data.roundData;
            } else {
                throw new Error('從伺服器收到的回應格式不正確。');
            }
        } catch (error) {
            handleApiError(error);
        } finally {
            gameState.currentChatNpc = null;
            gameState.chatHistory = [];
            setLoadingState(false);
        }
    }

    async function handleGiveItem(giveData) {
        modal.closeGiveItemModal(); 
        modal.closeChatModal(); 

        gameState.isInChat = false;
        
        setLoadingState(true, "正在更新江湖事態..."); 

        try {
            const body = {
                giveData: {
                    target: gameState.currentChatNpc,
                    ...giveData
                },
                model: aiModelSelector.value
            };
            const data = await api.giveItemToNpc(body);

            if (data && data.roundData) {
                data.roundData.suggestion = data.suggestion;
                updateUI(data.story, data.roundData, null); 
                gameState.currentRound = data.roundData.R; 
                gameState.roundData = data.roundData; 
            } else {
                throw new Error("從伺服器收到的回應格式不正確。");
            }
        } catch (error) {
            handleApiError(error); 
        } finally {
            gameState.currentChatNpc = null;
            gameState.chatHistory = [];
            setLoadingState(false); 
        }
    }


    function initialize() {
        if (welcomeMessage) welcomeMessage.textContent = `${username}，歡迎回來。`;
        let currentTheme = localStorage.getItem('game_theme') || 'light';
        document.body.className = `${currentTheme}-theme`;
        themeIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        themeSwitcher.addEventListener('click', () => {
            currentTheme = (document.body.classList.contains('light-theme')) ? 'dark' : 'light';
            localStorage.setItem('game_theme', currentTheme);
            document.body.className = `${currentTheme}-theme`;
            themeIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        });
        headerToggleButton.addEventListener('click', () => {
            storyHeader.classList.toggle('collapsed');
            headerToggleButton.querySelector('i').classList.toggle('fa-chevron-up');
            headerToggleButton.querySelector('i').classList.toggle('fa-chevron-down');
        });
        menuToggle.addEventListener('click', () => gameContainer.classList.toggle('sidebar-open'));
        mainContent.addEventListener('click', (e) => {
            if (window.innerWidth <= 1024 && !document.getElementById('dashboard').contains(e.target) && !menuToggle.contains(e.target)) {
                gameContainer.classList.remove('sidebar-open');
            }
        });
        logoutButton.addEventListener('click', () => {
            localStorage.removeItem('jwt_token');
            localStorage.removeItem('username');
            window.location.href = 'login.html';
        });
        suicideButton.addEventListener('click', async () => {
            if (gameState.isRequesting) return;
            if (window.confirm("你確定要了卻此生，重新輪迴嗎？")) {
                setLoadingState(true, '英雄末路，輪迴將啟...');
                try {
                    const data = await api.forceSuicide();
                    updateUI(data.story, data.roundData, data.randomEvent);
                    modal.showDeceasedScreen();
                } catch (error) {
                    handleApiError(error);
                    setLoadingState(false);
                }
            }
        });
        restartButton.addEventListener('click', async () => {
            try {
                await api.startNewGame();
                window.location.reload();
            } catch (error) {
                console.error('重新開始失敗:', error);
                alert(`開啟新的輪迴時發生錯誤：${error.message}`);
            }
        });
        submitButton.addEventListener('click', handlePlayerAction);
        playerInput.addEventListener('keypress', (e) => {
             if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                handlePlayerAction();
            }
        });
        combatActionButton.addEventListener('click', handleCombatAction);
        combatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                handleCombatAction();
            }
        });
        storyTextContainer.addEventListener('click', handleNpcClick);
        chatActionBtn.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                sendChatMessage();
            }
        });
        
        closeChatBtn.addEventListener('click', () => {
             gameState.isInChat = false;
             gameState.currentChatNpc = null;
             gameState.chatHistory = [];
             modal.closeChatModal();
             setLoadingState(false); 
        });
        
        endChatBtn.addEventListener('click', endChatSession);
        
        giveItemBtn.addEventListener('click', () => {
            if (gameState.isInChat && gameState.currentChatNpc) {
                modal.openGiveItemModal(gameState.currentChatNpc, handleGiveItem);
            }
        });
        
        cancelGiveBtn.addEventListener('click', modal.closeGiveItemModal);

        loadInitialGame();
    }

    async function loadInitialGame() {
        setLoadingState(true, '正在連接你的世界，讀取記憶中...');
        try {
            const data = await api.getLatestGame();
            if (data.gameState === 'deceased') {
                modal.showDeceasedScreen();
                if(data.roundData) {
                    updateUI('', data.roundData, null);
                }
                setLoadingState(true);
            } else {
                gameState.currentRound = data.roundData.R;
                gameState.roundData = data.roundData;
                storyTextContainer.innerHTML = '';
                if (data.prequel) {
                    const prequelDiv = document.createElement('div');
                    prequelDiv.className = 'prequel-summary';
                    prequelDiv.innerHTML = `<h3>前情提要</h3><p>${data.prequel.replace(/\n/g, '<br>')}</p>`;
                    storyTextContainer.appendChild(prequelDiv);
                }
                data.roundData.suggestion = data.suggestion;
                updateUI(null, data.roundData, null);
            }
        } catch (error) {
            if (error.message.includes('找不到存檔')) {
                storyTextContainer.innerHTML = '';
                const initialMessage = '你的旅程似乎尚未開始。請在下方輸入你的第一個動作，例如「睜開眼睛，環顧四周」。';
                appendMessageToStory(initialMessage, 'system-message');
                const roundZeroData = { R: 0, EVT: '楔子', ATM: ['迷茫'], WRD: '未知', LOC: ['未知之地'], PC: '身體虛弱，內息紊亂', NPC: [], ITM: '行囊空空', QST: '', PSY: '我是誰...我在哪...', CLS: '', timeOfDay: '上午', internalPower: 5, externalPower: 5, lightness: 5, morality: 0, yearName: '元祐', year: 1, month: 1, day: 1, suggestion: '先檢查一下自己的身體狀況吧。' };
                updateUI(null, roundZeroData, null);
            } else {
                handleApiError(error);
            }
        } finally {
            if (document.getElementById('deceased-overlay').classList.contains('visible') === false) {
                 setLoadingState(false);
            }
        }
    }

    initialize();
});
