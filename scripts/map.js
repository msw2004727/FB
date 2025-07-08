// scripts/map.js
import { backendBaseUrl } from './config.js';

document.addEventListener('DOMContentLoaded', async () => {
    const mapContent = document.getElementById('map-content');
    const API_URL = `${backendBaseUrl}/api/map/world-map`;

    try {
        const response = await fetch(API_URL);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || '無法從輿圖司獲取地圖資料。');
        }
        const data = await response.json();

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
            // Mermaid.js 會自動找到 class="mermaid" 的元素並將其轉換為SVG圖表
            await window.mermaid.run();

        } else {
            mapContent.innerHTML = '<p class="loading-text">世界混沌初開，尚無人踏足，無法繪製輿圖。</p>';
        }

    } catch (error) {
        console.error('獲取世界地圖時出錯:', error);
        mapContent.innerHTML = `<p class="loading-text">錯誤：輿圖司的繪圖師似乎喝醉了，無法提供地圖。<br>(${error.message})</p>`;
    }
});
