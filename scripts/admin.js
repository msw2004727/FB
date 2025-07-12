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
    const mainHeaderTitle = document.getElementById('main-header-title');

    const balanceContainer = document.getElementById('balance-cards-container');
    const playerFilter = document.getElementById('player-filter');
    const refreshLogsBtn = document.getElementById('refresh-logs-btn');
    const logTableBody = document.querySelector('#log-table tbody');
    const logsLoadingText = document.getElementById('logs-loading-text');

    // 【新增】獲取GCP帳單資訊的容器
    const gcpBillingContainer = document.getElementById('gcp-billing-container');

    // --- 全局變數 ---
    const API_BASE_URL = 'https://ai-novel-final.onrender.com/api/admin';
    const GCP_API_BASE_URL = 'https://ai-novel-final.onrender.com/api/gcp'; // 【新增】GCP API的基礎URL
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
        if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== menuToggleOpen) {
            sidebar.classList.remove('open');
        }
    });

    menuLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);
            mainHeaderTitle.textContent = link.textContent; // 更新標題
            switchPage(targetId);
            sidebar.classList.remove('open');
        });
    });

    refreshLogsBtn.addEventListener('click', loadLogs);
    playerFilter.addEventListener('change', loadLogs);


    // --- 函式定義 ---

    /**
     * 【核心修改】統一的API請求函式，現在能處理不同的基礎URL
     * @param {string} endpoint - API的端點
     * @param {string} type - API的類型 ('admin' 或 'gcp')
     */
    async function fetchApi(endpoint, type = 'admin') {
        const baseUrl = type === 'gcp' ? GCP_API_BASE_URL : API_BASE_URL;
        const response = await fetch(`${baseUrl}${endpoint}`, {
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
        switchPage('dashboard'); // 預設顯示儀表板
    }
    
    function switchPage(pageId) {
        pages.forEach(page => page.classList.toggle('active', page.id === `page-${pageId}`));
        menuLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${pageId}`));

        // 根據切換的頁面載入對應的資料
        if (pageId === 'dashboard') {
            loadBalances();
        } else if (pageId === 'logs') {
            loadPlayers(); 
            loadLogs();
        } else if (pageId === 'gcp-billing') { // 新增的GCP帳單頁面
            loadGcpBillingInfo();
        }
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
            const existingPlayers = new Set(Array.from(playerFilter.options).map(opt => opt.value));
            players.forEach(playerId => {
                if (!existingPlayers.has(playerId)) {
                    const option = document.createElement('option');
                    option.value = playerId;
                    option.textContent = playerId.substring(0, 10) + '...';
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

    /**
     * 【新增】載入GCP帳單資訊的函式
     */
    async function loadGcpBillingInfo() {
        if (!gcpBillingContainer) return;
        gcpBillingContainer.innerHTML = '<p class="loading-text">正在從您的GCP帳戶同步帳單資訊...</p>';
        try {
            // 使用新的'gcp'類型來請求正確的後端API
            const billingInfo = await fetchApi('/billing-info', 'gcp'); 
            
            gcpBillingContainer.innerHTML = ''; // 清空載入提示
            
            const card = document.createElement('div');
            card.className = 'balance-card';
            card.innerHTML = `
                <h3>帳戶狀態</h3>
                <p><span>帳戶名稱:</span> <span class="value">${billingInfo.displayName || 'N/A'}</span></p>
                <p><span>是否啟用:</span> <span class="value">${billingInfo.open ? '是' : '否'}</span></p>
                <p><span>主帳戶:</span> <span class="value">${billingInfo.masterBillingAccount || '無'}</span></p>
            `;
            gcpBillingContainer.appendChild(card);

        } catch (error) {
            gcpBillingContainer.innerHTML = `<p class="error-message" style="color: var(--error-color);">無法載入GCP帳單資訊: ${error.message}</p>`;
        }
    }
});
