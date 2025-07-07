document.addEventListener('DOMContentLoaded', () => {

    const novelListContainer = document.getElementById('novel-list');
    const novelModal = document.getElementById('novel-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const modalTitle = document.getElementById('modal-novel-title');
    const modalAuthorInfo = document.getElementById('modal-author-info');
    const modalStoryContent = document.getElementById('modal-story-content');

    // 【***核心修改***】明確指定後端伺服器的完整網址
    const API_BASE_URL = 'https://ai-novel-final.onrender.com/api/library';

    function formatLastUpdated(dateString) {
        const date = new Date(dateString);
        return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
    }

    async function fetchAndDisplayNovels() {
        try {
            // 現在會向正確的後端伺服器發送請求
            const response = await fetch(`${API_BASE_URL}/novels`);
            if (!response.ok) {
                throw new Error('無法從書庫取書，請稍後再試。');
            }
            const novels = await response.json();

            novelListContainer.innerHTML = '';

            if (novels.length === 0) {
                novelListContainer.innerHTML = '<p class="empty-message">圖書館目前空空如也，尚無任何江湖傳奇被記錄下來。</p>';
                return;
            }

            novels.forEach(novel => {
                const novelCard = document.createElement('article');
                novelCard.className = 'novel-card';
                novelCard.dataset.novelId = novel.id; 

                const statusText = novel.isDeceased ? '已完結' : '連載中';
                const statusClass = novel.isDeceased ? 'status-deceased' : 'status-ongoing';

                novelCard.innerHTML = `
                    <div class="card-header">
                        <h3 class="card-title">${novel.novelTitle}</h3>
                        <span class="card-status ${statusClass}">${statusText}</span>
                    </div>
                    <div class="card-body">
                        <p class="card-author"><i class="fas fa-user-edit"></i> 作者：${novel.playerName}</p>
                        <p class="card-last-chapter"><i class="fas fa-scroll"></i> 最新章節：${novel.lastChapterTitle}</p>
                    </div>
                    <footer class="card-footer">
                        <p class="card-last-updated"><i class="fas fa-clock"></i> 最後更新：${formatLastUpdated(novel.lastUpdated)}</p>
                    </footer>
                `;
                novelListContainer.appendChild(novelCard);
            });

        } catch (error) {
            console.error('獲取小說列表失敗:', error);
            novelListContainer.innerHTML = `<p class="error-message">錯誤：${error.message}</p>`;
        }
    }

    async function openNovelModal(novelId) {
        novelModal.classList.add('visible');
        document.body.style.overflow = 'hidden'; 

        modalTitle.textContent = '讀取中...';
        modalAuthorInfo.textContent = '';
        modalStoryContent.innerHTML = '<div class="loader-dots"><span></span><span></span><span></span></div>';
        
        try {
            const response = await fetch(`${API_BASE_URL}/novel/${novelId}`);
            if (!response.ok) {
                throw new Error('無法開啟這本傳奇。');
            }
            const novel = await response.json();

            modalTitle.textContent = novel.novelTitle;
            const statusText = novel.isDeceased ? '已完結' : '連載中';
            modalAuthorInfo.textContent = `作者：${novel.playerName}  |  狀態：${statusText}`;
            modalStoryContent.innerHTML = novel.storyHTML;

        } catch (error) {
            console.error('獲取單本小說失敗:', error);
            modalStoryContent.innerHTML = `<p class="error-message">錯誤：${error.message}</p>`;
        }
    }

    function closeModal() {
        novelModal.classList.remove('visible');
        document.body.style.overflow = ''; 
    }

    // --- 事件監聽 ---

    fetchAndDisplayNovels();

    novelListContainer.addEventListener('click', (event) => {
        const card = event.target.closest('.novel-card');
        if (card && card.dataset.novelId) {
            openNovelModal(card.dataset.novelId);
        }
    });

    closeModalBtn.addEventListener('click', closeModal);

    novelModal.addEventListener('click', (event) => {
        if (event.target === novelModal) {
            closeModal();
        }
    });

});
