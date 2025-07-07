document.addEventListener('DOMContentLoaded', async () => {
    // --- 登入守衛 ---
    const token = localStorage.getItem('jwt_token');
    const username = localStorage.getItem('username');

    if (!token) {
        // 如果沒有令牌，無法知道要讀取誰的資料，直接重定向到登入頁面
        window.location.href = 'login.html';
        return; // 停止執行後續程式碼
    }

    const novelContent = document.getElementById('novel-content');
    const novelTitle = document.getElementById('novel-title');
    const backendBaseUrl = 'https://ai-novel-final.onrender.com';

    // 設定個人化標題
    if (username) {
        novelTitle.textContent = `${username}的江湖路`;
    }

    try {
        // 向後端請求已經由後端完整渲染好的小說HTML
        const response = await fetch(`${backendBaseUrl}/api/game/state/get-novel`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || '無法獲取故事內容。');
        }
        
        // 直接檢查後端回傳的 data.novelHTML 是否有內容
        if (data && data.novelHTML && data.novelHTML.trim() !== '') {
            // 如果有，直接將這段HTML呈現在頁面上
            novelContent.innerHTML = data.novelHTML;
        } else {
            // 如果沒有，或為空字串，則顯示提示訊息
            novelContent.innerHTML = '<p class="loading">您的故事還未寫下第一筆...</p>';
        }

    } catch (error) {
        console.error('獲取小說時出錯:', error);
        novelContent.innerHTML = `<p class="loading">錯誤：無法從世界中讀取您的傳奇。<br>(${error.message})</p>`;
        
        // 如果是授權問題，3秒後跳轉回登入頁
        if (error.message.includes('未經授權') || error.message.includes('無效的身份令牌')) {
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 3000);
        }
    }
});
