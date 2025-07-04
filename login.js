document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('login-form');
    const messageElement = document.getElementById('message');
    const submitButton = document.getElementById('submit-btn');
    const backendBaseUrl = 'https://ai-novel-final.onrender.com';

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        messageElement.textContent = '';
        messageElement.className = 'message';
        submitButton.disabled = true;
        submitButton.textContent = '登入中...';

        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();

        try {
            const response = await fetch(`${backendBaseUrl}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || '發生未知錯誤');
            }

            // 登入成功
            messageElement.textContent = data.message;
            messageElement.classList.add('success');
            
            // 將伺服器回傳的令牌 (token) 和使用者名稱存儲在瀏覽器的 localStorage 中
            // 這是讓其他頁面（如 index.html）知道玩家已登入的關鍵
            localStorage.setItem('jwt_token', data.token);
            localStorage.setItem('username', data.username);

            // 1.5秒後跳轉到遊戲主頁
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1500);

        } catch (error) {
            console.error('登入失敗:', error);
            messageElement.textContent = error.message;
            messageElement.classList.add('error');
            submitButton.disabled = false;
            submitButton.textContent = '進入';
        }
    });
});
