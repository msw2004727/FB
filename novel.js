document.addEventListener('DOMContentLoaded', async () => {
    // --- 【新增】登入守衛 ---
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

    // 【新增】設定個人化標題
    if (username) {
        novelTitle.textContent = `${username}的江湖路`;
    }

    try {
        // 【修改】API請求現在會加上 Authorization 標頭來驗證身份
        const response = await fetch(`${backendBaseUrl}/api/get-novel`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();

        if (!response.ok) {
            // 如果請求失敗 (例如令牌過期)，拋出從後端收到的錯誤訊息
            throw new Error(data.message || '無法獲取故事內容。');
        }
        
        novelContent.innerHTML = ''; // 清空載入中訊息

        if (data.novel && data.novel.length > 0) {
            data.novel.forEach((paragraph, index) => {
                if(paragraph && paragraph.trim() !== '') { // 確保段落有內容
                    const chapterDiv = document.createElement('div');
                    chapterDiv.className = 'chapter';

                    const title = document.createElement('h2');
                    title.textContent = `第 ${index + 1} 章`;

                    const content = document.createElement('p');
                    // 將換行符 \n 轉換為 <br> 標籤，以保留段落格式
                    content.innerHTML = paragraph.replace(/\n/g, '<br>');

                    chapterDiv.appendChild(title);
                    chapterDiv.appendChild(content);
                    novelContent.appendChild(chapterDiv);
                }
            });
        } else {
            novelContent.innerHTML = '<p class="loading">您的故事還未寫下第一筆...</p>';
        }

    } catch (error) {
        console.error('獲取小說時出錯:', error);
        novelContent.innerHTML = `<p class="loading">錯誤：無法從世界中讀取您的傳奇。<br>(${error.message})</p>`;
        
        // 【新增】如果因為授權問題出錯，3秒後跳轉回登入頁面
        if (error.message.includes('未經授權') || error.message.includes('無效的身份令牌')) {
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 3000);
        }
    }
});
