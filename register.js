document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('register-form');
    const messageElement = document.getElementById('message');
    const backendBaseUrl = 'https://ai-novel-final.onrender.com';

    // --- 【新增】主題切換邏輯 ---
    const bodyElement = document.body;
    const worldviewSelector = document.getElementById('worldview');
    const authTitle = document.querySelector('.auth-title');
    const submitBtn = document.getElementById('submit-btn');

    const themeConfig = {
        wuxia: {
            className: '', // 武俠是預設，不需要額外的 class
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

    if (worldviewSelector) { // 確保只在註冊頁面執行
        worldviewSelector.addEventListener('change', (e) => {
            setTheme(e.target.value);
        });
        setTheme(worldviewSelector.value);
    }
    // --- 主題切換邏輯結束 ---

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        messageElement.textContent = '';
        messageElement.className = 'message';

        const username = document.getElementById('username').value.trim();
        const gender = document.getElementById('gender').value;
        const password = document.getElementById('password').value.trim();

        // 在提交時再次獲取世界觀的值
        const worldview = document.getElementById('worldview') ? document.getElementById('worldview').value : 'wuxia';

        if (!username || !gender || !password) {
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

            messageElement.textContent = data.message + ' 正在將您導向登入頁面...';
            messageElement.classList.add('success');

            setTimeout(() => {
                window.location.href = 'login.html';
            }, 2000);

        } catch (error) {
            console.error('註冊失敗:', error);
            messageElement.textContent = error.message;
            messageElement.classList.add('error');
        }
    });
});
