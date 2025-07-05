document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('register-form');
    const messageElement = document.getElementById('message');
    const backendBaseUrl = 'https://ai-novel-final.onrender.com';

    // --- 主題切換邏輯 (保留您檔案中的原樣) ---
    const bodyElement = document.body;
    const worldviewSelector = document.getElementById('worldview');
    const authTitle = document.querySelector('.auth-title');
    const submitBtn = document.getElementById('submit-btn');

    const themeConfig = {
        wuxia: {
            className: '',
            title: '初入江湖',
            buttonText: '拜入師門'
        },
        gundam: {
            className: 'auth-page-gundam',
            title: '同步駕駛員',
            buttonText: '連接系統'
        }
    };

    function setTheme(worldview) {
        Object.values(themeConfig).forEach(theme => {
            if (theme.className) {
                bodyElement.classList.remove(theme.className);
            }
        });

        const selectedTheme = themeConfig[worldview] || themeConfig.wuxia;
        if (selectedTheme.className) {
            bodyElement.classList.add(selectedTheme.className);
        }

        authTitle.textContent = selectedTheme.title;
        submitBtn.textContent = selectedTheme.buttonText;
    }

    if (worldviewSelector) {
        worldviewSelector.addEventListener('change', (e) => {
            setTheme(e.target.value);
        });
        setTheme(worldviewSelector.value);
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        messageElement.textContent = '';
        messageElement.className = 'message';

        const username = document.getElementById('username').value.trim();
        const gender = document.getElementById('gender').value;
        const password = document.getElementById('password').value.trim();
        const worldview = worldviewSelector.value;

        if (!username || !gender || !password || !worldview) {
            messageElement.textContent = '所有欄位皆為必填。';
            messageElement.classList.add('error');
            return;
        }

        try {
            const response = await fetch(`${backendBaseUrl}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, gender, password, worldview })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || '發生未知錯誤');
            }

            // --- 【修改】註冊成功後的流程 ---
            // 1. 顯示成功訊息
            messageElement.textContent = data.message + ' 正在進入遊戲世界...';
            messageElement.classList.add('success');

            // 2. 將獲取到的 token 和 username 存入 localStorage
            localStorage.setItem('jwt_token', data.token);
            localStorage.setItem('username', data.username);

            // 3. 直接跳轉到遊戲主頁面
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1500);

        } catch (error) {
            console.error('註冊失敗:', error);
            messageElement.textContent = error.message;
            messageElement.classList.add('error');
        }
    });
});
