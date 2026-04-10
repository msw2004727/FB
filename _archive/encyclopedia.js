// scripts/encyclopedia.js
import { api } from './api.js'; // 【核心新增】引入統一的API模組

document.addEventListener('DOMContentLoaded', async () => {
    // --- 登入守衛 ---
    const token = localStorage.getItem('jwt_token');
    const username = localStorage.getItem('username');

    if (!token) {
        window.location.href = 'login.html';
        return; 
    }

    const encyclopediaContent = document.getElementById('encyclopedia-content');
    const encyclopediaTitle = document.getElementById('encyclopedia-title');

    // 設定個人化標題
    if (username) {
        encyclopediaTitle.textContent = `${username}的江湖百科`;
    }

    try {
        // 【核心修改】改為使用 api.js 中的 getEncyclopedia 函式發起請求
        const data = await api.getEncyclopedia();
        
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
