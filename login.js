document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('login-form');
    const messageElement = document.getElementById('message');
    const backendBaseUrl = 'https://ai-novel-final.onrender.com';

    form.addEventListener('submit', async (e) => {
        e.preventDefault(); // 防止表單預設的提交行為

        // 清空之前的訊息
        messageElement.textContent = '';
        messageElement.className = 'message';

        // 獲取表單資料
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();

        if (!username || !password) {
            messageElement.textContent = '所有欄位皆為必填。';
            messageElement.classList.add('error');
            return;
        }

        try {
            const response = await fetch(`${backendBaseUrl}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                // 如果伺服器回傳錯誤 (如 401, 500), 拋出錯誤
                throw new Error(data.message || '發生未知錯誤');
            }

            // 登入成功
            messageElement.textContent = data.message + ' 即將進入遊戲...';
            messageElement.classList.add('success');

            // 【重要】將 token 和 username 存儲到瀏覽器的 localStorage
            localStorage.setItem('jwt_token', data.token);
            localStorage.setItem('username', data.username);

            // 1.5秒後自動跳轉到主遊戲頁面
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1500);

        } catch (error) {
            console.error('登入失敗:', error);
            messageElement.textContent = error.message;
            messageElement.classList.add('error');
        }
    });
});
