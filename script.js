document.addEventListener('DOMContentLoaded', () => {

    // --- 主題切換器 ---
    const themeSwitcher = document.getElementById('theme-switcher');
    const themeIcon = themeSwitcher.querySelector('i');

    // 載入時檢查並應用主題
    if (localStorage.getItem('theme') === 'dark-mode') {
        document.body.classList.add('dark-mode');
        themeIcon.classList.remove('fa-sun');
        themeIcon.classList.add('fa-moon');
    }

    themeSwitcher.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        if (document.body.classList.contains('dark-mode')) {
            localStorage.setItem('theme', 'dark-mode');
            themeIcon.classList.remove('fa-sun');
            themeIcon.classList.add('fa-moon');
        } else {
            localStorage.setItem('theme', 'light-mode');
            themeIcon.classList.remove('fa-moon');
            themeIcon.classList.add('fa-sun');
        }
    });

    // --- 拖曳功能初始化 ---
    const dashboard = document.getElementById('info-dashboard');
    new Sortable(dashboard, {
        animation: 150,
        handle: '.card-header', // 只能透過點擊頭部來拖曳
        ghostClass: 'sortable-ghost'
    });

    // --- 遊戲邏輯 ---
    const playerInput = document.getElementById('player-input');
    const submitButton = document.getElementById('submit-button');
    const storyPanel = document.getElementById('story-panel');
    const backendBaseUrl = 'https://md-server-main.onrender.com'; // 您的雲端後端網址
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
            updateUI(data.story, data.roundData);
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

    // *** 全新的UI更新函式 ***
    function updateUI(storyText, data) {
        appendMessageToStory(storyText, 'story-text');

        // 更新各個卡片內容
        updateCardContent('pc-content', data.PC, 'table');
        updateCardContent('psy-content', data.PSY);
        updateCardContent('itm-content', data.ITM, 'table');
        updateCardContent('qst-content', data.QST, 'table');
        updateCardContent('npc-content', data.NPC, 'table');
        updateCardContent('cls-content', data.CLS);
        updateCardContent('lor-content', data.LOR);
        updateCardContent('loc-content', data.LOC.join(' - '));
        updateCardContent('atm-content', data.ATM.join(' / '));
        updateCardContent('wrd-content', data.WRD);
        updateCardContent('evt-content', data.EVT);
        updateCardContent('imp-content', data.IMP);
    }
    
    function updateCardContent(elementId, content, format = 'text') {
        const element = document.getElementById(elementId);
        if (!element || !content) {
            if(element) element.innerHTML = '無';
            return;
        };

        if (format === 'table' && typeof content === 'string') {
            let tableHTML = '<table>';
            const items = content.split('；'); // 用分號分隔多個項目
            items.forEach(item => {
                if(!item) return;
                const parts = item.split(','); // 用逗號分隔鍵值
                tableHTML += `<tr><td>${parts[0] || ''}</td><td>${parts.slice(1).join(',') || ''}</td></tr>`;
            });
            tableHTML += '</table>';
            element.innerHTML = tableHTML;
        } else {
            element.textContent = content;
        }
    }
    
    // 遊戲初始化
    async function initializeGame() {
        const response = await fetch(`${backendBaseUrl}/latest-game`);
        if (response.ok) {
            const savedGame = await response.json();
            currentRound = savedGame.roundData.R;
            updateUI(savedGame.story, savedGame.roundData);
        } else {
            appendMessageToStory('未找到過去的記憶，你的故事將從此刻開始...', 'system-message');
        }
        playerInput.focus();
    }

    initializeGame();
});
