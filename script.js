document.addEventListener('DOMContentLoaded', () => {

    // --- DOM 元素 ---
    const themeSwitcher = document.getElementById('theme-switcher');
    const themeIcon = themeSwitcher.querySelector('i');
    const playerInput = document.getElementById('player-input');
    const submitButton = document.getElementById('submit-button');
    const storyPanel = document.getElementById('story-panel');
    const aiSelector = document.getElementById('ai-selector'); // 新增：獲取AI選擇器

    // --- 遊戲設定 ---
    const backendBaseUrl = 'https://ai-novel-final.onrender.com'; // 您的雲端後端網址
    let currentRound = 0;
    
    // --- 初始化 ---
    initializeTheme();
    initializeGame();

    // --- 事件監聽 ---
    themeSwitcher.addEventListener('click', toggleTheme);
    submitButton.addEventListener('click', handlePlayerAction);
    playerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handlePlayerAction();
    });

    // --- 函式定義 ---

    /**
     * 初始化主題
     */
    function initializeTheme() {
        if (localStorage.getItem('theme') === 'dark-mode') {
            document.body.classList.add('dark-mode');
            themeIcon.classList.replace('fa-sun', 'fa-moon');
        }
    }

    /**
     * 切換主題
     */
    function toggleTheme() {
        document.body.classList.toggle('dark-mode');
        const isDarkMode = document.body.classList.contains('dark-mode');
        localStorage.setItem('theme', isDarkMode ? 'dark-mode' : 'light-mode');
        themeIcon.classList.toggle('fa-sun', !isDarkMode);
        themeIcon.classList.toggle('fa-moon', isDarkMode);
    }

    /**
     * 處理玩家的主要行動
     */
    async function handlePlayerAction() {
        const actionText = playerInput.value.trim();
        if (!actionText) return;

        const selectedModel = aiSelector.value; // 獲取當前選擇的AI模型

        appendMessageToStory(`> ${actionText}`, 'player-action-log');
        playerInput.value = '';
        submitButton.disabled = true;
        submitButton.textContent = '思考中...';

        try {
            const response = await fetch(`${backendBaseUrl}/interact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    action: actionText, 
                    round: currentRound,
                    model: selectedModel // 將選擇的模型名稱一起傳送給後端
                })
            });
            
            if (!response.ok) throw new Error(`伺服器錯誤: ${response.status}`);

            const data = await response.json();
            currentRound = data.roundData.R;
            updateUI(data.story); // UI更新很簡單，只顯示故事
        } catch (error) {
            console.error('與後端互動時出錯:', error);
            appendMessageToStory(`[系統錯誤] 無法與你的世界建立聯繫。(${error.message})`, 'system-message');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = '送出';
            playerInput.focus();
        }
    }

    /**
     * 將訊息附加到故事面板
     * @param {string} text - 要顯示的文字
     * @param {string} className - 要套用的CSS class
     */
    function appendMessageToStory(text, className) {
        const p = document.createElement('p');
        p.className = className;
        p.textContent = text;
        storyPanel.appendChild(p);
        storyPanel.scrollTop = storyPanel.scrollHeight;
    }

    /**
     * 更新UI介面 (簡化版)
     * @param {string} storyText - AI回傳的故事文字
     */
    function updateUI(storyText) {
        appendMessageToStory(storyText, 'story-text');
    }
    
    /**
     * 初始化遊戲，嘗試讀取最新進度
     */
    async function initializeGame() {
        try {
            const response = await fetch(`${backendBaseUrl}/latest-game`);
            if (response.ok) {
                const savedGame = await response.json();
                currentRound = savedGame.roundData.R;
                updateUI(savedGame.story);
                console.log(`成功讀取進度，目前在第 ${currentRound} 回合。`);
            } else {
                appendMessageToStory('未找到過去的記憶，你的故事將從此刻開始...', 'system-message');
            }
        } catch (error) {
            console.error("初始化遊戲時發生錯誤:", error);
            appendMessageToStory("[系統錯誤] 無法連接到後端伺服器來讀取進度。請檢查連線。", 'system-message');
        } finally {
            playerInput.focus();
        }
    }
});
