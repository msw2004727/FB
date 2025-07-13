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
    
    // 編輯彈窗元素
    const editModal = document.getElementById('edit-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalTextarea = document.getElementById('modal-textarea');
    const modalSaveBtn = document.getElementById('modal-save');
    const modalCancelBtn = document.getElementById('modal-cancel');

    // --- 全局變數 ---
    const backendBaseUrl = 'https://ai-novel-final.onrender.com';
    let currentEditData = null;

    // --- 初始化檢查 ---
    if (sessionStorage.getItem('admin_token')) {
        showDashboard();
    }

    // --- API 請求函式 ---
    async function fetchAdminApi(endpoint, options = {}) {
        const password = sessionStorage.getItem('admin_token');
        if (!password) throw new Error('未登入或授權已過期。');

        const headers = {
            'Authorization': `Bearer ${password}`,
            'Content-Type': 'application/json',
            ...options.headers,
        };
        
        const response = await fetch(`${backendBaseUrl}/api/admin${endpoint}`, {
            ...options,
            headers,
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `請求失敗: ${response.status}`);
        }
        return response.json();
    }
    
    // --- 登入與介面切換 ---
    async function handleLogin() {
        const password = passwordInput.value;
        if (!password) {
            loginError.textContent = '請輸入密碼。';
            return;
        }
        loginError.textContent = '驗證中...';
        sessionStorage.setItem('admin_token', password);
        try {
            await fetchAdminApi('/balances'); 
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
        switchPage('dashboard', 'API儀表板');
    }
    
    function switchPage(pageId, pageTitle) {
        mainHeaderTitle.textContent = pageTitle;
        pages.forEach(page => page.classList.toggle('active', page.id === `page-${pageId}`));
        menuLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${pageId}`));

        const loader = pageLoaders[pageId];
        if (loader) {
            loader();
        }
    }

    // --- 頁面內容載入器 ---
    const pageLoaders = {
        'dashboard': loadBalances,
        'logs': loadLogs,
        'npc-templates': () => loadTemplates('npc'),
        'item-templates': () => loadTemplates('item'),
        'location-templates': () => loadTemplates('location'),
    };

    async function loadBalances() {
        const container = document.getElementById('balance-cards-container');
        if (!container) return;
        try {
            container.innerHTML = '<p class="loading-text">正在獲取API餘額資訊...</p>';
            const balances = await fetchAdminApi('/balances');
            container.innerHTML = Object.values(balances).map(data => `
                <div class="balance-card">
                    <h3>${data.service}</h3>
                    <p><span>餘額/用量:</span><span class="value">${data.balance}</span></p>
                    <p><span>用量百分比:</span><span class="value">${data.usage}</span></p>
                    <p><span>限制:</span><span class="value">${data.limit}</span></p>
                    <p><span>貨幣:</span><span class="value">${data.currency}</span></p>
                </div>
            `).join('');
        } catch (error) {
            container.innerHTML = `<p class="error-message" style="color: var(--error-color);">無法載入餘額資訊: ${error.message}</p>`;
        }
    }

    async function loadLogs() {
        const logTableBody = document.querySelector('#log-table tbody');
        const logsLoadingText = document.getElementById('logs-loading-text');
        const playerFilter = document.getElementById('player-filter');
        if (!logTableBody) return;

        logTableBody.innerHTML = '';
        logsLoadingText.textContent = '正在載入日誌...';
        logsLoadingText.classList.remove('hidden');

        try {
            const players = await fetchAdminApi('/players');
            const existingPlayers = new Set(Array.from(playerFilter.options).map(opt => opt.value));
            players.forEach(playerId => {
                if (!existingPlayers.has(playerId)) {
                    const option = document.createElement('option');
                    option.value = playerId;
                    option.textContent = `玩家 ${playerId.substring(0, 8)}...`;
                    playerFilter.appendChild(option);
                }
            });

            const playerId = playerFilter.value;
            const logs = await fetchAdminApi(`/logs?playerId=${playerId}`);
            
            if (logs.length === 0) {
                 logsLoadingText.textContent = '找不到符合條件的日誌。';
                 return;
            }
            
            logTableBody.innerHTML = logs.map(log => {
                const messageText = typeof log.message === 'object' ? JSON.stringify(log.message, null, 2) : log.message;
                return `
                    <tr>
                        <td>${log.timestamp ? new Date(log.timestamp).toLocaleString() : '未知時間'}</td>
                        <td><span class="log-level log-level-${(log.level || 'info').toLowerCase()}">${log.level || 'INFO'}</span></td>
                        <td>${log.userId ? (log.userId.substring(0, 8) + '...') : 'N/A'}</td>
                        <td class="log-message"><pre>${messageText || ''}</pre></td>
                    </tr>
                `;
            }).join('');
            logsLoadingText.classList.add('hidden');
        } catch (error) {
            logsLoadingText.textContent = `無法載入日誌: ${error.message}`;
        }
    }
    
    async function loadTemplates(type) {
        const container = document.getElementById(`${type}-templates-container`);
        if (!container) return;
        container.innerHTML = `<p class="loading-text">正在讀取 ${type} 模板...</p>`;
        try {
            const templates = await fetchAdminApi(`/${type}-templates`);
            if(templates.length === 0) {
                container.innerHTML = `<p>資料庫中沒有找到任何 ${type} 模板。</p>`;
                return;
            }
            container.innerHTML = templates.map(template => `
                <div class="template-card">
                    <h4>${template.id}</h4>
                    <div class="details">
                        <pre>${JSON.stringify(template.data, null, 2)}</pre>
                    </div>
                    <div class="actions">
                        <button class="btn btn-edit" data-type="${type}" data-id="${template.id}">編輯</button>
                    </div>
                </div>
            `).join('');

            container.querySelectorAll('.btn-edit').forEach(btn => {
                btn.addEventListener('click', handleEditClick);
            });

        } catch (error) {
            container.innerHTML = `<p class="error-message">讀取 ${type} 模板失敗: ${error.message}</p>`;
        }
    }
    
    // --- 編輯功能 ---
    async function handleEditClick(e) {
        const type = e.target.dataset.type;
        const id = e.target.dataset.id;
        
        try {
            const data = await fetchAdminApi(`/${type}-templates/${id}`);
            currentEditData = { type, id };
            modalTitle.textContent = `編輯 ${type} 模板: ${id}`;
            modalTextarea.value = JSON.stringify(data, null, 2);
            editModal.style.display = 'flex';
        } catch (error) {
            alert(`讀取模板資料失敗: ${error.message}`);
        }
    }

    async function handleSaveClick() {
        if (!currentEditData) return;
        
        let updatedData;
        try {
            updatedData = JSON.parse(modalTextarea.value);
        } catch (error) {
            alert('JSON格式無效，請檢查您的輸入！');
            return;
        }

        modalSaveBtn.textContent = '儲存中...';
        modalSaveBtn.disabled = true;

        try {
            const { type, id } = currentEditData;
            await fetchAdminApi(`/${type}-templates/${id}`, {
                method: 'PUT',
                body: JSON.stringify(updatedData)
            });
            alert('儲存成功！');
            closeModal();
            pageLoaders[`${type}-templates`](); // 重新載入頁面
        } catch (error) {
            alert(`儲存失敗: ${error.message}`);
        } finally {
            modalSaveBtn.textContent = '儲存變更';
            modalSaveBtn.disabled = false;
        }
    }

    function closeModal() {
        editModal.style.display = 'none';
        currentEditData = null;
        modalTextarea.value = '';
    }

    // --- 事件綁定 ---
    loginBtn.addEventListener('click', handleLogin);
    passwordInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleLogin(); });
    
    menuToggleOpen.addEventListener('click', () => sidebar.classList.add('open'));
    menuToggleClose.addEventListener('click', () => sidebar.classList.remove('open'));
    mainContent.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== menuToggleOpen) {
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

    modalSaveBtn.addEventListener('click', handleSaveClick);
    modalCancelBtn.addEventListener('click', closeModal);
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) closeModal();
    });

    // 為日誌頁面添加篩選和刷新監聽
    const playerFilter = document.getElementById('player-filter');
    const refreshLogsBtn = document.getElementById('refresh-logs-btn');
    if(playerFilter) playerFilter.addEventListener('change', loadLogs);
    if(refreshLogsBtn) refreshLogsBtn.addEventListener('click', loadLogs);
});
