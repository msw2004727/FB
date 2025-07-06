import { api } from './api.js'; // 引入我們統一的api管理模組

document.addEventListener('DOMContentLoaded', async () => {
    // --- 登入守衛 ---
    // 檢查本地儲存中是否有JWT權杖，如果沒有，表示未登入，直接跳轉回登入頁面
    const token = localStorage.getItem('jwt_token');
    if (!token) {
        window.location.href = 'login.html';
        return; // 停止執行後續程式碼
    }

    const relationsContent = document.getElementById('relations-content');
    const relationsTitle = document.getElementById('relations-title');
    const username = localStorage.getItem('username');

    // 設定個人化標題
    if (username) {
        relationsTitle.textContent = `${username}的人物關係圖`;
    }

    try {
        // 1. 呼叫後端的API，獲取關係圖的Mermaid語法
        const data = await api.getRelations();

        if (data && data.mermaidSyntax) {
            // 2. 將AI生成的Mermaid語法，插入到指定的div中
            relationsContent.innerHTML = `<div class="mermaid">${data.mermaidSyntax}</div>`;
            
            // 3. 呼叫Mermaid.js的render函式來繪製圖表
            // 'mermaid-graph' 是我們給予圖表的ID，方便未來操作
            await window.mermaid.run({
                nodes: document.querySelectorAll('.mermaid'),
            });

        } else {
            // 如果後端沒有回傳有效的語法，顯示提示訊息
            relationsContent.innerHTML = '<p class="loading-text">你尚未與江湖中人建立足夠的聯繫，暫時無法繪製關係圖。</p>';
        }

    } catch (error) {
        console.error('獲取關係圖時出錯:', error);
        // 如果API呼叫失敗，顯示錯誤訊息
        relationsContent.innerHTML = `<p class="loading-text">錯誤：無法梳理人物脈絡。<br>(${error.message})</p>`;
        
        // 如果是授權問題，3秒後跳轉回登入頁
        if (error.message.includes('未經授權') || error.message.includes('無效的身份令牌')) {
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 3000);
        }
    }
});
