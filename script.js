document.addEventListener('DOMContentLoaded', () => {

    // --- 獲取所有需要的DOM元素 ---
    const menuToggle = document.getElementById('menu-toggle');
    const gameContainer = document.querySelector('.game-container');
    const mainContent = document.getElementById('main-content');
    const themeSwitcher = document.getElementById('theme-switcher');
    const themeIcon = themeSwitcher.querySelector('i');
    
    const playerInput = document.getElementById('player-input');
    const submitButton = document.getElementById('submit-button');
    const storyPanel = document.getElementById('story-text-wrapper');
    const roundTitleEl = document.getElementById('round-title');
    const statusBarEl = document.getElementById('status-bar');

    const pcContent = document.getElementById('pc-content');
    const npcContent = document.getElementById('npc-content');
    const itmContent = document.getElementById('itm-content');
    const qstContent = document.getElementById('qst-content');
    const psyContent = document.getElementById('psy-content');
    const clsContent = document.getElementById('cls-content');
    
    // --- 漢堡選單邏輯 ---
    menuToggle.addEventListener('click', () => {
        gameContainer.classList.toggle('sidebar-open');
    });
    mainContent.addEventListener('click', () => {
        if(window.innerWidth <= 1024) {
            gameContainer.classList.remove('sidebar-open');
        }
    });

    // --- 主題切換邏輯 ---
    function applyTheme(theme) {
        if (theme === 'dark') {
            document.body.classList.add('dark-theme');
            document.body.classList.remove('light-theme');
            themeIcon.className = 'fas fa-sun';
        } else {
            document.body.classList.remove('dark-theme');
            document.body.classList.add('light-theme');
            themeIcon.className = 'fas fa-moon';
        }
    }
    
    let currentTheme = localStorage.getItem('game_theme') || 'light';
    applyTheme(currentTheme);

    themeSwitcher.addEventListener('click', () => {
        currentTheme = (currentTheme === 'light') ? 'dark' : 'light';
        localStorage.setItem('game_theme', currentTheme);
        applyTheme(currentTheme);
    });
    
    // --- 遊戲核心邏輯 ---
    // 【修正】: 填入您的後端網址
    const backendBaseUrl = 'https://ai-novel-final.onrender.com';
    let currentRound = 0;
    let isRequesting = false;

    submitButton.addEventListener('click', handlePlayerAction);
    playerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handlePlayerAction();
    });

    // 【補全】: 玩家行動處理函式
    async function handlePlayerAction() {
        const actionText = playerInput.value.trim();
        if (!actionText || isRequesting) return;

        isRequesting = true;
        playerInput.value = '';
        playerInput.disabled = true;
        submitButton.disabled = true;
        submitButton.textContent = '運算中...';
        
        appendMessageToStory(`> ${actionText}`, 'player-action-log');

        try {
            const response = await fetch(`${backendBaseUrl}/interact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: actionText,
                    round: currentRound,
                    model: 'gemini' // 目前預設使用gemini
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.story || '後端伺服器回應錯誤');
            }
            
            const data = await response.json();
            currentRound = data.roundData.R;
            updateUI(data.story, data.roundData);

        } catch (error) {
            console.error('與後端互動時出錯:', error);
            appendMessageToStory(`[系統] 連接世界時光長河失敗... (${error.message})`, 'system-message');
        } finally {
            isRequesting = false;
            playerInput.disabled = false;
            submitButton.disabled = false;
            submitButton.textContent = '運功';
            playerInput.focus();
        }
    }

    // 【補全】: 輔助函式，用於將訊息添加到故事面板
    function appendMessageToStory(text, className) {
        const p = document.createElement('p');
        p.textContent = text;
        if (className) {
            p.className = className;
        }
        storyPanel.appendChild(p);
        // 自動滾動到最下方
        storyPanel.parentElement.scrollTop = storyPanel.parentElement.scrollHeight;
    }

    // 更新UI函式 (您的版本已很完善)
    function updateUI(storyText, data) {
        appendMessageToStory(storyText, 'story-text');

        roundTitleEl.textContent = data.EVT || `第 ${data.R} 回`;
        
        const atmosphere = data.ATM ? data.ATM[0] : '未知';
        const weather = data.WRD || '晴朗';
        statusBarEl.innerHTML = `
            <div class="status-item"><i class="fas fa-cloud-sun"></i> 天氣: ${weather}</div>
            <div class="status-item"><i class="fas fa-theater-masks"></i> 氛圍: ${atmosphere}</div>
            <div class="status-item"><i class="fas fa-map-marked-alt"></i> 地點: ${data.LOC ? data.LOC[0] : '未知'}</div>
        `;

        pcContent.textContent = data.PC || '狀態穩定';
        npcContent.textContent = data.NPC || '未見人煙';
        itmContent.textContent = data.ITM || '行囊空空';
        qstContent.textContent = data.QST || '暫無要事';
        psyContent.textContent = data.PSY || '心如止水';
        clsContent.textContent = data.CLS || '尚無線索';
    }
    
    // 【補全】: 初始化遊戲函式
    async function initializeGame() {
        isRequesting = true;
        storyPanel.innerHTML = '<p class="system-message">正在連接你的世界，讀取記憶中...</p>';
        
        try {
            const response = await fetch(`${backendBaseUrl}/latest-game`);
            
            if (response.status === 404) { // 找不到存檔，開始新遊戲
                currentRound = 0;
                updateUI('你的旅程似乎尚未開始。請在下方輸入你的第一個動作，例如「睜開眼睛，環顧四周」。', {
                    R: 0, EVT: '楔子', ATM: ['迷茫'], WRD: '未知', LOC: ['未知之地'],
                    PC: '', NPC: '', ITM: '', QST: '', PSY: '我是誰...我在哪...', CLS: ''
                });
            } else if (!response.ok) {
                throw new Error('無法讀取遊戲進度');
            } else {
                const data = await response.json();
                currentRound = data.roundData.R;
                storyPanel.innerHTML = ''; // 清空載入訊息
                updateUI(data.story, data.roundData);
            }

        } catch (error) {
            console.error('初始化遊戲失敗:', error);
            storyPanel.innerHTML = `<p class="system-message">錯誤：無法初始化世界。 (${error.message})</p>`;
        } finally {
            isRequesting = false;
        }
    }

    // 遊戲開始
    initializeGame();
});
