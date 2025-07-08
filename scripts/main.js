// scripts/main.js
import { api } from './api.js';
import { updateUI, handleApiError, appendMessageToStory, addRoundTitleToStory } from './uiUpdater.js';
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
    const skillsBtn = document.getElementById('skills-btn');
    const bountiesBtn = document.getElementById('bounties-btn'); // 【核心新增】獲取懸賞按鈕
    const combatInput = document.getElementById('combat-input');
    const combatActionButton = document.getElementById('combat-action-btn');
    const combatSurrenderBtn = document.getElementById('combat-surrender-btn'); 
    const storyTextContainer = document.getElementById('story-text-wrapper');
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

    // 動態設定遊戲容器高度
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

    // 【核心新增】一個專門用來更新懸賞按鈕狀態的函式
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


    // --- 事件處理函式 ---
    async function handlePlayerAction() {
        const startTime = performance.now();
        const actionText = playerInput.value.trim();
        if (!actionText || gameState.isRequesting) return;

        if (actionText.toUpperCase() === '/GM') {
            playerInput.value = '';
            gmPanel.classList.add('visible');
            const activeMenu = gmMenu.querySelector('a.active');
            if (activeMenu) {
                const targetPageId = activeMenu.getAttribute('href').substring(1);
                if (targetPageId === 'player-stats') loadPlayerStatsData();
                if (targetPageId === 'npc-management') loadNpcManagementData();
                if (targetPageId === 'location-editor') loadLocationManagementData();
            }
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

                // 【核心修改】在收到回應後，更新懸賞按鈕狀態
                updateBountyButton(data.hasNewBounties);

                if (data.roundData.playerState === 'dead') {
                    setLoadingState(false);
                    handlePlayerDeath();
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
            if (!document.getElementById('epilogue-modal').classList.contains('visible')) {
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
                if (error.message && error.message.includes('並未見到')) {
                    appendMessageToStory(error.message, 'system-message');
                } else {
                    handleApiError(error);
                }
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
                addRoundTitleToStory(data.roundData.EVT || `第 ${data.roundData.R} 回`);
                updateUI(data.story, data.roundData, data.randomEvent, data.locationData);
                gameState.currentRound = data.roundData.R;
                gameState.roundData = data.roundData;
                updateBountyButton(data.hasNewBounties); //【核心修改】結束對話後也更新懸賞狀態
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
                updateBountyButton(data.hasNewBounties); //【核心修改】贈予物品後也更新懸賞狀態
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

    // --- GM面板功能函式 ---
    async function loadPlayerStatsData() {
        const page = document.getElementById('player-stats');
        page.innerHTML = '<h3>玩家屬性編輯</h3><p>正在載入數據...</p>';
        try {
            const itemTemplates = await api.getItemTemplatesForGM();
            
            let optionsHtml = '<option value="">-- 請選擇物品 --</option>';
            itemTemplates.forEach(item => {
                optionsHtml += `<option value="${item.name}">${item.name}</option>`;
            });

            page.innerHTML = `
                <h3>玩家屬性編輯</h3>
                <div class="gm-form-section">
                    <h4><i class="fa-solid fa-coins"></i> 金錢修改</h4>
                    <div class="gm-input-group">
                        <label for="gm-money">持有金錢</label>
                        <input type="number" id="gm-money" class="gm-input" placeholder="請輸入數量">
                        <button id="gm-save-money" class="gm-button save">設定</button>
                    </div>
                </div>
                <div class="gm-form-section">
                    <h4><i class="fa-solid fa-box-archive"></i> 物品增減</h4>
                    <div class="gm-input-group">
                        <label for="gm-item-select">選擇物品</label>
                        <select id="gm-item-select" class="gm-select">${optionsHtml}</select>
                        <input type="number" id="gm-item-quantity" class="gm-input" value="1">
                        <div class="gm-button-group">
                            <button id="gm-add-item" class="gm-button save">增加</button>
                            <button id="gm-remove-item" class="gm-button" style="background-color:#e03131;">移除</button>
                        </div>
                    </div>
                </div>
            `;

            // 綁定新按鈕的事件
            document.getElementById('gm-save-money').addEventListener('click', async (e) => {
                const money = document.getElementById('gm-money').value;
                if (money === '' || isNaN(money)) { alert('請輸入有效的數字'); return; }
                
                e.target.textContent = '設定中...';
                e.target.disabled = true;
                try {
                    await api.updatePlayerResourcesForGM({ money: Number(money) });
                    e.target.textContent = '設定成功!';
                } catch (error) {
                    e.target.textContent = '錯誤';
                } finally {
                    setTimeout(() => { e.target.textContent = '設定'; e.target.disabled = false; }, 2000);
                }
            });

            const handleItemChange = async (action) => {
                const itemName = document.getElementById('gm-item-select').value;
                const quantity = document.getElementById('gm-item-quantity').value;
                if (!itemName) { alert('請選擇一個物品'); return; }
                if (!quantity || isNaN(quantity) || Number(quantity) <= 0) { alert('請輸入有效的數量'); return; }

                const buttonId = action === 'add' ? 'gm-add-item' : 'gm-remove-item';
                const button = document.getElementById(buttonId);
                button.textContent = '處理中...';
                button.disabled = true;

                try {
                    await api.updatePlayerResourcesForGM({
                        itemChange: { action, itemName, quantity: Number(quantity) }
                    });
                    button.textContent = '操作成功!';
                } catch (error) {
                    button.textContent = '錯誤';
                } finally {
                    setTimeout(() => { button.textContent = action === 'add' ? '增加' : '移除'; button.disabled = false; }, 2000);
                }
            };

            document.getElementById('gm-add-item').addEventListener('click', () => handleItemChange('add'));
            document.getElementById('gm-remove-item').addEventListener('click', () => handleItemChange('remove'));

        } catch (error) {
             page.innerHTML = `<h3>玩家屬性編輯</h3><p>載入數據失敗: ${error.message}</p>`;
        }
    }
    
    async function loadNpcManagementData() {
        const page = document.getElementById('npc-management');
        page.innerHTML = '<h3>NPC關係管理</h3><p>正在從後端獲取NPC列表...</p>';
        try {
            const npcList = await api.getNpcsForGM();
            const container = document.createElement('div');
            container.className = 'gm-grid-container';

            if (npcList.length === 0) {
                page.innerHTML = '<h3>NPC關係管理</h3><p>資料庫中尚無任何NPC檔案。</p>';
                return;
            }

            npcList.forEach(npc => {
                const card = document.createElement('div');
                card.className = 'gm-control-card';
                let cardBody;

                if (npc.isGhost) {
                    cardBody = `
                        <div class="gm-card-header">
                            <h4>${npc.name}</h4>
                            <span class="gm-status-tag ghost"><i class="fa-solid fa-ghost"></i> 黑戶檔案</span>
                        </div>
                        <div class="gm-card-body">
                           <p style="font-size: 0.9rem; color: #a0a0c0; text-align: center; flex-grow: 1;">此NPC存在於存檔中，但沒有詳細檔案。請重建檔案以進行管理。</p>
                           <button class="gm-button rebuild" data-npc-name="${npc.name}"><i class="fa-solid fa-user-check"></i> 重建檔案</button>
                        </div>
                    `;
                } else {
                    cardBody = `
                        <div class="gm-card-header">
                            <h4>${npc.name}</h4>
                        </div>
                        <div class="gm-card-body">
                            <div class="gm-control-group">
                                <label><span>友好度</span><span class="value-display" id="friend-val-${npc.id}">${npc.friendlinessValue}</span></label>
                                <input type="range" class="gm-slider" id="friend-slider-${npc.id}" min="-100" max="100" value="${npc.friendlinessValue}">
                            </div>
                            <div class="gm-control-group">
                                <label><span>心動值</span><span class="value-display" id="romance-val-${npc.id}">${npc.romanceValue}</span></label>
                                <input type="range" class="gm-slider" id="romance-slider-${npc.id}" min="0" max="100" value="${npc.romanceValue}">
                            </div>
                        </div>
                        <button class="gm-button save" data-npc-id="${npc.id}"><i class="fa-solid fa-floppy-disk"></i> 儲存變更</button>
                    `;
                }
                card.innerHTML = cardBody;
                container.appendChild(card);
            });

            page.innerHTML = '<h3>NPC關係管理</h3>';
            page.appendChild(container);
            
            bindGmCardEvents(container);

        } catch (error) {
            page.innerHTML = `<h3>NPC關係管理</h3><p>獲取資料失敗: ${error.message}</p>`;
        }
    }

    async function loadLocationManagementData() {
        const page = document.getElementById('location-editor');
        page.innerHTML = '<h3>地區編輯</h3><p>正在從後端獲取地區列表...</p>';
        try {
            const locList = await api.getLocationsForGM();
            const container = document.createElement('div');
            container.className = 'gm-grid-container';

            if (locList.length === 0) {
                page.innerHTML = '<h3>地區編輯</h3><p>資料庫中尚無任何地區檔案。</p>';
                return;
            }

            locList.forEach(loc => {
                const card = document.createElement('div');
                card.className = 'gm-control-card';
                let cardBody;
                 if (loc.isGhost) {
                    cardBody = `
                        <div class="gm-card-header">
                            <h4>${loc.name}</h4>
                            <span class="gm-status-tag ghost"><i class="fa-solid fa-map-pin"></i> 未知地區</span>
                        </div>
                        <div class="gm-card-body">
                           <p style="font-size: 0.9rem; color: #a0a0c0; text-align: center; flex-grow: 1;">此地區存在於存檔中，但沒有詳細檔案。請重建檔案以進行管理。</p>
                           <button class="gm-button rebuild" data-location-name="${loc.name}"><i class="fa-solid fa-map-location-dot"></i> 重建檔案</button>
                        </div>
                    `;
                } else {
                    cardBody = `
                        <div class="gm-card-header">
                            <h4>${loc.name}</h4>
                        </div>
                        <div class="gm-card-body">
                            <p style="font-size: 0.9rem; color: #a0a0c0; text-align: center; flex-grow: 1;">詳細編輯功能開發中...</p>
                        </div>
                        <button class="gm-button save" disabled><i class="fa-solid fa-pen-to-square"></i> 編輯</button>
                    `;
                }
                card.innerHTML = cardBody;
                container.appendChild(card);
            });
            
            page.innerHTML = '<h3>地區編輯</h3>';
            page.appendChild(container);
            
            bindGmCardEvents(container);

        } catch (error) {
            page.innerHTML = `<h3>地區編輯</h3><p>獲取資料失敗: ${error.message}</p>`;
        }
    }

    function bindGmCardEvents(container) {
        container.querySelectorAll('.gm-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                document.getElementById(e.target.id.replace('slider', 'val')).textContent = e.target.value;
            });
        });

        container.querySelectorAll('.gm-button.save').forEach(button => {
            button.addEventListener('click', async (e) => {
                const npcId = e.target.dataset.npcId;
                const friendliness = document.getElementById(`friend-slider-${npcId}`).value;
                const romance = document.getElementById(`romance-slider-${npcId}`).value;
                e.target.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 儲存中...`;
                e.target.disabled = true;
                try {
                    const result = await api.updateNpcForGM({ npcId, friendlinessValue: friendliness, romanceValue: romance });
                    e.target.innerHTML = `<i class="fa-solid fa-check"></i> ${result.message}`;
                } catch (error) {
                    e.target.innerHTML = `<i class="fa-solid fa-xmark"></i> 錯誤`;
                } finally {
                    setTimeout(() => {
                       e.target.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> 儲存變更`;
                       e.target.disabled = false;
                    }, 2000);
                }
            });
        });

        container.querySelectorAll('.gm-button.rebuild').forEach(button => {
            button.addEventListener('click', async (e) => {
                e.target.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 重建中...`;
                e.target.disabled = true;
                try {
                    let result;
                    if (e.target.dataset.npcName) {
                        result = await api.rebuildNpcForGM({ npcName: e.target.dataset.npcName });
                    } else if (e.target.dataset.locationName) {
                        result = await api.rebuildLocationForGM({ locationName: e.target.dataset.locationName });
                    }
                    e.target.innerHTML = `<i class="fa-solid fa-check"></i> ${result.message}`;
                } catch (error) {
                     e.target.innerHTML = `<i class="fa-solid fa-xmark"></i> 錯誤`;
                } finally {
                     setTimeout(() => {
                        const activeMenu = gmMenu.querySelector('a.active');
                        if (activeMenu.getAttribute('href') === '#npc-management') loadNpcManagementData();
                        if (activeMenu.getAttribute('href') === '#location-editor') loadLocationManagementData();
                     }, 2000);
                }
            });
        });
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

        let preferredModel = localStorage.getItem('preferred_ai_model') || 'openai';
        aiModelSelector.value = preferredModel;

        aiModelSelector.addEventListener('change', () => {
            const selectedModel = aiModelSelector.value;
            localStorage.setItem('preferred_ai_model', selectedModel);
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

        // 【核心新增】為懸賞按鈕添加點擊事件，點擊後立即移除光暈
        if (bountiesBtn) {
            bountiesBtn.addEventListener('click', () => {
                updateBountyButton(false);
            });
        }

        gmCloseBtn.addEventListener('click', () => gmPanel.classList.remove('visible'));
        gmPanel.addEventListener('click', (e) => {
            if (e.target === gmPanel) {
                gmPanel.classList.remove('visible');
            }
        });
        gmMenu.addEventListener('click', (e) => {
            e.preventDefault();
            const link = e.target.closest('a');
            if (!link) return;

            gmMenu.querySelectorAll('a').forEach(a => a.classList.remove('active'));
            link.classList.add('active');

            const targetPageId = link.getAttribute('href').substring(1);
            gmContent.querySelectorAll('.gm-page').forEach(page => page.classList.remove('active'));
            document.getElementById(targetPageId).classList.add('active');
            
            if (targetPageId === 'player-stats') loadPlayerStatsData();
            if (targetPageId === 'npc-management') loadNpcManagementData();
            if (targetPageId === 'location-editor') loadLocationManagementData();
        });


        submitButton.addEventListener('click', handlePlayerAction);
        playerInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); handlePlayerAction(); } });
        combatActionButton.addEventListener('click', handleCombatAction);
        combatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); handleCombatAction(); } });
        combatSurrenderBtn.addEventListener('click', handleSurrender); 
        storyTextContainer.addEventListener('click', handleNpcClick);
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
            
            if (data.roundData && data.roundData.preferredModel) {
                 aiModelSelector.value = data.roundData.preferredModel;
                 localStorage.setItem('preferred_ai_model', data.roundData.preferredModel);
            }
            
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

                // 【核心修改】在初始載入時，更新懸賞按鈕狀態
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
