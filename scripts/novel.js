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

    // 【新增】高亮NPC姓名的輔助函式
    function highlightNpcNames(text, npcs) {
        let highlightedText = text;
        if (npcs && Array.isArray(npcs) && npcs.length > 0) {
            // 根據名字長度排序，避免短名字覆蓋長名字 (例如 "阿" 覆蓋 "阿牛")
            const sortedNpcs = [...npcs].sort((a, b) => b.name.length - a.name.length);
            sortedNpcs.forEach(npc => {
                const regex = new RegExp(npc.name, 'g');
                const replacement = `<span class="npc-name npc-${npc.friendliness}">${npc.name}</span>`;
                highlightedText = highlightedText.replace(regex, replacement);
            });
        }
        return highlightedText;
    }

    try {
        const response = await fetch(`${backendBaseUrl}/api/game/get-novel`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || '無法獲取故事內容。');
        }
        
        novelContent.innerHTML = ''; // 清空載入中訊息

        if (data.novel && data.novel.length > 0) {
            data.novel.forEach((chapterData, index) => {
                if(chapterData && chapterData.text && chapterData.text.trim() !== '') {
                    const chapterDiv = document.createElement('div');
                    chapterDiv.className = 'chapter';

                    const title = document.createElement('h2');
                    title.textContent = `第 ${index + 1} 回`; // 將章改為回，更符合武俠小說風格

                    const content = document.createElement('p');
                    
                    // 【已修改】使用輔助函式處理文字，並將換行符轉換
                    const processedText = highlightNpcNames(chapterData.text, chapterData.npcs);
                    content.innerHTML = processedText.replace(/\n/g, '<br>');

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
        
        // 如果是授權問題，3秒後跳轉回登入頁
        if (error.message.includes('未經授權') || error.message.includes('無效的身份令牌')) {
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 3000);
        }
    }
});
