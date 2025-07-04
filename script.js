document.addEventListener('DOMContentLoaded', () => {
    // --- 【守衛】登入狀態驗證 ---
    const token = localStorage.getItem('jwt_token');
    const username = localStorage.getItem('username');

    if (!token) {
        // 如果沒有令牌，直接重定向到登入頁面
        window.location.href = 'login.html';
        return; // 停止執行後續程式碼
    }

    // --- 獲取所有需要的DOM元素 ---
    const menuToggle = document.getElementById('menu-toggle');
    const gameContainer = document.querySelector('.game-container');
    const mainContent = document.getElementById('main-content');
    const themeSwitcher = document.getElementById('theme-switcher');
    const themeIcon = themeSwitcher.querySelector('i');
    
    // 【新增】登出按鈕
    const logoutButton = document.getElementById('logout-btn');

    const playerInput = document.getElementById('player-input');
    const submitButton = document.getElementById('submit-button');
    const storyPanelWrapper = document.querySelector('.story-panel');
    const storyTextContainer = document.getElementById('story-text-wrapper');
    const roundTitleEl = document.getElementById('round-title');
    const statusBarEl = document.getElementById('status-bar');
    const aiModelSelector = document.getElementById('ai-model-selector');

    const pcContent = document.getElementById('pc-content');
    const npcContent = document.getElementById('npc-content');
    const itmContent = document.getElementById('itm-content');
    const qstContent = document.getElementById('qst-content');
    const psyContent = document.getElementById('psy-content');
    const clsContent = document.getElementById('cls-content');

    // 在儀表板顯示歡迎訊息
    const welcomeMessage = document.getElementById('welcome-message');
    if (welcomeMessage && username) {
        welcomeMessage.textContent = `${username}，歡迎回來。`;
    }

    // --- 漢堡選單與主題切換 (邏輯不變) ---
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
    
    // --- 【新增】登出邏輯 ---
    logoutButton.addEventListener('click', () => {
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('username');
        window.location.href = 'login.html';
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

    // 玩家行動處理函式
    async function handlePlayerAction() {
        const actionText = playerInput.value.trim();
        if (!actionText || isRequesting) return;

        const selectedModel = aiModelSelector.value;
        setLoadingState(true);
        appendMessageToStory(`> ${actionText}`, 'player-action-log');

        try {
            // 【已修正】將 /api/interact 修改為 /api/game/interact
            const response = await fetch(`${backendBaseUrl}/api/game/interact`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    action: actionText,
                    round: currentRound,
                    model: selectedModel
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || '後端伺服器發生未知錯誤');

            currentRound = data.roundData.R;
            updateUI(data.story, data.roundData);
        } catch (error) {
            handleApiError(error);
        } finally {
            setLoadingState(false);
        }
    }

    // 初始化遊戲
    async function initializeGame() {
        setLoadingState(true);
        appendMessageToStory('正在連接你的世界，讀取記憶中...', 'system-message');

        try {
            // 【已修正】將 /api/latest-game 修改為 /api/game/latest-game
            const response = await fetch(`${backendBaseUrl}/api/game/latest-game`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.status === 404) {
                startNewGame();
            } else if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || '無法讀取遊戲進度');
            } else {
                const data = await response.json();
                currentRound = data.roundData.R;
                storyTextContainer.innerHTML = '';
                updateUI(data.story, data.roundData);
            }
        } catch (error) {
            handleApiError(error);
        } finally {
            setLoadingState(false);
        }
    }

    // --- 輔助函式 ---

    function setLoadingState(isLoading) {
        isRequesting = isLoading;
        playerInput.disabled = isLoading;
        submitButton.disabled = isLoading;
        submitButton.textContent = isLoading ? '運算中...' : '運功';
        if (!isLoading) playerInput.focus();
    }
    
    function startNewGame() {
        currentRound = 0;
        storyTextContainer.innerHTML = '';
        updateUI('你的旅程似乎尚未開始。請在下方輸入你的第一個動作，例如「睜開眼睛，環顧四周」。', {
            R: 0, EVT: '楔子', ATM: ['迷茫'], WRD: '未知', LOC: ['未知之地'],
            PC: '身體虛弱，內息紊亂', NPC: '', ITM: '', QST: '', PSY: '我是誰...我在哪...', CLS: ''
        });
    }

    function appendMessageToStory(text, className) {
        const p = document.createElement('p');
        p.textContent = text;
        if (className) p.className = className;
        storyTextContainer.appendChild(p);
        storyPanelWrapper.scrollTop = storyPanelWrapper.scrollHeight;
    }

    function updateUI(storyText, data) {
        appendMessageToStory(storyText, 'story-text');
        roundTitleEl.textContent = data.EVT || `第 ${data.R} 回`;
        const atmosphere = data.ATM?.[0] || '未知';
        const weather = data.WRD || '晴朗';
        const location = data.LOC?.[0] || '未知之地';
        statusBarEl.innerHTML = `
            <div class="status-item"><i class="fas fa-cloud-sun"></i> 天氣: ${weather}</div>
            <div class="status-item"><i class="fas fa-theater-masks"></i> 氛圍: ${atmosphere}</div>
            <div class="status-item"><i class="fas fa-map-marked-alt"></i> 地點: ${location}</div>
        `;
        pcContent.textContent = data.PC || '狀態穩定';
        npcContent.textContent = data.NPC || '未見人煙';
        itmContent.textContent = data.ITM || '行囊空空';
        qstContent.textContent = data.QST || '暫無要事';
        psyContent.textContent = data.PSY || '心如止水';
        clsContent.textContent = data.CLS || '尚無線索';
    }
    
    function handleApiError(error) {
        console.error('API 錯誤:', error);
        appendMessageToStory(`[系統] 連接失敗... (${error.message})`, 'system-message');
        // 如果錯誤是401 (未授權)，可能令牌已過期，強制登出
        if (error.message.includes('未經授權') || error.message.includes('無效的身份令牌')) {
            setTimeout(() => {
                localStorage.removeItem('jwt_token');
                localStorage.removeItem('username');
                window.location.href = 'login.html';
            }, 3000);
        }
    }

    // 遊戲開始
    initializeGame();
});
