document.addEventListener('DOMContentLoaded', () => {
    // --- 【守衛】登入狀態驗證 ---
    const token = localStorage.getItem('jwt_token');
    const username = localStorage.getItem('username');

    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    // --- 獲取所有需要的DOM元素 ---
    const storyPanelWrapper = document.querySelector('.story-panel');
    const storyTextContainer = document.getElementById('story-text-wrapper');
    const playerInput = document.getElementById('player-input');
    const submitButton = document.getElementById('submit-button');
    const roundTitleEl = document.getElementById('round-title');
    const statusBarEl = document.getElementById('status-bar');
    // 【新增】獲取時間狀態元素
    const timeStatusEl = document.getElementById('time-status');
    const aiModelSelector = document.getElementById('ai-model-selector');
    const pcContent = document.getElementById('pc-content');
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

                updateUI(data.story, data.roundData);
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
                headers: {
                    'Authorization': `Bearer ${token}`
                }
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

    submitButton.addEventListener('click', handlePlayerAction);
    playerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handlePlayerAction();
        }
    });

    async function handlePlayerAction() {
        const actionText = playerInput.value.trim();
        if (!actionText || isRequesting) return;

        playerInput.value = '';
        actionSuggestion.textContent = '';

        const selectedModel = aiModelSelector.value;
        setLoadingState(true);
        appendMessageToStory(`> ${actionText}`, 'player-action-log');

        try {
            const response = await fetch(`${backendBaseUrl}/api/game/interact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ action: actionText, round: currentRound, model: selectedModel })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || '後端伺服器發生未知錯誤');
            
            currentRound = data.roundData.R;
            updateUI(data.story, data.roundData);
            
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
            
            updateUI(data.story, data.roundData);
            
            if (data.suggestion) {
                actionSuggestion.textContent = `書僮小聲說：${data.suggestion}`;
            }

        } catch (error) {
            handleApiError(error);
        } finally {
            setLoadingState(false);
        }
    }

    // --- 輔助函式 ---
    function setLoadingState(isLoading, text = '') {
        isRequesting = isLoading;
        playerInput.disabled = isLoading;
        submitButton.disabled = isLoading;
        submitButton.textContent = isLoading ? '撰寫中...' : '動作';

        const loaderTextElement = aiThinkingLoader.querySelector('.loader-text');
        
        if (isLoading) {
            loaderTextElement.textContent = text;
            aiThinkingLoader.classList.add('visible');
        } else {
            aiThinkingLoader.classList.remove('visible');
            loaderTextElement.textContent = '';
        }

        if (!isLoading) playerInput.focus();
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
            timeOfDay: '上午' // 新玩家預設時間
        });
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

    function updateUI(storyText, data) {
        const processedStory = highlightNpcNames(storyText, data.NPC);
        appendMessageToStory(processedStory, 'story-text');

        roundTitleEl.textContent = data.EVT || `第 ${data.R} 回`;
        
        const atmosphere = data.ATM?.[0] || '未知';
        const weather = data.WRD || '晴朗';
        const location = data.LOC?.[0] || '未知之地';
        
        // 【已修改】更新狀態欄，現在包含時間
        statusBarEl.innerHTML = `
            <div class="status-item"><i class="fas fa-clock"></i> 時辰: 約${data.timeOfDay || '未知'}</div>
            <div class="status-item"><i class="fas fa-cloud-sun"></i> 天氣: ${weather}</div>
            <div class="status-item"><i class="fas fa-theater-masks"></i> 氛圍: ${atmosphere}</div>
            <div class="status-item"><i class="fas fa-map-marked-alt"></i> 地點: ${location}</div>
        `;

        pcContent.textContent = data.PC || '狀態穩定';
        
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
