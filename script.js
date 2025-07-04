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
    
    // --- 登出邏輯 ---
    logoutButton.addEventListener('click', () => {
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('username');
        window.location.href = 'login.html';
    });

    // --- AI核心切換提示 ---
    aiModelSelector.addEventListener('change', (event) => {
        const selectedModelName = event.target.options[event.target.selectedIndex].text;
        const notification = document.createElement('p');
        notification.textContent = `[系統] AI 核心已切換為 ${selectedModelName}。`;
        notification.className = 'system-message';
        notification.style.color = '#28a745'; // 直接設定為綠色
        notification.style.fontWeight = 'bold';
        
        storyTextContainer.appendChild(notification);
        storyPanelWrapper.scrollTop = storyPanelWrapper.scrollHeight;

        // 4秒後自動移除提示訊息
        setTimeout(() => {
            notification.remove();
        }, 4000);
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
            PC: '身體虛弱，內息紊亂', NPC: [], ITM: '', QST: '', PSY: '我是誰...我在哪...', CLS: ''
        });
    }

    // 【已修改】將 textContent 改為 innerHTML 以支援HTML標籤渲染
    function appendMessageToStory(htmlContent, className) {
        const p = document.createElement('p');
        p.innerHTML = htmlContent; // 使用 innerHTML 讓 span 標籤生效
        if (className) p.className = className;
        storyTextContainer.appendChild(p);
        storyPanelWrapper.scrollTop = storyPanelWrapper.scrollHeight;
    }

    // 【新增】用於在高亮NPC姓名的輔助函式
    function highlightNpcNames(text, npcs) {
        let highlightedText = text;
        if (npcs && Array.isArray(npcs) && npcs.length > 0) {
            // 根據名字長度排序，長的先替換，避免 "李四" 被 "李" 先替換掉的問題
            const sortedNpcs = [...npcs].sort((a, b) => b.name.length - a.name.length);
            sortedNpcs.forEach(npc => {
                const regex = new RegExp(npc.name, 'g');
                const replacement = `<span class="npc-name npc-${npc.friendliness}">${npc.name}</span>`;
                highlightedText = highlightedText.replace(regex, replacement);
            });
        }
        return highlightedText;
    }

    // 【已修改】更新UI函式，以處理新的NPC資料結構和高亮姓名
    function updateUI(storyText, data) {
        // 高亮處理故事內文
        const processedStory = highlightNpcNames(storyText, data.NPC);
        appendMessageToStory(processedStory, 'story-text');

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
        
        // 更新儀表板中的NPC列表
        npcContent.innerHTML = ''; // 清空舊內容
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

    // 遊戲開始
    initializeGame();
});
