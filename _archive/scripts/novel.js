import { api } from './api.js';

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('jwt_token');
    const username = localStorage.getItem('username');

    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    const novelContent = document.getElementById('novel-content');
    const novelTitle = document.getElementById('novel-title');

    if (username) {
        novelTitle.textContent = `${username}的江湖路`;
    }

    try {
        const novelText = await api.getNovel();

        if (novelText && String(novelText).trim() !== '') {
            const formatted = String(novelText).replace(/\n/g, '<br>');
            novelContent.innerHTML = formatted;
        } else {
            novelContent.innerHTML = '<p class="loading">您的故事還未寫下第一筆...</p>';
        }
    } catch (error) {
        console.error('獲取小說時出錯:', error);
        novelContent.innerHTML = `<p class="loading">錯誤：無法讀取您的傳奇。<br>(${error.message})</p>`;
    }
});
