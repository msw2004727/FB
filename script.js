document.addEventListener('DOMContentLoaded', () => {
    // --- 【守衛】登入狀態驗證 ---
    const token = localStorage.getItem('jwt_token');
    const username = localStorage.getItem('username');

    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    // --- 獲取所有需要的DOM元素 ---
    const storyHeader = document.querySelector('.story-header');
    const headerToggleButton = document.getElementById('header-toggle-btn');
    const storyPanelWrapper = document.querySelector('.story-panel');
    const storyTextContainer = document.getElementById('story-text-wrapper');
    const playerInput = document.getElementById('player-input');
    const submitButton = document.getElementById('submit-button');
    const roundTitleEl = document.getElementById('round-title');
    const statusBarEl = document.getElementById('status-bar');
    const aiModelSelector = document.getElementById('ai-model-selector');
    const pcContent = document.getElementById('pc-content');
    
    const internalPowerBar = document.getElementById('internal-power-bar');
    const internalPowerValue = document.getElementById('internal-power-value');
    const externalPowerBar = document.getElementById('external-power-bar');
    const externalPowerValue = document.getElementById('external-power-value');
    
    const moralityBarIndicator = document.getElementById('morality-bar-indicator');
    const npcContent = document.getElementById('npc-content');
    const itmContent = document.getElementById('itm-content');
    const qstContent = document.getElementById('qst-content');
    const psyContent = document.getElementById('psy-content');
    const clsContent = document.getElementById('cls-content');
    const welcomeMessage = document.getElementById('welcome-message');
    const menuToggle = document.getElementById('menu-toggle');
    const gameContainer = document.querySelector('.game-container');
    const mainContent = document.getElementById('main-content');
    const themeSwitcher = document.getElementById('theme-switcher');
    const themeIcon = themeSwitcher.querySelector('i');
    const logoutButton = document.getElementById('logout-btn');
    const actionSuggestion = document.getElementById('action-suggestion');
    
    const suicideButton = document.getElementById('suicide-btn');
    const deceasedOverlay = document.getElementById('deceased-overlay');
    const deceasedTitle = document.getElementById('deceased-title');
    const restartButton = document.getElementById('restart-btn');

    const combatModal = document.getElementById('combat-modal');
    const combatTitle = document.getElementById('combat-title');
    const combatEnemies = document.getElementById('combat-enemies');
    const combatLog = document.getElementById('combat-log');
    const combatInput = document.getElementById('combat-input');
    const combatActionButton = document.getElementById('combat-action-btn');

    const aiThinkingLoader = document.createElement('div');
    aiThinkingLoader.className = 'ai-thinking-loader';
    aiThinkingLoader.innerHTML = `
        <div class="loader-text"></div>
        <div class="loader-dots">
            <span></span>
            <span></span>
            <span></span>
        </div>
    `;
    storyPanelWrapper.appendChild(aiThinkingLoader);

    if (welcomeMessage && username) {
        welcomeMessage.textContent = `${username}，歡迎回來。`;
    }
    
    if(headerToggleButton && storyHeader) {
        headerToggleButton.addEventListener('click', () => {
            storyHeader.classList.toggle('collapsed');
            const icon = headerToggleButton.querySelector('i');
            if (storyHeader.classList.contains('collapsed')) {
                icon.classList.remove('fa-chevron-up');
                icon.classList.add('fa-chevron-down');
            } else {
                icon.classList.remove('fa-chevron-down');
                icon.classList.add('fa-chevron-up');
            }
        });
    }


    // --- 漢堡選單與主題切換 ---
    menuToggle.addEventListener('click', () => gameContainer.classList.toggle('sidebar-open'));
    mainContent.addEventListener('click', () => {
        if (window.innerWidth <= 1024) gameContainer.classList.remove('sidebar-open');
    });

    function applyTheme(theme) {
        document.body.className = theme === 'dark' ? 'dark-theme' : 'light-theme';
        themeIcon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
    let currentTheme = localStorage.getItem('game_theme') || 'light';
    applyTheme(currentTheme);
    themeSwitcher.addEventListener('click', () => {
        currentTheme = (currentTheme === 'light') ? 'dark' : 'light';
        localStorage.setItem('game_theme', currentTheme);
        applyTheme(currentTheme);
    });
    
    // --- 登出、自殺、重新開始的邏輯 ---
    logoutButton.addEventListener('click', () => {
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('username');
        window.location.href = 'login.html';
    });
    
    suicideButton.addEventListener('click', async () => {
        if (isRequesting) return;
        const confirmation = window.confirm("你確定要了卻此生，重新輪迴嗎？");
        if (confirmation) {
            setLoadingState(true);
            try {
                const response = await fetch(`${backendBaseUrl}/api/game/force-suicide`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.message || '後端伺服器發生未知錯誤');

                updateUI(data.story, data.roundData, data.randomEvent);
                showDeceasedScreen();
                
            } catch (error) {
                handleApiError(error);
            } finally {
                if(!deceasedOverlay.classList.contains('visible')) {
                    setLoadingState(false);
                }
            }
        }
    });

    restartButton.addEventListener('click', async () => {
        try {
            const response = await fetch(`${backendBaseUrl}/api/game/restart`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || '開啟輪迴失敗');
            }
            window.location.reload();
        } catch (error) {
            console.error('重新開始失敗:', error);
            alert(`開啟新的輪迴時發生錯誤：${error.message}`);
        }
    });

    // --- AI核心切換提示 ---
    aiModelSelector.addEventListener('change', (event) => {
        const selectedModelName = event.target.options[event.target.selectedIndex].text;
        const notification = document.createElement('p');
        notification.textContent = `[系統] AI 核心已切換為 ${selectedModelName}。`;
        notification.className = 'system-message';
        notification.style.color = '#28a745';
        notification.style.fontWeight = 'bold';
        storyTextContainer.appendChild(notification);
        storyPanelWrapper.scrollTop = storyPanelWrapper.scrollHeight;
        setTimeout(() => { notification.remove(); }, 4000);
    });

    // --- 遊戲核心邏輯 ---
    const backendBaseUrl = 'https://ai-novel-final.onrender.com';
    let currentRound = 0;
    let isRequesting = false;
    let isInCombat = false;

    submitButton.addEventListener('click', handlePlayerAction);
    playerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); handlePlayerAction(); }
    });

    combatActionButton.addEventListener('click', handleCombatAction);
    combatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); handleCombatAction(); }
    });


    async function handlePlayerAction() {
        const actionText = playerInput.value.trim();
        if (!actionText || isRequesting || isInCombat) return;

        playerInput.value = '';
        actionSuggestion.textContent = '';
        setLoadingState(true);
        appendMessageToStory(`> ${actionText}`, 'player-action-log');

        try {
            const response = await fetch(`${backendBaseUrl}/api/game/interact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ action: actionText, round: currentRound, model: aiModelSelector.value })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || '後端伺服器發生未知錯誤');
            
            if (data.combatInfo && data.combatInfo.status === 'COMBAT_START') {
                startCombat(data.combatInfo.initialState);
                appendMessageToStory(data.story, 'story-text');
                updateUI(null, data.roundData, data.randomEvent);
            } else {
                currentRound = data.roundData.R;
                updateUI(data.story, data.roundData, data.randomEvent);
            }
            
            if (data.suggestion) {
                actionSuggestion.textContent = `書僮小聲說：${data.suggestion}`;
            }
            
            if (data.roundData.playerState === 'dead') {
                showDeceasedScreen();
            }

        } catch (error) {
            handleApiError(error);
        } finally {
            setLoadingState(false);
        }
    }

    function startCombat(initialState) {
        isInCombat = true;
        combatModal.classList.add('visible');
        playerInput.disabled = true;
        submitButton.disabled = true;

        const enemyNames = initialState.enemies.map(e => e.name).join('、');
        combatTitle.textContent = `遭遇強敵`;
        combatEnemies.textContent = `對手: ${enemyNames}`;
        
        combatLog.innerHTML = '';
        initialState.log.forEach(line => appendToCombatLog(line));
        
        combatInput.focus();
    }

    async function handleCombatAction() {
        const actionText = combatInput.value.trim();
        if (!actionText || isRequesting) return;

        combatInput.value = '';
        setLoadingState(true, '運息應對中...');
        appendToCombatLog(`> ${actionText}`);

        try {
            const response = await fetch(`${backendBaseUrl}/api/game/combat-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ action: actionText })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || '戰鬥中發生錯誤');

            if (data.status === 'COMBAT_ONGOING') {
                appendToCombatLog(data.narrative);
            } else if (data.status === 'COMBAT_END') {
                endCombat(data.outcome);
            }

        } catch (error) {
            appendToCombatLog(`[系統錯誤] ${error.message}`);
        } finally {
            setLoadingState(false);
            combatInput.focus();
        }
    }

    function endCombat(outcome) {
        let outcomeHtml = `<p class="combat-summary-title">戰鬥結束</p>`;
        outcomeHtml += `<p>${outcome.summary}</p>`;
        if (outcome.playerChanges.PC) {
            outcomeHtml += `<p>狀態變化: ${outcome.playerChanges.PC}</p>`;
        }
        if (outcome.playerChanges.ITM) {
            outcomeHtml += `<p>獲得物品: ${outcome.playerChanges.ITM}</p>`;
        }
        appendToCombatLog(outcomeHtml, 'combat-summary');

        combatInput.disabled = true;
        combatActionButton.textContent = "關閉";
        combatActionButton.onclick = () => {
            combatModal.classList.remove('visible');
            isInCombat = false;
            playerInput.disabled = false;
            submitButton.disabled = false;
            combatInput.disabled = false;
            combatActionButton.textContent = "行動";
            combatActionButton.onclick = handleCombatAction;
            window.location.reload();
        };
    }
    
    function appendToCombatLog(text, className) {
        const p = document.createElement('p');
        if (className) p.className = className;
        p.innerHTML = text.replace(/\n/g, '<br>');
        combatLog.appendChild(p);
        combatLog.scrollTop = combatLog.scrollHeight;
    }

    async function initializeGame() {
        setLoadingState(true, '江湖說書人正在努力撰寫中...');

        try {
            const response = await fetch(`${backendBaseUrl}/api/game/latest-game`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.status === 404) {
                startNewGame();
                return;
            }
            
            if (!response.ok) {
                 const errorData = await response.json();
                 throw new Error(errorData.message || `伺服器錯誤: ${response.status}`);
            }

            const data = await response.json();

            if (data.gameState === 'deceased') {
                showDeceasedScreen();
                updateUI('', data.roundData || {}, null);
                return;
            }
            
            currentRound = data.roundData.R;
            storyTextContainer.innerHTML = '';

            if (data.prequel) {
                const prequelDiv = document.createElement('div');
                prequelDiv.className = 'prequel-summary';
                prequelDiv.innerHTML = `<h3>前情提要</h3><p>${data.prequel}</p>`;
                storyTextContainer.appendChild(prequelDiv);
            }
            
            updateUI(data.story, data.roundData, null);
            
            if (data.suggestion) {
                actionSuggestion.textContent = `書僮小聲說：${data.suggestion}`;
            }

        } catch (error) {
            handleApiError(error);
        } finally {
            setLoadingState(false);
        }
    }

    function setLoadingState(isLoading, text = '') {
        isRequesting = isLoading;
        if (!isInCombat) {
            playerInput.disabled = isLoading;
            submitButton.disabled = isLoading;
            submitButton.textContent = isLoading ? '撰寫中...' : '動作';
        } else {
            combatInput.disabled = isLoading;
            combatActionButton.disabled = isLoading;
        }

        const loaderTextElement = aiThinkingLoader.querySelector('.loader-text');
        
        if (isLoading) {
            loaderTextElement.textContent = text;
            aiThinkingLoader.classList.add('visible');
        } else {
            aiThinkingLoader.classList.remove('visible');
            loaderTextElement.textContent = '';
        }

        if (!isLoading) {
            if (isInCombat) {
                combatInput.focus();
            } else {
                playerInput.focus();
            }
        }
    }
    
    function showDeceasedScreen() {
        deceasedTitle.textContent = `${username || '你'}的江湖路已到盡頭`;
        deceasedOverlay.classList.add('visible');
        setLoadingState(true);
    }

    function startNewGame() {
        currentRound = 0;
        storyTextContainer.innerHTML = '';
        updateUI('你的旅程似乎尚未開始。請在下方輸入你的第一個動作，例如「睜開眼睛，環顧四周」。', {
            R: 0, EVT: '楔子', ATM: ['迷茫'], WRD: '未知', LOC: ['未知之地'],
            PC: '身體虛弱，內息紊亂', NPC: [], ITM: '', QST: '', PSY: '我是誰...我在哪...', CLS: '',
            timeOfDay: '上午',
            internalPower: 5,
            externalPower: 5,
            morality: 0,
            yearName: '元祐', year: 1, month: 1, day: 1
        }, null);
        actionSuggestion.textContent = `書僮小聲說：試著探索一下四周環境吧。`;
    }

    function appendMessageToStory(htmlContent, className) {
        const p = document.createElement('p');
        p.innerHTML = htmlContent;
        if (className) p.className = className;
        storyTextContainer.appendChild(p);
        storyPanelWrapper.scrollTop = storyPanelWrapper.scrollHeight;
    }

    function highlightNpcNames(text, npcs) {
        if (!text) return '';
        let highlightedText = text;
        if (npcs && Array.isArray(npcs) && npcs.length > 0) {
            const sortedNpcs = [...npcs].sort((a, b) => b.name.length - a.name.length);
            sortedNpcs.forEach(npc => {
                const regex = new RegExp(npc.name, 'g');
                const replacement = `<span class="npc-name npc-${npc.friendliness}">${npc.name}</span>`;
                highlightedText = highlightedText.replace(regex, replacement);
            });
        }
        return highlightedText;
    }

    function updateMoralityBar(moralityValue) {
        if (moralityBarIndicator) {
            const percentage = (moralityValue + 100) / 200 * 100;
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
        const maxPower = 999;
        if (barElement && valueElement) {
            const percentage = Math.min((currentValue / maxPower) * 100, 100);
            barElement.style.width = `${percentage}%`;
            valueElement.textContent = `${currentValue}/${maxPower}`;
        }
    }

    function updateUI(storyText, data, randomEvent) {
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
        if (!data) return; // 如果沒有 data 就提前退出

        roundTitleEl.textContent = data.EVT || `第 ${data.R || 0} 回`;
        
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

        const internal = data.internalPower === undefined ? 0 : data.internalPower;
        const external = data.externalPower === undefined ? 0 : data.externalPower;
        updatePowerBar(internalPowerBar, internalPowerValue, internal);
        updatePowerBar(externalPowerBar, externalPowerValue, external);
        
        updateMoralityBar(data.morality === undefined ? 0 : data.morality);

        npcContent.innerHTML = '';
        if (data.NPC && Array.isArray(data.NPC) && data.NPC.length > 0) {
            data.NPC.forEach(npc => {
                const npcLine = document.createElement('div');
                npcLine.innerHTML = `<span class="npc-name npc-${npc.friendliness}">${npc.name}</span>: ${npc.status || '狀態不明'}`;
                npcContent.appendChild(npcLine);
            });
        } else {
            npcContent.textContent = '未見人煙';
        }

        itmContent.textContent = data.ITM || '行囊空空';
        qstContent.textContent = data.QST || '暫無要事';
        psyContent.textContent = data.PSY || '心如止水';
        clsContent.textContent = data.CLS || '尚無線索';
    }
    
    function handleApiError(error) {
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

    initializeGame();
});
