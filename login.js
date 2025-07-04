const form = document.getElementById('login-form');
const errorMessage = document.getElementById('error-message');
const backendBaseUrl = 'https://ai-novel-final.onrender.com';

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const res = await fetch(`${backendBaseUrl}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.message);
        }
        // 登入成功，儲存令牌和使用者名稱
        localStorage.setItem('jwt_token', data.token);
        localStorage.setItem('username', data.username);
        window.location.href = 'index.html'; // 跳轉到遊戲主頁
    } catch (err) {
        errorMessage.textContent = err.message;
    }
});
