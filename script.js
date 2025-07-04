document.addEventListener('DOMContentLoaded', () => {

    // --- 獲取所有需要的DOM元素 ---
    const menuToggle = document.getElementById('menu-toggle');
    const gameContainer = document.querySelector('.game-container');
    const mainContent = document.getElementById('main-content');
    const themeSwitcher = document.getElementById('theme-switcher');
    const themeIcon = themeSwitcher.querySelector('i');

    const playerInput = document.getElementById('player-input');
    const submitButton = document.getElementById('submit-button');
    const storyPanelWrapper = document.querySelector('.story-panel'); // 用於滾動
    const storyTextContainer = document.getElementById('story-text-wrapper');
    const roundTitleEl = document.getElementById('round-title');
    const statusBarEl = document.getElementById('status-bar');

    // AI 模型選擇器
    const aiModelSelector = document.getElementById('ai-model-selector');

    // 儀表板卡片
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
        if (window.innerWidth <= 1024) {
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
    const backendBaseUrl = 'https://ai-novel-final.onrender.com';
    let currentRound = 0;
    let isRequesting = false;

    submitButton.addEventListener('click', handlePlayerAction);
    playerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // 防止換行
            handlePlayerAction();
        }
    });

    // 玩家行動處理函式
    async function handlePlayerAction() {
        const actionText = playerInput.value.trim();
        if (!actionText || isRequesting) return;

        const selectedModel = aiModelSelector.value;

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
                    model: selectedModel
                })
            });

            const data = await response.json(); // 嘗試先解析JSON

            if (!response.ok) {
                // 如果後端回傳錯誤，也使用其中的 story 訊息
                throw new Error(data.story || '後端伺服器發生未知錯誤');
            }

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

    // 將訊息附加到故事面板
    function appendMessageToStory(text, className) {
        const p = document.createElement('p');
        p.textContent = text;
        if (className) {
            p.className = className;
        }
        storyTextContainer.appendChild(p);
        // 自動滾動到最下方
        storyPanelWrapper.scrollTop = storyPanelWrapper.scrollHeight;
    }

    // 更新所有UI介面
    function updateUI(storyText, data) {
        appendMessageToStory(storyText, 'story-text');

        roundTitleEl.textContent = data.EVT || `第 ${data.R} 回`;

        const atmosphere = data.ATM && data.ATM.length > 0 ? data.ATM[0] : '未知';
        const weather = data.WRD || '晴朗';
        const location = data.LOC && data.LOC.length > 0 ? data.LOC[0] : '未知之地';

        statusBarEl.innerHTML = `
            <div class="status-item"><i class="fas fa-cloud-sun"></i> 天氣: ${weather}</div>
            <div class="status-item"><i class="fas fa-theater-masks"></i> 氛圍: ${atmosphere}</div>
            <div class="status-item"><i class="fas fa-map-marked-alt"></i> 地點: ${location}</div>
        `;

        // 更新儀表板，如果內容為空則顯示預設文字
        pcContent.textContent = data.PC || '狀態穩定';
        npcContent.textContent = data.NPC || '未見人煙';
        itmContent.textContent = data.ITM || '行囊空空';
        qstContent.textContent = data.QST || '暫無要事';
        psyContent.textContent = data.PSY || '心如止水';
        clsContent.textContent = data.CLS || '尚無線索';
    }

    // 初始化遊戲
    async function initializeGame() {
        isRequesting = true;
        submitButton.disabled = true;
        appendMessageToStory('正在連接你的世界，讀取記憶中...', 'system-message');

        try {
            const response = await fetch(`${backendBaseUrl}/latest-game`);

            if (response.status === 404) { // 找不到存檔，開始新遊戲
                currentRound = 0;
                storyTextContainer.innerHTML = ''; // 清空載入訊息
                updateUI('你的旅程似乎尚未開始。請在下方輸入你的第一個動作，例如「睜開眼睛，環顧四周」。', {
                    R: 0, EVT: '楔子', ATM: ['迷茫'], WRD: '未知', LOC: ['未知之地'],
                    PC: '身體虛弱，內息紊亂', NPC: '', ITM: '', QST: '', PSY: '我是誰...我在哪...', CLS: ''
                });
            } else if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || '無法讀取遊戲進度');
            } else {
                const data = await response.json();
                currentRound = data.roundData.R;
                storyTextContainer.innerHTML = ''; // 清空載入訊息
                updateUI(data.story, data.roundData);
            }

        } catch (error) {
            console.error('初始化遊戲失敗:', error);
            storyTextContainer.innerHTML = `<p class="system-message">錯誤：無法初始化世界。 (${error.message})</p>`;
        } finally {
            isRequesting = false;
            submitButton.disabled = false;
            playerInput.focus();
        }
    }

    // 遊戲開始
    initializeGame();
});
