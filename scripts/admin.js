// scripts/admin.js
import { api } from './api.js'; // 引入統一的API模組

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM 元素 ---
    const loginContainer = document.getElementById('login-container');
    const adminDashboard = document.getElementById('admin-dashboard');
    const passwordInput = document.getElementById('admin-password');
    const loginBtn = document.getElementById('login-btn');
    const loginError = document.getElementById('login-error');

    const sidebar = document.getElementById('sidebar');
    const menuToggleOpen = document.getElementById('menu-toggle-open');
    const menuToggleClose = document.getElementById('menu-toggle-close');
    const menuLinks = document.querySelectorAll('.menu-link');
    const pages = document.querySelectorAll('.page-content');
    const mainContent = document.getElementById('main-content');
    const mainHeaderTitle = document.getElementById('main-header-title');

    const balanceContainer = document.getElementById('balance-cards-container');
    const playerFilter = document.getElementById('player-filter');
    const refreshLogsBtn = document.getElementById('refresh-logs-btn');
    const logTableBody = document.querySelector('#log-table tbody');
    const logsLoadingText = document.getElementById('logs-loading-text');

    // --- 全局變數 ---
    const API_BASE_URL = 'https://ai-novel-final.onrender.com/api/gm'; // 【修正】後台API應使用 /api/gm
    let adminToken = sessionStorage.getItem('admin_token');

    // --- 初始化檢查 ---
    if (adminToken) {
        showDashboard();
    }

    // --- 事件監聽器 ---
    loginBtn.addEventListener('click', handleLogin);
    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
    
    menuToggleOpen.addEventListener('click', () => sidebar.classList.add('open'));
    menuToggleClose.addEventListener('click', () => sidebar.classList.remove('open'));
    mainContent.addEventListener('click', (e) => {
        if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== menuToggleOpen) {
            sidebar.classList.remove('open');
        }
    });

    menuLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);
            const targetTitle = link.innerText;
            switchPage(targetId, targetTitle);
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('open');
            }
        });
    });

    refreshLogsBtn?.addEventListener('click', loadLogs);
    playerFilter?.addEventListener('change', loadLogs);


    // --- 函式定義 ---

    // 【核心修正】將 fetchApi 移至此處，並修正後台驗證方式
    async function fetchApi(endpoint, options = {}) {
        const password = sessionStorage.getItem('admin_token');
        if (!password) throw new Error('未登入或授權已過期。');

        const headers = {
            'Authorization': `Bearer ${password}`, // 後台使用固定的密碼作為令牌
            'Content-Type': 'application/json',
            ...options.headers,
        };
        
        // 修正：/api/admin 是給監控用的，GM工具應使用 /api/gm
        const response = await fetch(`${backendBaseUrl}${endpoint}`, {
            ...options,
            headers,
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `請求失敗: ${response.status}`);
        }
        return response.json();
    }
    
    async function handleLogin() {
        const password = passwordInput.value;
        if (!password) {
            loginError.textContent = '請輸入密碼。';
            return;
        }

        // 模擬登入：直接將密碼存入 sessionStorage 並嘗試呼叫一個需要驗證的API
        sessionStorage.setItem('admin_token', password);
        
        try {
            // 嘗試呼叫一個需要驗證的 API 來確認密碼是否正確
            await fetchApi('/player-state'); 
            showDashboard();
            loginError.textContent = '';
        } catch (error) {
            loginError.textContent = '密碼錯誤或後台無法連線。';
            sessionStorage.removeItem('admin_token');
        }
    }

    function showDashboard() {
        loginContainer.classList.add('hidden');
        adminDashboard.classList.remove('hidden');
        switchPage('dashboard', 'API儀表板'); // 預設顯示儀表板
    }

    // 【核心修正】修改 switchPage 函式以正確載入所有頁面內容
    function switchPage(pageId, pageTitle) {
        mainHeaderTitle.textContent = pageTitle;
        pages.forEach(page => page.classList.toggle('active', page.id === `page-${pageId}`));
        menuLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${pageId}`));

        // 呼叫對應的內容載入函式
        const loader = pageLoaders[pageId];
        const targetPage = document.getElementById(`page-${pageId}`);
        if (loader && targetPage) {
            loader(targetPage);
        } else if (targetPage) {
            targetPage.innerHTML = `<h3>${pageTitle}</h3><p>此功能頁面正在建設中...</p>`;
        }
    }

    // 【整合】將 gmManager.js 的功能整合進來

    // --- 頁面載入函式集合 ---
    const pageLoaders = {
        'dashboard': loadBalances,
        'logs': loadLogs,
        'player-stats': loadPlayerStatsData,
        'npc-management': loadNpcManagementData,
        'location-editor': loadLocationManagementData,
        'item-spawner': loadItemSpawnerData,
        'npc-creator': loadNpcCreatorData
    };
    
    // API儀表板
    async function loadBalances(page) {
        if (!balanceContainer) return;
        try {
            balanceContainer.innerHTML = '<p class="loading-text">正在獲取API餘額資訊...</p>';
            const adminApi = (endpoint) => fetch(`${backendBaseUrl.replace('/gm', '/admin')}${endpoint}`, { headers: { 'Authorization': `Bearer ${sessionStorage.getItem('admin_token')}` } });
            const response = await adminApi('/balances');
            if(!response.ok) throw new Error((await response.json()).message);
            const balances = await response.json();

            balanceContainer.innerHTML = '';
            for (const key in balances) {
                const data = balances[key];
                const card = document.createElement('div');
                card.className = 'balance-card';
                card.innerHTML = `
                    <h3>${data.service}</h3>
                    <p><span>餘額/用量:</span> <span class="value">${data.balance}</span></p>
                    <p><span>用量百分比:</span> <span class="value">${data.usage}</span></p>
                    <p><span>限制:</span> <span class="value">${data.limit}</span></p>
                    <p><span>貨幣:</span> <span class="value">${data.currency}</span></p>
                `;
                balanceContainer.appendChild(card);
            }
        } catch (error) {
            balanceContainer.innerHTML = `<p class="error-message" style="color: var(--error-color);">無法載入餘額資訊: ${error.message}</p>`;
        }
    }

    // 系統日誌
    async function loadLogs(page) {
        if (!logTableBody) return;
        logTableBody.innerHTML = '';
        logsLoadingText.textContent = '正在載入日誌...';
        logsLoadingText.classList.remove('hidden');
        try {
            const adminApi = (endpoint) => fetch(`${backendBaseUrl.replace('/gm', '/admin')}${endpoint}`, { headers: { 'Authorization': `Bearer ${sessionStorage.getItem('admin_token')}` } });
            // 先載入玩家列表
            const playersResponse = await adminApi('/players');
            if(!playersResponse.ok) throw new Error((await playersResponse.json()).message);
            const players = await playersResponse.json();

            const existingPlayers = new Set(Array.from(playerFilter.options).map(opt => opt.value));
            players.forEach(playerId => {
                if (!existingPlayers.has(playerId)) {
                    const option = document.createElement('option');
                    option.value = playerId;
                    option.textContent = playerId.substring(0, 10) + '...';
                    playerFilter.appendChild(option);
                }
            });

            // 再根據篩選載入日誌
            const playerId = playerFilter.value;
            const logsResponse = await adminApi(`/logs?playerId=${playerId}`);
            if(!logsResponse.ok) throw new Error((await logsResponse.json()).message);
            const logs = await logsResponse.json();
            
            if (logs.length === 0) {
                 logsLoadingText.textContent = '找不到符合條件的日誌。';
                 return;
            }
            
            logs.forEach(log => {
                const row = document.createElement('tr');
                const messageText = typeof log.message === 'object' ? JSON.stringify(log.message, null, 2) : log.message;
                row.innerHTML = `
                    <td>${log.timestamp ? new Date(log.timestamp).toLocaleString() : '未知時間'}</td>
                    <td><span class="log-level log-level-${(log.level || 'info').toLowerCase()}">${log.level || 'INFO'}</span></td>
                    <td>${log.userId ? (log.userId.substring(0, 10) + '...') : 'N/A'}</td>
                    <td class="log-message"><pre>${messageText || ''}</pre></td>
                `;
                logTableBody.appendChild(row);
            });
            logsLoadingText.classList.add('hidden');

        } catch (error) {
            logsLoadingText.textContent = `無法載入日誌: ${error.message}`;
        }
    }

    // 玩家屬性
    async function loadPlayerStatsData(page) {
        page.innerHTML = '<h3><i class="fa-solid fa-user-pen"></i> 玩家屬性編輯</h3><p class="loading-text">正在載入數據...</p>';
        try {
            const [playerState, itemTemplates] = await Promise.all([
                fetchApi('/player-state'),
                fetchApi('/item-templates')
            ]);
            
            let optionsHtml = '<option value="">-- 請選擇物品 --</option>';
            itemTemplates.forEach(item => {
                optionsHtml += `<option value="${item.itemName}">${item.itemName}</option>`;
            });

            page.innerHTML = `
                <h3><i class="fa-solid fa-user-pen"></i> 玩家屬性編輯</h3>
                <div class="gm-form-section">
                    <h4><i class="fa-solid fa-user-ninja"></i> 核心屬性</h4>
                    <div class="gm-grid-container stat-grid">
                        <div class="gm-input-group"><label for="gm-internal">內功</label><input type="number" id="gm-internal" class="gm-input" value="${playerState.internalPower}"></div>
                        <div class="gm-input-group"><label for="gm-external">外功</label><input type="number" id="gm-external" class="gm-input" value="${playerState.externalPower}"></div>
                        <div class="gm-input-group"><label for="gm-lightness">輕功</label><input type="number" id="gm-lightness" class="gm-input" value="${playerState.lightness}"></div>
                        <div class="gm-input-group"><label for="gm-morality">立場</label><input type="number" id="gm-morality" class="gm-input" value="${playerState.morality}"></div>
                    </div>
                     <button id="gm-save-stats" class="gm-button save"><i class="fa-solid fa-floppy-disk"></i> 儲存核心屬性</button>
                </div>
                <div class="gm-form-section">
                    <h4><i class="fa-solid fa-coins"></i> 金錢修改</h4>
                    <div class="gm-input-group">
                        <label for="gm-money">持有金錢</label>
                        <input type="number" id="gm-money" class="gm-input" value="${playerState.money}">
                        <button id="gm-save-money" class="gm-button save">設定</button>
                    </div>
                </div>
                <div class="gm-form-section">
                    <h4><i class="fa-solid fa-box-archive"></i> 物品增減</h4>
                    <div class="gm-input-group">
                        <label for="gm-item-select">選擇物品</label>
                        <select id="gm-item-select" class="gm-select">${optionsHtml}</select>
                        <input type="number" id="gm-item-quantity" class="gm-input" value="1" min="1">
                        <div class="gm-button-group">
                            <button id="gm-add-item" class="gm-button save">增加</button>
                            <button id="gm-remove-item" class="gm-button" style="background-color:#e03131;">移除</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.getElementById('gm-save-stats').addEventListener('click', gmSavePlayerStats);
            document.getElementById('gm-save-money').addEventListener('click', gmSavePlayerMoney);
            document.getElementById('gm-add-item').addEventListener('click', () => gmHandleItemChange('add'));
            document.getElementById('gm-remove-item').addEventListener('click', () => gmHandleItemChange('remove'));

        } catch (error) {
             page.innerHTML = `<h3>玩家屬性編輯</h3><p class="error-message">載入數據失敗: ${error.message}</p>`;
        }
    }

    // 地區編輯
    async function loadLocationManagementData(page) {
        page.innerHTML = '<h3><i class="fa-solid fa-map-location-dot"></i> 地區編輯與瞬移</h3><p class="loading-text">正在從後端獲取地區列表...</p>';
        try {
            const locList = await fetchApi('/locations');
            let optionsHtml = '<option value="">-- 請選擇目標地點 --</option>';
            locList.forEach(loc => {
                optionsHtml += `<option value="${loc.name}">${loc.name}</option>`;
            });

            page.innerHTML = `
                <h3><i class="fa-solid fa-map-location-dot"></i> 地區編輯與瞬移</h3>
                <div class="gm-form-section">
                    <h4><i class="fa-solid fa-person-falling-burst"></i> 乾坤大挪移</h4>
                    <div class="gm-input-group">
                        <label for="gm-location-select">選擇地點</label>
                        <select id="gm-location-select" class="gm-select">${optionsHtml}</select>
                        <input type="text" id="gm-new-location-name" class="gm-input" placeholder="或手動輸入新地點名稱...">
                        <button id="gm-teleport-btn" class="gm-button save"><i class="fa-solid fa-bolt"></i> 瞬移</button>
                    </div>
                    <p class="gm-note">注意：瞬移後，遊戲將會自動存檔，建議您在操作後重新載入遊戲頁面以同步最新狀態。</p>
                </div>
                <div class="gm-grid-container" id="gm-location-grid"></div>
            `;
            
            const gridContainer = document.getElementById('gm-location-grid');
            locList.forEach(loc => {
                const card = document.createElement('div');
                card.className = 'gm-control-card';
                card.innerHTML = `
                    <div class="gm-card-header"><h4>${loc.name}</h4></div>
                    <div class="gm-card-body"><p style="font-size: 0.9rem; color: #a0a0c0; text-align: center; flex-grow: 1;">詳細編輯功能開發中...</p></div>
                    <button class="gm-button save" disabled><i class="fa-solid fa-pen-to-square"></i> 編輯</button>
                `;
                gridContainer.appendChild(card);
            });
            
            document.getElementById('gm-teleport-btn').addEventListener('click', gmTeleport);

        } catch (error) {
            page.innerHTML = `<h3>地區編輯</h3><p class="error-message">獲取資料失敗: ${error.message}</p>`;
        }
    }
    
    // NPC管理
    async function loadNpcManagementData(page) {
        page.innerHTML = '<h3><i class="fa-solid fa-users-gear"></i> NPC關係管理</h3><p class="loading-text">正在獲取人物數據...</p>';
        try {
            const [npcList, characterList] = await Promise.all([
                fetchApi('/npcs'),
                fetchApi('/characters')
            ]);
    
            const container = document.createElement('div');
            container.className = 'gm-grid-container';
    
            if (npcList.length === 0) {
                page.innerHTML = '<h3>NPC關係管理</h3><p>資料庫中尚無任何NPC檔案。</p>';
                return;
            }
    
            const characterOptionsHtml = characterList.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    
            npcList.forEach(npc => {
                const card = document.createElement('div');
                card.className = 'gm-control-card';
                let cardBody;
    
                if (npc.isGhost) {
                    cardBody = `<div class="gm-card-header"><h4>${npc.name}</h4><span class="gm-status-tag ghost"><i class="fa-solid fa-ghost"></i> 黑戶檔案</span></div><div class="gm-card-body"><p class="gm-note">此NPC存在於存檔中，但沒有詳細檔案。</p><button class="gm-button rebuild" data-npc-name="${npc.name}"><i class="fa-solid fa-user-check"></i> 重建檔案</button></div>`;
                } else {
                    cardBody = `
                        <div class="gm-card-header"><h4>${npc.name}</h4></div>
                        <div class="gm-card-body">
                            <div class="gm-control-group"><label><span>友好度</span><span class="value-display" id="friend-val-${npc.id}">${npc.friendlinessValue}</span></label><input type="range" class="gm-slider" id="friend-slider-${npc.id}" min="-100" max="100" value="${npc.friendlinessValue}"></div>
                            <div class="gm-control-group"><label><span>心動值</span><span class="value-display" id="romance-val-${npc.id}">${npc.romanceValue}</span></label><input type="range" class="gm-slider" id="romance-slider-${npc.id}" min="0" max="100" value="${npc.romanceValue}"></div>
                        </div>
                        <button class="gm-button save" data-npc-id="${npc.id}"><i class="fa-solid fa-floppy-disk"></i> 儲存所有變更</button>
                    `;
                }
                card.innerHTML = cardBody;
                container.appendChild(card);
            });
    
            page.innerHTML = '<h3><i class="fa-solid fa-users-gear"></i> NPC關係管理</h3>';
            page.appendChild(container);
            
            bindGmCardEvents(container);
    
        } catch (error) {
            page.innerHTML = `<h3>NPC關係管理</h3><p class="error-message">獲取資料失敗: ${error.message}</p>`;
        }
    }
    
    // 物品生成
    function loadItemSpawnerData(page) {
        page.innerHTML = `
            <h3><i class="fa-solid fa-box-archive"></i> 物品模板生成</h3>
            <div class="gm-form-section">
                <h4><i class="fa-solid fa-lightbulb"></i> AI 創世</h4>
                <p class="gm-note">輸入一個物品的名稱，AI將會為其生成一套完整的屬性、外觀和背景故事，並將其加入遊戲的公用模板庫中。如果該物品已存在，則不會重複創建。</p>
                <div class="gm-input-group">
                    <label for="gm-new-item-name">物品名稱</label>
                    <input type="text" id="gm-new-item-name" class="gm-input" placeholder="例如：玄鐵重劍、九轉還魂丹...">
                    <button id="gm-create-item-btn" class="gm-button rebuild"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成</button>
                </div>
            </div>
        `;
        document.getElementById('gm-create-item-btn').addEventListener('click', gmHandleCreateItem);
    }

    // NPC生成
    function loadNpcCreatorData(page) {
        page.innerHTML = `
            <h3><i class="fa-solid fa-user-plus"></i> 創建新人物</h3>
            <div class="gm-form-section">
                <h4><i class="fa-solid fa-hat-wizard"></i> AI 捏臉</h4>
                <p class="gm-note">輸入一個您想創建的人物姓名，AI將會為其生成獨特的背景故事、個性、人際關係等，並將其加入遊戲世界的公用角色池中，未來可在故事中登場。</p>
                <div class="gm-input-group">
                    <label for="gm-new-npc-name">人物姓名</label>
                    <input type="text" id="gm-new-npc-name" class="gm-input" placeholder="例如：東方未明、沈湘芸...">
                    <button id="gm-create-npc-btn" class="gm-button rebuild"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成</button>
                </div>
            </div>
        `;
        document.getElementById('gm-create-npc-btn').addEventListener('click', gmHandleCreateNpc);
    }
    
    // --- 事件處理函式 ---
    async function gmSavePlayerStats(e) {
        const button = e.target.closest('button');
        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 儲存中...`;
        button.disabled = true;
        try {
            const payload = {
                internalPower: document.getElementById('gm-internal').value,
                externalPower: document.getElementById('gm-external').value,
                lightness: document.getElementById('gm-lightness').value,
                morality: document.getElementById('gm-morality').value
            };
            const result = await fetchApi('/player-state', { method: 'POST', body: JSON.stringify(payload) });
            alert(result.message);
            button.innerHTML = `<i class="fa-solid fa-check"></i> 儲存成功!`;
        } catch (error) {
            alert(`儲存失敗: ${error.message}`);
            button.innerHTML = `<i class="fa-solid fa-xmark"></i> 儲存失敗`;
        } finally {
            setTimeout(() => {
                button.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> 儲存核心屬性`;
                button.disabled = false;
            }, 2000);
        }
    }

    async function gmSavePlayerMoney(e) {
        const button = e.target.closest('button');
        const money = document.getElementById('gm-money').value;
        if (money === '' || isNaN(money)) { alert('請輸入有效的數字'); return; }

        button.textContent = '設定中...';
        button.disabled = true;
        try {
            const result = await fetchApi('/update-player-resources', { method: 'POST', body: JSON.stringify({ money: Number(money) }) });
            alert(result.message);
            button.textContent = '設定成功!';
        } catch (error) {
            alert(`設定失敗: ${error.message}`);
            button.textContent = '錯誤';
        } finally {
            setTimeout(() => { button.textContent = '設定'; button.disabled = false; }, 2000);
        }
    }

    async function gmHandleItemChange(action) {
        const itemName = document.getElementById('gm-item-select').value;
        const quantity = document.getElementById('gm-item-quantity').value;
        if (!itemName) { alert('請選擇一個物品'); return; }
        if (!quantity || isNaN(quantity) || Number(quantity) <= 0) { alert('請輸入有效的數量'); return; }

        const buttonId = action === 'add' ? 'gm-add-item' : 'gm-remove-item';
        const button = document.getElementById(buttonId);
        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 處理中...`;
        button.disabled = true;

        try {
            const result = await fetchApi('/update-player-resources', {
                method: 'POST',
                body: JSON.stringify({ itemChange: { action, itemName, quantity: Number(quantity) } })
            });
            alert(result.message);
            button.innerHTML = `<i class="fa-solid fa-check"></i> 操作成功!`;
        } catch (error) {
            alert(`操作失敗: ${error.message}`);
            button.innerHTML = `<i class="fa-solid fa-xmark"></i> 錯誤`;
        } finally {
            setTimeout(() => { 
                button.innerHTML = action === 'add' ? '增加' : '移除';
                button.disabled = false; 
            }, 2000);
        }
    }

    async function gmTeleport(e) {
        const button = e.target.closest('button');
        const locationName = document.getElementById('gm-new-location-name').value.trim() || document.getElementById('gm-location-select').value;
        if (!locationName) {
            alert('請選擇或輸入一個目標地點！');
            return;
        }

        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 正在傳送...`;
        button.disabled = true;
        try {
            const result = await fetchApi('/teleport', { method: 'POST', body: JSON.stringify({ locationName }) });
            button.innerHTML = `<i class="fa-solid fa-check"></i> ${result.message}`;
             setTimeout(() => {
                alert('瞬移成功！建議您重新載入遊戲以確保所有狀態同步。');
            }, 500);
        } catch (error) {
            button.innerHTML = `<i class="fa-solid fa-xmark"></i> 傳送失敗`;
            alert(`傳送失敗: ${error.message}`);
        } finally {
             setTimeout(() => {
                button.innerHTML = `<i class="fa-solid fa-bolt"></i> 瞬移`;
                button.disabled = false;
            }, 3000);
        }
    }

    function bindGmCardEvents(container) {
        container.querySelectorAll('.gm-button.save').forEach(button => {
            button.addEventListener('click', async (e) => {
                const cardButton = e.target.closest('button');
                const npcId = cardButton.dataset.npcId;
                if (!npcId) return;

                cardButton.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 儲存中...`;
                cardButton.disabled = true;
                
                try {
                    const friendliness = document.getElementById(`friend-slider-${npcId}`).value;
                    const romance = document.getElementById(`romance-slider-${npcId}`).value;
                    const result = await fetchApi('/update-npc', { method: 'POST', body: JSON.stringify({ npcId, friendlinessValue: friendliness, romanceValue: romance }) });
                    alert(result.message);
                    cardButton.innerHTML = `<i class="fa-solid fa-check"></i> 儲存成功`;
                } catch (error) {
                    cardButton.innerHTML = `<i class="fa-solid fa-xmark"></i> 儲存失敗`;
                    alert(`儲存失敗: ${error.message}`);
                } finally {
                    setTimeout(() => {
                       cardButton.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> 儲存所有變更`;
                       cardButton.disabled = false;
                    }, 2000);
                }
            });
        });

        container.querySelectorAll('.gm-button.rebuild').forEach(button => {
            button.addEventListener('click', async (e) => {
                const cardButton = e.target.closest('button');
                cardButton.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 重建中...`;
                cardButton.disabled = true;
                try {
                    let result;
                    if (cardButton.dataset.npcName) {
                        result = await fetchApi('/rebuild-npc', { method: 'POST', body: JSON.stringify({ npcName: cardButton.dataset.npcName }) });
                    } else if (cardButton.dataset.locationName) {
                        result = await fetchApi('/rebuild-location', { method: 'POST', body: JSON.stringify({ locationName: cardButton.dataset.locationName }) });
                    }
                    alert(result.message);
                    cardButton.innerHTML = `<i class="fa-solid fa-check"></i> ${result.message}`;
                } catch (error) {
                     cardButton.innerHTML = `<i class="fa-solid fa-xmark"></i> 錯誤`;
                     alert(`重建失敗: ${error.message}`);
                } finally {
                     setTimeout(() => {
                        const activeMenu = document.querySelector('#sidebar .menu-link.active');
                        if(activeMenu) {
                           const pageId = activeMenu.getAttribute('href').substring(1);
                           loadPageContent(pageId);
                        }
                     }, 2000);
                }
            });
        });
        
        container.querySelectorAll('.gm-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const displayId = e.target.id.replace('slider', 'val');
                document.getElementById(displayId).textContent = e.target.value;
            });
        });
    }

    async function gmHandleCreateItem(e) {
        const button = e.target.closest('button');
        const itemName = document.getElementById('gm-new-item-name').value.trim();
        if (!itemName) {
            alert('請輸入物品名稱！');
            return;
        }
        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 生成中...`;
        button.disabled = true;
        try {
            const result = await fetchApi('/create-item-template', { method: 'POST', body: JSON.stringify({ itemName }) });
            alert(result.message);
            document.getElementById('gm-new-item-name').value = '';
        } catch (error) {
            alert(`生成失敗: ${error.message}`);
        } finally {
            button.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成`;
            button.disabled = false;
        }
    }

    async function gmHandleCreateNpc(e) {
        const button = e.target.closest('button');
        const npcName = document.getElementById('gm-new-npc-name').value.trim();
        if (!npcName) {
            alert('請輸入人物姓名！');
            return;
        }
        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 生成中...`;
        button.disabled = true;
        try {
            const result = await fetchApi('/create-npc-template', { method: 'POST', body: JSON.stringify({ npcName }) });
            alert(result.message);
            document.getElementById('gm-new-npc-name').value = '';
        } catch (error) {
            alert(`生成失敗: ${error.message}`);
        } finally {
            button.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成`;
            button.disabled = false;
        }
    }
});
