// scripts/admin.js

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

    const balanceContainer = document.getElementById('balance-cards-container');
    const playerFilter = document.getElementById('player-filter');
    const refreshLogsBtn = document.getElementById('refresh-logs-btn');
    const logTableBody = document.querySelector('#log-table tbody');
    const logsLoadingText = document.getElementById('logs-loading-text');

    // --- 全局變數 ---
    const API_BASE_URL = 'https://ai-novel-final.onrender.com/api/admin';
    let adminToken = sessionStorage.getItem('admin_token');

    // --- 初始化檢查 ---
    if (adminToken) {
        showDashboard();
    }

    // --- 事件監聽器 ---
    loginBtn.addEventListener('click', handleLogin);
    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleLogin();
        }
    });
    
    menuToggleOpen.addEventListener('click', () => sidebar.classList.add('open'));
    menuToggleClose.addEventListener('click', () => sidebar.classList.remove('open'));
    mainContent.addEventListener('click', (e) => {
        // 如果側邊欄是打開的，並且點擊的不是側邊欄本身或打開按鈕，則關閉它
        if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== menuToggleOpen) {
            sidebar.classList.remove('open');
        }
    });


    menuLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);
            switchPage(targetId);
            sidebar.classList.remove('open');
        });
    });

    refreshLogsBtn.addEventListener('click', loadLogs);
    playerFilter.addEventListener('change', loadLogs);


    // --- 函式定義 ---

    async function handleLogin() {
        const password = passwordInput.value;
        if (!password) {
            loginError.textContent = '請輸入密碼。';
            return;
        }

        adminToken = password; 
        
        try {
            await fetchApi('/balances'); 
            sessionStorage.setItem('admin_token', adminToken);
            showDashboard();
            loginError.textContent = '';
        } catch (error) {
            loginError.textContent = '密碼錯誤或後台無法連線。';
            adminToken = null;
        }
    }

    function showDashboard() {
        loginContainer.classList.add('hidden');
        adminDashboard.classList.remove('hidden');
        // 【修正】確保在顯示儀表板時，自動載入第一個頁面的資料
        switchPage('dashboard');
    }
    
    function switchPage(pageId) {
        pages.forEach(page => page.classList.toggle('active', page.id === `page-${pageId}`));
        menuLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${pageId}`));

        // 【修正】根據切換的頁面載入對應的資料
        if (pageId === 'dashboard') {
            loadBalances();
        } else if (pageId === 'logs') {
            loadPlayers(); // 載入玩家列表以供篩選
            loadLogs();    // 載入日誌
        }
    }

    async function fetchApi(endpoint) {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            headers: {
                'Authorization': `Bearer ${adminToken}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `請求失敗: ${response.status}`);
        }
        return response.json();
    }
    
    async function loadBalances() {
        try {
            balanceContainer.innerHTML = '<p class="loading-text">正在獲取API餘額資訊...</p>';
            const balances = await fetchApi('/balances');
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

    async function loadPlayers() {
        try {
            const players = await fetchApi('/players');
            // 避免重複添加選項
            const existingPlayers = new Set(Array.from(playerFilter.options).map(opt => opt.value));
            players.forEach(playerId => {
                if (!existingPlayers.has(playerId)) {
                    const option = document.createElement('option');
                    option.value = playerId;
                    option.textContent = playerId.substring(0, 10) + '...'; // 顯示部分ID即可
                    playerFilter.appendChild(option);
                }
            });
        } catch (error) {
            console.error('無法載入玩家列表:', error);
        }
    }
    
    async function loadLogs() {
        logTableBody.innerHTML = '';
        logsLoadingText.textContent = '正在載入日誌...';
        logsLoadingText.classList.remove('hidden');
        try {
            const playerId = playerFilter.value;
            const logs = await fetchApi(`/logs?playerId=${playerId}`);
            
            if (logs.length === 0) {
                 logsLoadingText.textContent = '找不到符合條件的日誌。';
                 return;
            }
            
            logs.forEach(log => {
                const row = document.createElement('tr');
                // 【修正】確保即使某些欄位缺失也不會報錯
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
            logsLoadingText.style.color = 'var(--error-color)';
        }
    }
});
