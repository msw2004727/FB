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
    // 注意：您後端部署在Render上，網址是 'https://ai-novel-final.onrender.com'
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
    mainContent.addEventListener('click', () => sidebar.classList.remove('open'));

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

        // 在前端，我們簡單地將密碼作為令牌使用
        adminToken = password; 
        
        // 嘗試呼叫一個受保護的API端點來驗證密碼
        try {
            await fetchApi('/balances'); // 選擇一個輕量的API來測試
            sessionStorage.setItem('admin_token', adminToken);
            showDashboard();
        } catch (error) {
            loginError.textContent = '密碼錯誤或後台無法連線。';
            adminToken = null;
        }
    }

    function showDashboard() {
        loginContainer.classList.add('hidden');
        adminDashboard.classList.remove('hidden');
        loadBalances();
        loadPlayers();
        loadLogs();
    }
    
    function switchPage(pageId) {
        pages.forEach(page => page.classList.toggle('active', page.id === `page-${pageId}`));
        menuLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${pageId}`));
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
            balanceContainer.innerHTML = `<p class="error-message">無法載入餘額資訊: ${error.message}</p>`;
        }
    }

    async function loadPlayers() {
        try {
            const players = await fetchApi('/players');
            playerFilter.innerHTML = '<option value="">所有玩家</option>'; // Reset
            players.forEach(playerId => {
                const option = document.createElement('option');
                option.value = playerId;
                option.textContent = playerId;
                playerFilter.appendChild(option);
            });
        } catch (error) {
            console.error('無法載入玩家列表:', error);
        }
    }
    
    async function loadLogs() {
        logTableBody.innerHTML = '';
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
                row.innerHTML = `
                    <td>${new Date(log.timestamp).toLocaleString()}</td>
                    <td>${log.level || 'INFO'}</td>
                    <td>${log.userId || 'N/A'}</td>
                    <td class="log-message">${log.message}</td>
                `;
                logTableBody.appendChild(row);
            });
            logsLoadingText.classList.add('hidden');

        } catch (error) {
            logsLoadingText.textContent = `無法載入日誌: ${error.message}`;
        }
    }
});
