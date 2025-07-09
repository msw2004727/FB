// scripts/main.js
import { api } from './api.js';
import { updateUI, handleApiError, appendMessageToStory, addRoundTitleToStory } from './uiUpdater.js';
import * as modal from './modalManager.js';
import { gameTips } from './tips.js';
import { initializeGmPanel } from './gmManager.js';

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
    const skillsBtn = document.getElementById('skills-btn');
    const bountiesBtn = document.getElementById('bounties-btn');
    const combatInput = document.getElementById('combat-input');
    const combatActionButton = document.getElementById('combat-action-btn');
    const combatSurrenderBtn = document.getElementById('combat-surrender-btn'); 
    const storyPanel = document.getElementById('story-panel');
    const storyTextContainer = document.getElementById('story-text-wrapper');
    const npcInteractionMenu = document.getElementById('npc-interaction-menu');
    const chatInput = document.getElementById('chat-input');
    const chatActionBtn = document.getElementById('chat-action-btn');
    const closeChatBtn = document.getElementById('close-chat-btn');
    const endChatBtn = document.getElementById('end-chat-btn');
    const giveItemBtn = document.getElementById('give-item-btn');
    const cancelGiveBtn = document.getElementById('cancel-give-btn');
    const closeSkillsBtn = document.getElementById('close-skills-btn');
    const gmPanel = document.getElementById('gm-panel');
    const gmCloseBtn = document.getElementById('gm-close-btn');
    const gmMenu = document.getElementById('gm-menu');
    const gmContent = document.getElementById('gm-content');

    function setGameContainerHeight() {
        if (gameContainer) {
            gameContainer.style.height = `${window.innerHeight}px`;
        }
    }

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
        <div class="loader-disclaimer">說書人掐指一算：此番推演約需二十至四十五息。若遇江湖新奇，則需額外十數息為其立傳建檔。</div>
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
                loaderTipElement.innerHTML = gameTips[randomIndex];
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
        combatSurrenderBtn.disabled = isLoading; 
        chatInput.disabled = isLoading;
        chatActionBtn.disabled = isLoading;
        endChatBtn.disabled = isLoading;

        const loaderTextElement = aiThinkingLoader.querySelector('.loader-text');
        if(loaderTextElement) loaderTextElement.textContent = text;
        
        const showGlobalLoader = isLoading && !gameState.isInCombat && !gameState.isInChat && !document.getElementById('epilogue-modal').classList.contains('visible');

        if (showGlobalLoader) {
            rotateTip();
            tipInterval = setInterval(rotateTip, 15000);
        } else {
            clearInterval(tipInterval);
        }

        aiThinkingLoader.classList.toggle('visible', showGlobalLoader);
        modal.setCombatLoading(isLoading && gameState.isInCombat);
        modal.setChatLoading(isLoading && gameState.isInChat);
    }

    function updateBountyButton(hasNew) {
        if (bountiesBtn) {
            bountiesBtn.classList.toggle('has-new-bounty', hasNew);
        }
    }
    
    async function handlePlayerDeath() {
        modal.showEpilogueModal('<div class="loading-placeholder"><p>史官正在為您的人生撰寫終章...</p><div class="loader-dots"><span></span><span></span><span></span></div></div>', () => {
            modal.showDeceasedScreen();
        });

        try {
            const data = await api.getEpilogue();
            if (data && data.epilogue) {
                const formattedEpilogue = data.epilogue.replace(/\n/g, '<br><br>');
                modal.showEpilogueModal(formattedEpilogue, () => {
                    modal.showDeceasedScreen();
                });
            } else {
                throw new Error("未能獲取有效的結局故事。");
            }
        } catch (error) {
            modal.showEpilogueModal(`<p class="system-message">史官的筆墨耗盡，未能為您寫下終章...<br>(${error.message})</p>`, () => {
                modal.showDeceasedScreen();
            });
            console.error("獲取結局失敗:", error);
        }
    }

    async function startProactiveChat(proactiveData) {
        const { npcName, openingLine, itemChanges } = proactiveData;
        
        try {
            const profile = await api.getNpcProfile(npcName);
            
            gameState.isInChat = true;
            gameState.currentChatNpc = npcName;
            gameState.chatHistory = [];

            modal.openChatModalUI(profile); 
            
            modal.appendChatMessage('npc', openingLine);
            gameState.chatHistory.push({ speaker: 'npc', message: openingLine });

            if (itemChanges && itemChanges.length > 0) {
                const itemNames = itemChanges.map(item => `${item.itemName} x${item.quantity}`).join('、');
                const giftMessage = `你獲得了來自 ${npcName} 的贈禮：${itemNames}。`;
                modal.appendChatMessage('system', giftMessage);
                gameState.chatHistory.push({ speaker: 'system', message: giftMessage });
            }

            chatInput.focus();
        } catch (error) {
            console.error(`啟動與 ${npcName} 的主動對話失敗:`, error);
            appendMessageToStory(`[系統] ${npcName}似乎想對你說些什麼，但你沒有聽清。`, 'system-message');
        }
    }


    // --- 事件處理函式 ---
    async function handlePlayerAction() {
        hideNpcInteractionMenu(); // 任何玩家主動輸入都關閉選單
        const startTime = performance.now();
        const actionText = playerInput.value.trim();
        if (!actionText || gameState.isRequesting) return;

        if (actionText.toUpperCase() === '/*GM') {
            playerInput.value = '';
            gmPanel.classList.add('visible');
            return;
        }

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
                
                addRoundTitleToStory(data.roundData.EVT || `第 ${data.roundData.R} 回`);
                updateUI(data.story, data.roundData, data.randomEvent, data.locationData);
                
                gameState.currentRound = data.roundData.R;
                gameState.roundData = data.roundData;

                updateBountyButton(data.hasNewBounties);

                if (data.roundData.playerState === 'dead') {
                    setLoadingState(false);
                    handlePlayerDeath();
                    return;
                }
                
                if (data.proactiveChat) {
                    setLoadingState(false); 
                    startProactiveChat(data.proactiveChat);
                    return; 
                }

            } else {
                throw new Error("從伺服器收到的回應格式不正確。");
            }

            if (data.combatInfo && data.combatInfo.status === 'COMBAT_START') {
                startCombat(data.combatInfo.initialState);
            }
        } catch (error) {
            handleApiError(error);
        } finally {
            if (!document.getElementById('epilogue-modal').classList.contains('visible') && !gameState.isInChat) {
                 setLoadingState(false);
            }
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
                if (data.updatedState) {
                    modal.updateCombatUI(data.updatedState);
                }
            } else if (data.status === 'COMBAT_END') {
                data.newRound.roundData.suggestion = data.newRound.suggestion;
                modal.appendToCombatLog(data.newRound.story, 'combat-summary');
                setTimeout(() => endCombat(data.newRound), 2000);
            }
        } catch (error) {
            modal.appendToCombatLog(`[系統] 你的招式似乎沒有生效，江湖的氣息有些不穩，請再試一次。(${error.message})`, 'system-message');
        } finally {
            if (gameState.isInCombat) setLoadingState(false);
        }
    }
    
    async function handleSurrender() {
        if (gameState.isRequesting) return;
        setLoadingState(true);
        modal.appendToCombatLog('> 你決定停手，嘗試向對方認輸...', 'player-action-log surrender-log');

        try {
            const data = await api.combatSurrender({ model: aiModelSelector.value });
            modal.appendToCombatLog(data.narrative); 

            if (data.status === 'SURRENDER_REJECTED') {
            } else if (data.status === 'SURRENDER_ACCEPTED') {
                setTimeout(() => endCombat(data.newRound), 3000);
            }
        } catch (error) {
            modal.appendToCombatLog(`[系統錯誤] ${error.message}`);
        } finally {
            if (gameState.isInCombat && !document.getElementById('deceased-overlay').classList.contains('visible')) {
                setLoadingState(false);
            }
        }
    }


    function endCombat(newRoundData) {
        gameState.isInCombat = false;
        modal.closeCombatModal();
        
        if (newRoundData && newRoundData.roundData && newRoundData.roundData.playerState === 'dead') {
            updateUI(newRoundData.story, newRoundData.roundData, null, newRoundData.locationData);
            handlePlayerDeath();
            return;
        }

        if (newRoundData && newRoundData.roundData && newRoundData.story) {
            gameState.currentRound = newRoundData.roundData.R;
            gameState.roundData = newRoundData.roundData;
            addRoundTitleToStory(newRoundData.roundData.EVT || `第 ${newRoundData.roundData.R} 回`);
            updateUI(newRoundData.story, newRoundData.roundData, null, newRoundData.locationData);
        } else {
            appendMessageToStory("[系統] 戰鬥已結束，請繼續你的旅程。", 'system-message');
        }
        playerInput.focus();
        setLoadingState(false);
    }

    // --- 重構NPC點擊相關的所有邏輯 ---
    function hideNpcInteractionMenu() {
        npcInteractionMenu.classList.remove('visible');
    }

    function showNpcInteractionMenu(targetElement, npcName) {
        const rect = targetElement.getBoundingClientRect();
        const panelRect = storyPanel.getBoundingClientRect();
        
        npcInteractionMenu.style.top = `${rect.bottom - panelRect.top + storyPanel.scrollTop + 5}px`;
        npcInteractionMenu.style.left = `${rect.left - panelRect.left}px`;

        npcInteractionMenu.innerHTML = `
            <button class="npc-interaction-btn chat" data-npc-name="${npcName}"><i class="fas fa-comments"></i> 聊天</button>
            <button class="npc-interaction-btn attack" data-npc-name="${npcName}"><i class="fas fa-khanda"></i> 動手</button>
        `;
        
        npcInteractionMenu.classList.add('visible');

        npcInteractionMenu.querySelector('.chat').addEventListener('click', handleChatButtonClick);
        npcInteractionMenu.querySelector('.attack').addEventListener('click', handleAttackButtonClick);
    }

    async function handleChatButtonClick(event) {
        const npcName = event.currentTarget.dataset.npcName;
        hideNpcInteractionMenu();
        if (gameState.isRequesting) return;
        setLoadingState(true, '正在查找此人檔案...');
        try {
            const profile = await api.getNpcProfile(npcName);
            gameState.isInChat = true;
            gameState.currentChatNpc = profile.name;
            gameState.chatHistory = [];
            modal.openChatModalUI(profile);
            chatInput.focus();
        } catch (error) {
            if (error.message && error.message.includes('並未見到')) {
                appendMessageToStory(error.message, 'system-message');
            } else {
                handleApiError(error);
            }
        } finally {
            setLoadingState(false);
        }
    }

    async function handleAttackButtonClick(event) {
        const npcName = event.currentTarget.dataset.npcName;
        hideNpcInteractionMenu();
        if (gameState.isRequesting) return;
        
        setLoadingState(true, `準備與 ${npcName} 對決...`);
        try {
            const data = await api.initiateCombat({ targetNpcName: npcName, isSparring: false });
            if (data.status === 'COMBAT_START') {
                startCombat(data.initialState);
            }
        } catch (error) {
            handleApiError(error);
        } finally {
            if (!gameState.isInCombat) {
                 setLoadingState(false);
            }
        }
    }

    function handleNpcClick(event) {
        const target = event.target.closest('.npc-name');
        
        if (!target || npcInteractionMenu.contains(event.target)) {
            if (!event.target.closest('.npc-interaction-menu')) {
                 hideNpcInteractionMenu();
            }
            return;
        }

        const npcName = target.dataset.npcName || target.textContent;
        showNpcInteractionMenu(target, npcName);
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
                addRoundTitleToStory(data.roundData.EVT || `第 ${data.roundData.R} 回`);
                updateUI(data.story, data.roundData, data.randomEvent, data.locationData);
                gameState.currentRound = data.roundData.R;
                gameState.roundData = data.roundData;
                updateBountyButton(data.hasNewBounties);
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
                addRoundTitleToStory(data.roundData.EVT || `第 ${data.roundData.R} 回`);
                updateUI(data.story, data.roundData, null, data.locationData); 
                gameState.currentRound = data.roundData.R; 
                gameState.roundData = data.roundData; 
                updateBountyButton(data.hasNewBounties);
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

        aiModelSelector.value = 'openai';

        aiModelSelector.addEventListener('change', () => {
            const selectedModel = aiModelSelector.value;
            const notification = document.createElement('p');
            notification.className = 'system-message ai-switch-notification';
            notification.textContent = `系統：AI 核心已切換為 ${selectedModel.toUpperCase()}。`;
            storyTextContainer.appendChild(notification);
            storyTextContainer.parentElement.scrollTop = storyTextContainer.parentElement.scrollHeight;
            setTimeout(() => {
                notification.classList.add('fading-out');
                setTimeout(() => notification.remove(), 500);
            }, 5000);
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
            hideNpcInteractionMenu();
            if (gameState.isRequesting) return;
            if (window.confirm("你確定要了卻此生，讓名號永載史冊嗎？")) { 
                setLoadingState(true, '英雄末路，傳奇落幕...');
                try {
                    const data = await api.forceSuicide({ model: aiModelSelector.value });
                    updateUI(data.story, data.roundData, null, data.locationData);
                    handlePlayerDeath();
                } catch (error) {
                    handleApiError(error);
                    setLoadingState(false);
                }
            }
        });

        if (skillsBtn) {
            skillsBtn.addEventListener('click', async () => {
                hideNpcInteractionMenu();
                if (gameState.isRequesting) return;
                setLoadingState(true, '獲取武學資料...');
                try {
                    const skills = await api.getSkills();
                    modal.openSkillsModal(skills);
                } catch (error) {
                    handleApiError(error);
                } finally {
                    setLoadingState(false);
                }
            });
        }
        
        if (closeSkillsBtn) {
            closeSkillsBtn.addEventListener('click', modal.closeSkillsModal);
        }

        if (bountiesBtn) {
            bountiesBtn.addEventListener('click', () => {
                hideNpcInteractionMenu();
                updateBountyButton(false);
            });
        }

        initializeGmPanel(gmPanel, gmCloseBtn, gmMenu, gmContent);

        submitButton.addEventListener('click', handlePlayerAction);
        playerInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); handlePlayerAction(); } });
        combatActionButton.addEventListener('click', handleCombatAction);
        combatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); handleCombatAction(); } });
        combatSurrenderBtn.addEventListener('click', handleSurrender); 
        storyPanel.addEventListener('click', handleNpcClick);
        chatActionBtn.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendChatMessage(); } });
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

        setGameContainerHeight();
        window.addEventListener('resize', setGameContainerHeight);

        loadInitialGame();
    }

    async function loadInitialGame() {
        setLoadingState(true, '正在連接你的世界，讀取記憶中...');
        try {
            const data = await api.getLatestGame();
            
            storyTextContainer.innerHTML = ''; 

            if (data.gameState === 'deceased') {
                if(data.roundData) {
                    updateUI('', data.roundData, null, data.locationData);
                }
                handlePlayerDeath();

            } else {
                gameState.currentRound = data.roundData.R;
                gameState.roundData = data.roundData;
                
                if (data.prequel) {
                    const prequelDiv = document.createElement('div');
                    prequelDiv.className = 'prequel-summary';
                    prequelDiv.innerHTML = `<h3>前情提要</h3><p>${data.prequel.replace(/\n/g, '<br>')}</p>`;
                    storyTextContainer.appendChild(prequelDiv);
                }

                data.roundData.suggestion = data.suggestion;
                
                addRoundTitleToStory(data.roundData.EVT || `第 ${data.roundData.R} 回`);
                updateUI(data.story, data.roundData, null, data.locationData);

                updateBountyButton(data.hasNewBounties);
            }
        } catch (error) {
            if (error.message.includes('找不到存檔')) {
                storyTextContainer.innerHTML = '';
                const initialMessage = '你的旅程似乎尚未開始。請在下方輸入你的第一個動作，例如「睜開眼睛，環顧四周」。';
                const roundZeroData = { R: 0, EVT: '楔子', ATM: ['迷茫'], WRD: '未知', LOC: ['未知之地'], PC: '身體虛弱，內息紊亂', NPC: [], ITM: '行囊空空', QST: '', PSY: '我是誰...我在哪...', CLS: '', timeOfDay: '上午', internalPower: 5, externalPower: 5, lightness: 5, morality: 0, yearName: '元祐', year: 1, month: 1, day: 1, suggestion: '先檢查一下自己的身體狀況吧。' };
                
                addRoundTitleToStory(roundZeroData.EVT);
                appendMessageToStory(initialMessage, 'system-message');
                updateUI(null, roundZeroData, null, null);

            } else {
                handleApiError(error);
            }
        } finally {
             if (!document.getElementById('epilogue-modal').classList.contains('visible')) {
                 setLoadingState(false);
            }
        }
    }

    initialize();
});
