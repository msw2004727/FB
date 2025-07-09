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
    const menuToggle = document.getElementById('menu-toggle');
    const gameContainer = document.querySelector('.game-container');
    const mainContent = document.getElementById('main-content');
    const themeSwitcher = document.getElementById('theme-switcher');
    const themeIcon = themeSwitcher.querySelector('i');
    const logoutButton = document.getElementById('logout-btn');
    const suicideButton = document.getElementById('suicide-btn');
    const skillsBtn = document.getElementById('skills-btn');
    const bountiesBtn = document.getElementById('bounties-btn');
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
        combat: {
            state: null,
            selectedStrategy: null,
            selectedSkill: null,
            selectedTarget: null,
        }
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
        hideNpcInteractionMenu();
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

    // --- 新戰鬥系統邏輯 ---

    function startCombat(initialState) {
        gameState.isInCombat = true;
        gameState.combat.state = initialState;
        modal.openCombatModal(initialState);
        
        const strategyButtons = document.querySelectorAll('.strategy-btn');
        strategyButtons.forEach(btn => {
            btn.addEventListener('click', () => handleStrategySelection(btn.dataset.strategy));
        });
    }

    function handleStrategySelection(strategy) {
        gameState.combat.selectedStrategy = strategy;
        gameState.combat.selectedSkill = null; 

        document.querySelectorAll('.strategy-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.strategy === strategy);
        });

        const skillSelectionContainer = document.getElementById('skill-selection');
        const confirmBtn = document.getElementById('combat-confirm-btn');
        skillSelectionContainer.innerHTML = '';
        confirmBtn.disabled = true;

        const playerSkills = gameState.combat.state?.player?.skills || [];
        const relevantSkills = playerSkills.filter(skill => {
            if (strategy === 'attack' && (skill.skillType === '拳腳' || skill.skillType === '兵器')) return true;
            if (strategy === 'defend' && skill.skillType === '內功') return true; 
            return false;
        });

        if (strategy === 'evade') {
            skillSelectionContainer.innerHTML = '<p class="system-message">你凝神專注，準備尋找時機進行迴避。</p>';
            confirmBtn.disabled = false;
        } else if (relevantSkills.length > 0) {
            relevantSkills.forEach(skill => {
                const skillBtn = document.createElement('button');
                skillBtn.className = 'skill-btn';
                skillBtn.dataset.skillName = skill.name;
                skillBtn.innerHTML = `
                    <span class="skill-name">${skill.name} (L${skill.level})</span>
                    <span class="skill-cost">內力 ${skill.cost || 5}</span>
                `;
                skillBtn.addEventListener('click', () => handleSkillSelection(skill.name));
                skillSelectionContainer.appendChild(skillBtn);
            });
        } else {
            skillSelectionContainer.innerHTML = `<p class="system-message">你沒有可用於此策略的武學。</p>`;
        }
    }

    function handleSkillSelection(skillName) {
        gameState.combat.selectedSkill = skillName;
        document.querySelectorAll('.skill-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.skillName === skillName);
        });
        document.getElementById('combat-confirm-btn').disabled = false;
    }

    async function handleConfirmCombatAction() {
        if (!gameState.combat.selectedStrategy) {
            alert('請選擇一個策略！');
            return;
        }
        if (gameState.combat.selectedStrategy !== 'evade' && !gameState.combat.selectedSkill) {
            alert('請選擇一門武學！');
            return;
        }

        setLoadingState(true);

        try {
            const combatActionPayload = {
                strategy: gameState.combat.selectedStrategy,
                skill: gameState.combat.selectedSkill,
                target: gameState.combat.selectedTarget, 
                model: aiModelSelector.value
            };

            const data = await api.combatAction(combatActionPayload);
            
            modal.setTurnCounter(data.updatedState.turn);
            modal.updateCombatLog(data.narrative);
            modal.updateCombatUI(data.updatedState);
            gameState.combat.state = data.updatedState;

            if (data.status === 'COMBAT_END') {
                setTimeout(() => endCombat(data.newRound), 2000);
            } else {
                document.querySelectorAll('.strategy-btn.selected, .skill-btn.selected').forEach(el => el.classList.remove('selected'));
                document.getElementById('skill-selection').innerHTML = '<p class="system-message">請先選擇一個策略</p>';
                document.getElementById('combat-confirm-btn').disabled = true;
                gameState.combat.selectedStrategy = null;
                gameState.combat.selectedSkill = null;
            }

        } catch (error) {
            modal.updateCombatLog(`[系統] 你的招式似乎沒有生效，江湖的氣息有些不穩，請再試一次。(${error.message})`, 'system-message');
        } finally {
            if (gameState.isInCombat) setLoadingState(false);
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
    
    // --- NPC 互動與對話 ---

    function hideNpcInteractionMenu() {
        if (npcInteractionMenu) {
            npcInteractionMenu.classList.remove('visible');
            // 【核心修改】在隱藏時，清空選單內容，恢復初始狀態
            npcInteractionMenu.innerHTML = '';
        }
    }

    function showNpcInteractionMenu(targetElement, npcName) {
        // 每次顯示時都重新生成初始按鈕
        npcInteractionMenu.innerHTML = `
            <button class="npc-interaction-btn chat" data-npc-name="${npcName}"><i class="fas fa-comments"></i> 聊天</button>
            <button class="npc-interaction-btn attack" data-npc-name="${npcName}"><i class="fas fa-khanda"></i> 動手</button>
        `;
        
        npcInteractionMenu.querySelector('.chat').addEventListener('click', handleChatButtonClick);
        npcInteractionMenu.querySelector('.attack').addEventListener('click', showAttackConfirmation);

        const menuRect = npcInteractionMenu.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();
        const panelRect = storyPanel.getBoundingClientRect();

        let top = targetRect.bottom - panelRect.top + storyPanel.scrollTop + 8;
        let left = targetRect.left - panelRect.left + (targetRect.width / 2) - (menuRect.width / 2);

        if (top + menuRect.height > storyPanel.scrollHeight) {
            top = targetRect.top - panelRect.top + storyPanel.scrollTop - menuRect.height - 8;
        }

        const rightEdge = left + menuRect.width;
        if (rightEdge > panelRect.width) {
            left = panelRect.width - menuRect.width - 5; 
        }
        if (left < 0) {
            left = 5;
        }

        npcInteractionMenu.style.top = `${top}px`;
        npcInteractionMenu.style.left = `${left}px`;
        npcInteractionMenu.classList.add('visible');
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

    // 【核心修改】使用附加節點的方式，而不是 innerHTML
    function showAttackConfirmation(event) {
        const npcName = event.currentTarget.dataset.npcName;
        
        // 隱藏舊按鈕
        const existingButtons = npcInteractionMenu.querySelectorAll('.npc-interaction-btn');
        existingButtons.forEach(btn => btn.style.display = 'none');
        
        // 創建新的確認元素
        const promptText = document.createElement('span');
        promptText.className = 'confirm-prompt-text';
        promptText.textContent = '確定要動手？';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'npc-interaction-btn cancel-attack';
        cancelBtn.dataset.npcName = npcName;
        cancelBtn.innerHTML = '<i class="fas fa-times"></i>';
        
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'npc-interaction-btn confirm-attack';
        confirmBtn.dataset.npcName = npcName;
        confirmBtn.innerHTML = '<i class="fas fa-check"></i>';
        
        // 附加新元素到選單
        npcInteractionMenu.appendChild(promptText);
        npcInteractionMenu.appendChild(cancelBtn);
        npcInteractionMenu.appendChild(confirmBtn);

        // 為新按鈕綁定事件
        cancelBtn.addEventListener('click', hideNpcInteractionMenu);
        confirmBtn.addEventListener('click', confirmAndInitiateAttack);
    }


    async function confirmAndInitiateAttack(event) {
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
        const targetIsNpc = event.target.closest('.npc-name');
        const targetIsMenu = event.target.closest('.npc-interaction-menu');

        if (targetIsNpc) {
            const npcName = targetIsNpc.dataset.npcName || targetIsNpc.textContent;
            showNpcInteractionMenu(targetIsNpc, npcName);
        } else if (!targetIsMenu) {
            hideNpcInteractionMenu();
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

    // --- 初始化 ---
    function initialize() {
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
        
        document.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'combat-confirm-btn') {
                handleConfirmCombatAction();
            }
        });

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
