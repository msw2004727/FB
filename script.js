document.addEventListener('DOMContentLoaded', () => {
    // --- 主題切換器 ---
    const themeSwitcher = document.getElementById('theme-switcher');
    const themeIcon = themeSwitcher.querySelector('i');
    if (localStorage.getItem('theme') === 'dark-mode') {
        document.body.classList.add('dark-mode');
        themeIcon.classList.replace('fa-sun', 'fa-moon');
    }
    themeSwitcher.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDarkMode = document.body.classList.contains('dark-mode');
        localStorage.setItem('theme', isDarkMode ? 'dark-mode' : 'light-mode');
        themeIcon.classList.toggle('fa-sun', !isDarkMode);
        themeIcon.classList.toggle('fa-moon', isDarkMode);
    });

    // --- 遊戲邏輯 ---
    const playerInput = document.getElementById('player-input');
    const submitButton = document.getElementById('submit-button');
    const storyPanel = document.getElementById('story-panel');
    const backendBaseUrl = 'https://md-server-main.onrender.com';
    let currentRound = 0;

    submitButton.addEventListener('click', handlePlayerAction);
    playerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handlePlayerAction();
    });

    async function handlePlayerAction() {
        const actionText = playerInput.value.trim();
        if (!actionText) return;
        appendMessageToStory(`> ${actionText}`, 'player-action-log');
        playerInput.value = '';
        submitButton.disabled = true;

        const response = await fetch(`${backendBaseUrl}/interact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: actionText, round: currentRound })
        });
        
        if (response.ok) {
            const data = await response.json();
            currentRound = data.roundData.R;
            updateUI(data.story); // UI更新簡化了
        } else {
            appendMessageToStory('[系統錯誤] 無法與你的世界建立聯繫。', 'system-message');
        }
        submitButton.disabled = false;
        playerInput.focus();
    }

    function appendMessageToStory(text, className) {
        const p = document.createElement('p');
        p.className = className;
        p.textContent = text;
        storyPanel.appendChild(p);
        storyPanel.scrollTop = storyPanel.scrollHeight;
    }

    // *** 簡化後的UI更新函式 ***
    function updateUI(storyText) {
        appendMessageToStory(storyText, 'story-text');
    }
    
    // 遊戲初始化
    async function initializeGame() {
        const response = await fetch(`${backendBaseUrl}/latest-game`);
        if (response.ok) {
            const savedGame = await response.json();
            currentRound = savedGame.roundData.R;
            updateUI(savedGame.story); // UI更新簡化了
        } else {
            appendMessageToStory('未找到過去的記憶，你的故事將從此刻開始...', 'system-message');
        }
        playerInput.focus();
    }

    initializeGame();
});
