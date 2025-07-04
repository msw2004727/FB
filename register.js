document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('register-form');
    const messageElement = document.getElementById('message');
    // 請確保您的後端 URL 正確
    const backendBaseUrl = 'https://ai-novel-final.onrender.com';

    form.addEventListener('submit', async (e) => {
        e.preventDefault(); // 防止表單預設的提交行為

        // 清空之前的訊息
        messageElement.textContent = '';
        messageElement.className = 'message';

        // 獲取表單資料
        const username = document.getElementById('username').value.trim();
        const gender = document.getElementById('gender').value;
        const password = document.getElementById('password').value.trim();

        if (!username || !gender || !password) {
            messageElement.textContent = '所有欄位皆為必填。';
            messageElement.classList.add('error');
            return;
        }

        try {
            // 【已修正】將 /api/register 修改為 /api/auth/register
            const response = await fetch(`${backendBaseUrl}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, gender, password })
            });

            const data = await response.json();

            if (!response.ok) {
                // 如果伺服器回傳錯誤 (如 400, 500), 拋出錯誤
                throw new Error(data.message || '發生未知錯誤');
            }

            // 註冊成功
            messageElement.textContent = data.message + ' 正在將您導向登入頁面...';
            messageElement.classList.add('success');

            // 2秒後自動跳轉到登入頁面
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
