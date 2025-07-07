document.addEventListener('DOMContentLoaded', async () => {
    // --- 登入守衛 ---
    const token = localStorage.getItem('jwt_token');
    const username = localStorage.getItem('username');

    if (!token) {
        // 如果沒有令牌，無法知道要讀取誰的資料，直接重定向到登入頁面
        window.location.href = 'login.html';
        return; // 停止執行後續程式碼
    }

    const encyclopediaContent = document.getElementById('encyclopedia-content');
    const encyclopediaTitle = document.getElementById('encyclopedia-title');
    const backendBaseUrl = 'https://ai-novel-final.onrender.com';

    // 設定個人化標題
    if (username) {
        encyclopediaTitle.textContent = `${username}的江湖百科`;
    }

    try {
        // 【核心修改】將API路徑修正為後端真實存在的路徑
        const response = await fetch(`${backendBaseUrl}/api/game/state/get-encyclopedia`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || '無法獲取百科內容。');
        }
        
        // 清空載入中訊息，並將後端傳來的HTML內容直接渲染出來
        if (data.encyclopediaHtml) {
            encyclopediaContent.innerHTML = data.encyclopediaHtml;
        } else {
            encyclopediaContent.innerHTML = '<p class="loading">你的江湖經歷尚淺，還沒有可供編撰的百科內容。</p>';
        }

    } catch (error) {
        console.error('獲取百科時出錯:', error);
        encyclopediaContent.innerHTML = `<p class="loading">錯誤：無法從你的記憶中編撰百科。<br>(${error.message})</p>`;
        
        // 如果是授權問題，3秒後跳轉回登入頁
        if (error.message.includes('未經授權') || error.message.includes('無效的身份令牌')) {
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 3000);
        }
    }
});
