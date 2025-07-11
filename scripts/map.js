// scripts/map.js
import { api } from './api.js';

document.addEventListener('DOMContentLoaded', async () => {
    const mapContent = document.getElementById('map-content');
    
    // 【核心修改】登入守衛，確保在發送請求前有token
    const token = localStorage.getItem('jwt_token');
    if (!token) {
        mapContent.innerHTML = '<p class="loading-text">請先登入，才能查看您的個人輿圖。</p>';
        setTimeout(() => { window.location.href = 'login.html'; }, 2000);
        return;
    }

    try {
        // 【核心修改】使用 api 物件發起請求，它會自動攜帶 token
        const data = await api.getMap();

        if (data && data.mermaidSyntax) {
            // 清空載入中提示
            mapContent.innerHTML = '';
            
            // 創建並插入Mermaid圖表容器
            const mermaidContainer = document.createElement('div');
            mermaidContainer.className = 'mermaid';
            // 直接將後端傳來的語法作為文字內容放入
            mermaidContainer.textContent = data.mermaidSyntax;
            mapContent.appendChild(mermaidContainer);
            
            // 執行渲染
            await window.mermaid.run();

        } else {
            mapContent.innerHTML = '<p class="loading-text">世界混沌初開，尚無人踏足，無法繪製輿圖。</p>';
        }

    } catch (error) {
        console.error('獲取世界地圖時出錯:', error);
        mapContent.innerHTML = `<p class="loading-text">錯誤：輿圖司的繪圖師似乎喝醉了，無法提供地圖。<br>(${error.message})</p>`;
    }
});
