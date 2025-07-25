// scripts/relations.js
import { api } from './api.js'; // 引入我們統一的api管理模組

document.addEventListener('DOMContentLoaded', async () => {
    // --- 登入守衛 ---
    const token = localStorage.getItem('jwt_token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    const relationsContent = document.getElementById('relations-content');
    const relationsTitle = document.getElementById('relations-title');
    const username = localStorage.getItem('username');

    // --- 【核心新增】獲取彈窗相關的 DOM 元素 ---
    const portraitModal = document.getElementById('portrait-modal');
    const portraitImage = document.getElementById('portrait-image');
    const portraitName = document.getElementById('portrait-name');
    const portraitTitle = document.getElementById('portrait-title');

    // 設定個人化標題
    if (username) {
        relationsTitle.textContent = `${username}的人物關係圖`;
    }

    // --- 【核心修正】將函式明確掛載到 window 物件上，使其成為全域函式 ---
    window.showNpcPortrait = async (npcName) => {
        if (!portraitModal) return;

        // 1. 顯示彈窗並重置內容
        portraitModal.classList.add('visible');
        portraitName.textContent = '讀取中...';
        portraitTitle.textContent = '...';
        portraitImage.innerHTML = '<i class="fas fa-spinner fa-spin fa-2x"></i>';

        try {
            // 【除錯】檢查玩家本身的情況
            if (npcName === username) {
                portraitName.textContent = username;
                portraitTitle.textContent = '玩家';
                portraitImage.innerHTML = '<span><i class="fas fa-user-circle"></i> 這是你自己</span>';
                return;
            }

            // 2. 向後端請求 NPC 的詳細資料
            const profile = await api.getNpcProfile(npcName);

            // 3. 更新彈窗內容
            portraitName.textContent = profile.name || npcName;
            portraitTitle.textContent = profile.status_title || '身份不明';

            if (profile.avatarUrl) {
                portraitImage.innerHTML = `<img src="${profile.avatarUrl}" alt="${profile.name}">`;
            } else {
                portraitImage.innerHTML = '<span><i class="fas fa-image"></i> 暫無肖像</span>';
            }
        } catch (error) {
            console.error(`獲取 ${npcName} 的肖像失敗:`, error);
            portraitName.textContent = npcName;
            portraitTitle.textContent = '讀取失敗';
            portraitImage.innerHTML = '<span><i class="fas fa-exclamation-triangle"></i> 無法載入資料</span>';
        }
    };

    // --- 為彈窗增加關閉事件 ---
    if (portraitModal) {
        portraitModal.addEventListener('click', (event) => {
            // 點擊背景遮罩時關閉彈窗
            if (event.target === portraitModal) {
                portraitModal.classList.remove('visible');
            }
        });
    }


    try {
        // 1. 呼叫後端的API，獲取關係圖的Mermaid語法
        const data = await api.getRelations();

        if (data && data.mermaidSyntax) {
            // 2. 將AI生成的Mermaid語法，插入到指定的div中
            relationsContent.innerHTML = `<div class="mermaid">${data.mermaidSyntax}</div>`;
            
            // 3. 呼叫Mermaid.js的render函式來繪製圖表
            await window.mermaid.run({
                nodes: document.querySelectorAll('.mermaid'),
            });

        } else {
            relationsContent.innerHTML = '<p class="loading-text">你尚未與江湖中人建立足夠的聯繫，暫時無法繪製關係圖。</p>';
        }

    } catch (error) {
        console.error('獲取關係圖時出錯:', error);
        relationsContent.innerHTML = `<p class="loading-text">錯誤：無法梳理人物脈絡。<br>(${error.message})</p>`;
        
        if (error.message.includes('未經授權') || error.message.includes('無效的身份令牌')) {
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 3000);
        }
    }
});
