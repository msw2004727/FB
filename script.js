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
    const dashboardContentWrapper = document.getElementById('dashboard-content-wrapper'); // 【修改】獲取新的容器
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

    // --- 【新增】UI 模板引擎 ---
    const dashboardTemplates = {
        wuxia: {
            render: (container) => {
                container.innerHTML = `
                    <div class="info-card welcome-card"><div id="welcome-message"></div></div>
                    <div class="info-card"><h4><i class="fas fa-brain-circuit"></i> AI 核心</h4><div class="select-wrapper"><select id="ai-model-selector"><option value="gemini">Gemini (快 & 穩)</option><option value="openai">GPT-4o (強 & 貴)</option><option value="deepseek" selected>DeepSeek-V2 (強 & 奇)</option></select></div></div>
                    <div class="info-card"><h4><i class="fas fa-user"></i> 角色狀態 (PC)</h4><div id="pc-content">--</div><div id="internal-power-display" style="margin-top: 0.5rem;">內功: --</div><div id="external-power-display">外功: --</div></div>
                    <div class="info-card"><h4><i class="fas fa-users"></i> 人物見聞 (NPC)</h4><div id="npc-content">--</div></div>
                    <div class="info-card"><h4><i class="fas fa-briefcase"></i> 隨身物品 (ITM)</h4><div id="itm-content">--</div></div>
                    <div class="info-card"><h4><i class="fas fa-scroll"></i> 任務日誌 (QST)</h4><div id="qst-content">--</div></div>
                    <div class="info-card"><h4><i class="fas fa-brain"></i> 內心獨白 (PSY)</h4><div id="psy-content">--</div></div>
                    <div class="info-card"><h4><i class="fas fa-key"></i> 關鍵線索 (CLS)</h4><div id="cls-content">--</div></div>
                `;
            },
            update: (data) => {
                document.getElementById('pc-content').textContent = data.PC || '狀態穩定';
                document.getElementById('internal-power-display').textContent = `內功: ${data.internalPower || 0}`;
                document.getElementById('external-power-display').textContent = `外功: ${data.externalPower || 0}`;
                updateNpcList(document.getElementById('npc-content'), data.NPC, 'wuxia');
                document.getElementById('itm-content').textContent = data.ITM || '行囊空空';
                document.getElementById('qst-content').textContent = data.QST || '暫無要事';
                document.getElementById('psy-content').textContent = data.PSY || '心如止水';
                document.getElementById('cls-content').textContent = data.CLS || '尚無線索';
            }
        },
        gundam: {
            render: (container) => {
                container.innerHTML = `
                    <div class="info-card welcome-card"><div id="welcome-message"></div></div>
                    <div class="info-card"><h4><i class="fas fa-brain-circuit"></i> AI 核心</h4><div class="select-wrapper"><select id="ai-model-selector"><option value="gemini">Gemini (快 & 穩)</option><option value="openai">GPT-4o (強 & 貴)</option><option value="deepseek" selected>DeepSeek-V2 (強 & 奇)</option></select></div></div>
                    <div class="info-card"><h4><i class="fas fa-user-astronaut"></i> 駕駛員狀態 (PC)</h4><div id="pc-content">--</div><div id="machine-sync-display" style="margin-top: 0.5rem;">機體同步率: --</div><div id="pilot-skill-display">駕駛技巧: --</div></div>
                    <div class="info-card"><h4><i class="fas fa-satellite-dish"></i> 雷達接觸 (NPC)</h4><div id="npc-content">--</div></div>
                    <div class="info-card"><h4><i class="fas fa-box"></i> 搭載物資 (ITM)</h4><div id="itm-content">--</div></div>
                    <div class="info-card"><h4><i class="fas fa-clipboard-list"></i> 任務目標 (QST)</h4><div id="qst-content">--</div></div>
                    <div class="info-card"><h4><i class="fas fa-headset"></i> 內部通訊 (PSY)</h4><div id="psy-content">--</div></div>
                    <div class="info-card"><h4><i class="fas fa-map-marked-alt"></i> 關鍵座標 (CLS)</h4><div id="cls-content">--</div></div>
                `;
            },
            update: (data) => {
                document.getElementById('pc-content').textContent = data.PC || '狀態正常';
                document.getElementById('machine-sync-display').textContent = `機體同步率: ${data.machineSync || 0}`;
                document.getElementById('pilot-skill-display').textContent = `駕駛技巧: ${data.pilotSkill || 0}`;
                updateNpcList(document.getElementById('npc-content'), data.NPC, 'gundam');
                document.getElementById('itm-content').textContent = data.ITM || '貨艙淨空';
                document.getElementById('qst-content').textContent = data.QST || '沒有現行任務';
                document.getElementById('psy-content').textContent = data.PSY || '通訊靜默';
                document.getElementById('cls-content').textContent = data.CLS || '未記錄座標';
            }
        }
    };

    function updateNpcList(container, npcData, worldview) {
        if (!container) return;
        container.innerHTML = '';
        if (npcData && Array.isArray(npcData) && npcData.length > 0) {
            npcData.forEach(npc => {
                const npcLine = document.createElement('div');
                npcLine.innerHTML = `<span class="npc-name npc-${npc.friendliness}">${npc.name}</span>: ${npc.status || (worldview === 'gundam' ? '狀態未知' : '狀態不明')}`;
                container.appendChild(npcLine);
            });
        } else {
            container.textContent = worldview === 'gundam' ? '雷達無接觸' : '未見人煙';
        }
    }

    // --- 核心邏輯 (保留大部分) ---
    menuToggle.addEventListener('click', () => gameContainer.classList.toggle('sidebar-open'));
    mainContent.addEventListener('click', () => {
        if (window.innerWidth <= 1024) gameContainer.classList.remove('sidebar-open');
    });

    function applyTheme(theme) {
        // 這個主題切換只影響 dark/light，不影響 wuxia/gundam 的遊戲主題
        if (document.body.classList.contains('game-theme-gundam')) {
            // 如果是鋼彈主題，則不處理 dark/light 切換，或定義鋼彈的 dark/light 模式
        } else {
            document.body.className = `game-container ${theme}`;
        }
    }

    logoutButton.addEventListener('click', () => { /* ... 保留原樣 ... */ });
    suicideButton.addEventListener('click', async () => { /* ... 保留原樣 ... */ });
    restartButton.addEventListener('click', async () => { /* ... 保留原樣 ... */ });

    function bindDashboardEvents() {
        const aiModelSelector = document.getElementById('ai-model-selector');
        if(aiModelSelector) {
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
        }
    }

    const backendBaseUrl = 'https://ai-novel-final.onrender.com';
    let currentRound = 0;
    let isRequesting = false;
    let currentWorldview = 'wuxia'; // 預設世界觀

    submitButton.addEventListener('click', handlePlayerAction);
    playerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); handlePlayerAction(); }
    });

    async function handlePlayerAction() {
        const actionText = playerInput.value.trim();
        if (!actionText || isRequesting) return;

        playerInput.value = '';
        actionSuggestion.textContent = '';

        const selectedModel = document.getElementById('ai-model-selector').value;
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
            updateUI(data.story, data.roundData, data.worldview); // 使用後端傳來的 worldview

            if (data.suggestion) {
                const suggestionPrefix = data.worldview === 'gundam' ? '戰術助理建議：' : '書僮小聲說：';
                actionSuggestion.textContent = `${suggestionPrefix}${data.suggestion}`;
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
        setLoadingState(true, '正在同步世界數據...');
        try {
            const response = await fetch(`${backendBaseUrl}/api/game/latest-game`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();

            currentWorldview = data.worldview || 'wuxia';
            const template = dashboardTemplates[currentWorldview];

            template.render(dashboardContentWrapper);
            bindDashboardEvents();
            document.getElementById('welcome-message').textContent = `${username}，歡迎回來。`;
            document.body.className = `game-container ${currentWorldview === 'gundam' ? 'game-theme-gundam' : 'light-theme'}`;

            if (data.gameState === 'deceased') { showDeceasedScreen(); return; }

            if (!response.ok) {
                if (response.status === 404) { startNewGame(currentWorldview); return; }
                throw new Error(data.message || `伺服器錯誤: ${response.status}`);
            }

            currentRound = data.roundData.R;
            storyTextContainer.innerHTML = '';

            if (data.prequel) {
                const prequelDiv = document.createElement('div');
                prequelDiv.className = 'prequel-summary';
                prequelDiv.innerHTML = `<h3>前情提要</h3><p>${data.prequel}</p>`;
                storyTextContainer.appendChild(prequelDiv);
            }

            updateUI(data.story, data.roundData, currentWorldview);

            if (data.suggestion) {
                const suggestionPrefix = currentWorldview === 'gundam' ? '戰術助理建議：' : '書僮小聲說：';
                actionSuggestion.textContent = `${suggestionPrefix}${data.suggestion}`;
            }

        } catch (error) { handleApiError(error); } finally { setLoadingState(false); }
    }

    function startNewGame(worldview) {
        currentRound = 0;
        storyTextContainer.innerHTML = '';

        const template = dashboardTemplates[worldview];
        template.render(dashboardContentWrapper);
        bindDashboardEvents();
        document.getElementById('welcome-message').textContent = `${username}，歡迎。`;
        document.body.className = `game-container ${worldview === 'gundam' ? 'game-theme-gundam' : 'light-theme'}`;

        const initialData = worldview === 'gundam' ? {
            R: 0, EVT: '序章：寂靜星域', ATM: ['未知', '警報'], WRD: '未知', LOC: ['未知空域'], PC: '意識模糊，系統受損', NPC: [], ITM: '', QST: '', PSY: '這裡是...哪裡...', CLS: '', timeOfDay: '標準時間0800', machineSync: 5, pilotSkill: 5
        } : {
            R: 0, EVT: '楔子', ATM: ['迷茫'], WRD: '未知', LOC: ['未知之地'], PC: '身體虛弱，內息紊亂', NPC: [], ITM: '', QST: '', PSY: '我是誰...我在哪...', CLS: '', timeOfDay: '上午', internalPower: 5, externalPower: 5
        };

        updateUI('你的旅程似乎尚未開始。請在下方輸入你的第一個動作。', initialData, worldview);

        const suggestionPrefix = worldview === 'gundam' ? '戰術助理建議：' : '書僮小聲說：';
        actionSuggestion.textContent = `${suggestionPrefix}試著探索一下四周環境吧。`;
    }

    function updateUI(storyText, data, worldview) {
        if (!data) return;

        if (storyText) {
            const processedStory = highlightNpcNames(storyText, data.NPC);
            appendMessageToStory(processedStory, 'story-text');
        }

        currentRound = data.R;
        roundTitleEl.textContent = data.EVT || (worldview === 'gundam' ? `任務階段 ${data.R}` : `第 ${data.R} 回`);

        const atmosphere = data.ATM?.[0] || '未知';
        const weather = data.WRD || '晴朗';
        const location = data.LOC?.[0] || '未知之地';
        statusBarEl.innerHTML = `
            <div class="status-item"><i class="fas fa-clock"></i> ${worldview === 'gundam' ? '艦橋時間' : '時辰'}: 約${data.timeOfDay || '未知'}</div>
            <div class="status-item"><i class="fas fa-satellite-dish"></i> ${worldview === 'gundam' ? '空間現象' : '天氣'}: ${weather}</div>
            <div class="status-item"><i class="fas fa-theater-masks"></i> 氛圍: ${atmosphere}</div>
            <div class="status-item"><i class="fas fa-map-marked-alt"></i> ${worldview === 'gundam' ? '座標' : '地點'}: ${location}</div>
        `;

        const template = dashboardTemplates[worldview];
        if (template) {
            template.update(data);
        }
    }

    function handleApiError(error) { /* ... 保留原樣 ... */ }
    function setLoadingState(isLoading, text = '') { /* ... 保留原樣 ... */ }
    function showDeceasedScreen() { /* ... 保留原樣 ... */ }
    function appendMessageToStory(htmlContent, className) { /* ... 保留原樣 ... */ }
    function highlightNpcNames(text, npcs) { /* ... 保留原樣 ... */ }

    initializeGame();
});
