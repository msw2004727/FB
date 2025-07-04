document.addEventListener('DOMContentLoaded', async () => {
    const novelContent = document.getElementById('novel-content');
    const backendBaseUrl = 'https://md-server-main.onrender.com';

    try {
        const response = await fetch(`${backendBaseUrl}/get-novel`);
        
        if (!response.ok) {
            throw new Error('無法獲取故事內容。');
        }

        const data = await response.json();
        
        novelContent.innerHTML = ''; // 清空載入中訊息

        if (data.novel && Array.isArray(data.novel)) {
            data.novel.forEach((paragraph, index) => {
                const chapterDiv = document.createElement('div');
                chapterDiv.className = 'chapter';

                const title = document.createElement('h2');
                title.textContent = `第 ${index + 1} 章`;

                const content = document.createElement('p');
                content.textContent = paragraph;

                chapterDiv.appendChild(title);
                chapterDiv.appendChild(content);
                novelContent.appendChild(chapterDiv);
            });
        } else {
            novelContent.innerHTML = '<p class="loading">故事還未寫下第一筆...</p>';
        }

    } catch (error) {
        console.error('獲取小說時出錯:', error);
        novelContent.innerHTML = `<p class="loading">錯誤：無法從世界中讀取您的傳奇。 (${error.message})</p>`;
    }
});
