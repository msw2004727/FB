document.addEventListener('DOMContentLoaded', () => {

    // --- 獲取所有需要的DOM元素 ---
    const menuToggle = document.getElementById('menu-toggle');
    const gameContainer = document.querySelector('.game-container');
    const mainContent = document.getElementById('main-content');
    const themeSwitcher = document.getElementById('theme-switcher');
    const themeIcon = themeSwitcher.querySelector('i');
    
    // 遊戲互動元素
    const playerInput = document.getElementById('player-input');
    const submitButton = document.getElementById('submit-button');
    const storyPanel = document.getElementById('story-text-wrapper');
    const roundTitleEl = document.getElementById('round-title');
    const statusBarEl = document.getElementById('status-bar');

    // 儀表板卡片內容元素
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
    // 點擊主內容區塊時關閉側邊欄 (在手機上)
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
    // (這部分與您之前的版本相似，但updateUI函式完全重寫)
    const backendBaseUrl = 'https://ai-novel-final.onrender.com'; // <--- 請填入您的後端網址
    let currentRound = 0;

    submitButton.addEventListener('click', handlePlayerAction);
    playerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handlePlayerAction();
    });

    async function handlePlayerAction() {
        // ... 此處的 handlePlayerAction 邏輯與您之前的版本相同 ...
    }

    function appendMessageToStory(text, className) {
        // ... 此處的 appendMessageToStory 邏輯與您之前的版本相同 ...
    }

    // *** 全新的UI更新函式 ***
    function updateUI(storyText, data) {
        // 1. 更新故事正文
        appendMessageToStory(storyText, 'story-text');

        // 2. 更新回合標題
        roundTitleEl.textContent = data.EVT || `第 ${data.R} 回`;
        
        // 3. 更新頂部狀態欄
        const atmosphere = data.ATM ? data.ATM[0] : '未知';
        const weather = data.WRD || '晴朗'; // 假設WRD主要描述天氣
        statusBarEl.innerHTML = `
            <div class="status-item"><i class="fas fa-cloud-sun"></i> 天氣: ${weather}</div>
            <div class="status-item"><i class="fas fa-theater-masks"></i> 氛圍: ${atmosphere}</div>
            <div class="status-item"><i class="fas fa-map-marked-alt"></i> 地點: ${data.LOC ? data.LOC[0] : '未知'}</div>
        `;

        // 4. 更新儀表板卡片
        pcContent.textContent = data.PC || '狀態穩定';
        npcContent.textContent = data.NPC || '未見人煙';
        itmContent.textContent = data.ITM || '行囊空空';
        qstContent.textContent = data.QST || '暫無要事';
        psyContent.textContent = data.PSY || '心如止水';
        clsContent.textContent = data.CLS || '尚無線索';
    }
    
    async function initializeGame() {
        // ... 此處的 initializeGame 邏輯與您之前的版本相同 ...
    }

    // 確保將 handlePlayerAction 和 initializeGame 函式中
    // 對舊UI更新函式的呼叫，改為新的 updateUI(story, roundData)
    // 並且，在 fetch 成功後，您需要像這樣呼叫它：
    // if(response.ok) {
    //     const data = await response.json();
    //     currentRound = data.roundData.R;
    //     updateUI(data.story, data.roundData); // 傳入整個 roundData
    // }
});
