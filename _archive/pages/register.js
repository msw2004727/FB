document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('register-form');
    const messageElement = document.getElementById('message');
    // 【核心新增】獲取載入動畫元素
    const loader = document.getElementById('loader'); 
    const backendBaseUrl = 'https://ai-novel-final.onrender.com';

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        messageElement.textContent = '';
        messageElement.className = 'message';
        // 【核心新增】顯示載入動畫
        loader.classList.remove('hidden');

        const username = document.getElementById('username').value.trim();
        const gender = document.getElementById('gender').value;
        const password = document.getElementById('password').value.trim();

        if (!username || !gender || !password) {
            messageElement.textContent = '所有欄位皆為必填。';
            messageElement.classList.add('error');
            // 【核心新增】出錯時隱藏載入動畫
            loader.classList.add('hidden'); 
            return;
        }

        try {
            const response = await fetch(`${backendBaseUrl}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, gender, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || '發生未知錯誤');
            }

            messageElement.textContent = data.message;
            messageElement.classList.add('success');

            localStorage.setItem('jwt_token', data.token);
            localStorage.setItem('username', data.username);

            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1500);

        } catch (error) {
            console.error('註冊失敗:', error);
            messageElement.textContent = error.message;
            messageElement.classList.add('error');
        } finally {
            // 【核心新增】無論成功或失敗，最後都隱藏載入動畫（除非成功跳轉）
            loader.classList.add('hidden');
        }
    });
});
