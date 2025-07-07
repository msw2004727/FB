// scripts/library.js
import { backendBaseUrl } from './config.js'; // 【***核心修改***】

document.addEventListener('DOMContentLoaded', () => {

    // 獲取頁面上的主要元素
    const novelListContainer = document.getElementById('novel-list');
    const novelModal = document.getElementById('novel-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const modalTitle = document.getElementById('modal-novel-title');
    const modalAuthorInfo = document.getElementById('modal-author-info');
    const modalStoryContent = document.getElementById('modal-story-content');

    // 【***核心修改***】 API 的基礎路徑現在從設定檔讀取
    const API_BASE_URL = `${backendBaseUrl}/api/library`;

    /**
     * 格式化日期，使其更易讀
     * @param {string} dateString - ISO 格式的日期字串
     * @returns {string} 格式化後的日期
     */
    function formatLastUpdated(dateString) {
        if (!dateString) return '未知時間';
        const date = new Date(dateString);
        if (isNaN(date)) return '無效日期';
        return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    /**
     * 從後端獲取並顯示所有小說的列表
     */
    async function fetchAndDisplayNovels() {
        try {
            // 【***核心修改***】 使用完整的 API 路徑
            const response = await fetch(`${API_BASE_URL}/novels`);
            if (!response.ok) {
                throw new Error('無法從書庫取書，請稍後再試。');
            }
            const novels = await response.json();

            // 清空載入中的提示
            novelListContainer.innerHTML = '';

            if (novels.length === 0) {
                novelListContainer.innerHTML = '<p class="empty-message">圖書館目前空空如也，尚無任何江湖傳奇被記錄下來。</p>';
                return;
            }

            // 遍歷每一本小說，創建對應的卡片並顯示
            novels.forEach(novel => {
                const novelCard = document.createElement('article');
                novelCard.className = 'novel-card';
                novelCard.dataset.novelId = novel.id; // 將小說ID(作者ID)存在卡片上

                const statusText = novel.isDeceased ? '已完結' : '連載中';
                const statusClass = novel.isDeceased ? 'status-deceased' : 'status-ongoing';

                novelCard.innerHTML = `
                    <div class="card-header">
                        <h3 class="card-title">${novel.novelTitle || '未命名傳奇'}</h3>
                        <span class="card-status ${statusClass}">${statusText}</span>
                    </div>
                    <div class="card-body">
                        <p><i class="fas fa-user-edit"></i> 作者：${novel.playerName || '無名氏'}</p>
                        <p><i class="fas fa-scroll"></i> 最新章節：${novel.lastChapterTitle || '開篇'}</p>
                    </div>
                    <footer class="card-footer">
                        <p><i class="fas fa-clock"></i> 最後更新：${formatLastUpdated(novel.lastUpdated)}</p>
                    </footer>
                `;
                novelListContainer.appendChild(novelCard);
            });

        } catch (error) {
            console.error('獲取小說列表失敗:', error);
            novelListContainer.innerHTML = `<p class="error-message">錯誤：${error.message}</p>`;
        }
    }

    /**
     * 打開彈出視窗並載入指定的小說內容
     * @param {string} novelId - 要載入的小說ID (作者ID)
     */
    async function openNovelModal(novelId) {
        novelModal.classList.add('visible');
        document.body.style.overflow = 'hidden'; // 防止背景滾動

        // 先顯示載入中...
        modalTitle.textContent = '讀取中...';
        modalAuthorInfo.textContent = '';
        modalStoryContent.innerHTML = '<div class="loader-dots"><span></span><span></span><span></span></div>';
        
        try {
            // 【***核心修改***】 使用完整的 API 路徑
            const response = await fetch(`${API_BASE_URL}/novel/${novelId}`);
            if (!response.ok) {
                throw new Error('無法開啟這本傳奇。');
            }
            const novel = await response.json();

            // 填充彈窗內容
            modalTitle.textContent = novel.novelTitle;
            const statusText = novel.isDeceased ? '已完結' : '連載中';
            modalAuthorInfo.textContent = `作者：${novel.playerName}  |  狀態：${statusText}`;
            modalStoryContent.innerHTML = novel.storyHTML;

        } catch (error) {
            console.error('獲取單本小說失敗:', error);
            modalStoryContent.innerHTML = `<p class="error-message">錯誤：${error.message}</p>`;
        }
    }

    /**
     * 關閉小說閱讀彈窗
     */
    function closeModal() {
        novelModal.classList.remove('visible');
        document.body.style.overflow = ''; // 恢復背景滾動
    }

    // --- 事件監聽 ---

    // 頁面載入後，立即獲取小說列表
    fetchAndDisplayNovels();

    // 監聽整個列表容器的點擊事件（事件委派）
    novelListContainer.addEventListener('click', (event) => {
        const card = event.target.closest('.novel-card');
        if (card && card.dataset.novelId) {
            openNovelModal(card.dataset.novelId);
        }
    });

    // 監聽關閉按鈕的點擊
    closeModalBtn.addEventListener('click', closeModal);

    // 監聽點擊彈窗背景的事件（點擊背景也可關閉）
    novelModal.addEventListener('click', (event) => {
        if (event.target === novelModal) {
            closeModal();
        }
    });

    // 監聽鍵盤 "Esc" 按鍵
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && novelModal.classList.contains('visible')) {
            closeModal();
        }
    });
});
