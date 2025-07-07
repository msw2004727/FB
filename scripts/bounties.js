// scripts/bounties.js
import { api } from './api.js'; // 【核心修改】引入統一的API模組

document.addEventListener('DOMContentLoaded', async () => {
    // --- 登入守衛 ---
    const token = localStorage.getItem('jwt_token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    const bountyListContainer = document.getElementById('bounty-list');

    try {
        // 【核心修改】使用 api.js 中的 getBounties 函式發起請求
        const bounties = await api.getBounties();

        renderBounties(bounties);

    } catch (error) {
        console.error('獲取懸賞列表時出錯:', error);
        bountyListContainer.innerHTML = `<p class="empty-message">讀取懸賞告示時發生錯誤，請稍後再試。<br>(${error.message})</p>`;
    }
});

function renderBounties(bounties) {
    const bountyListContainer = document.getElementById('bounty-list');
    
    // 清空載入中提示
    bountyListContainer.innerHTML = '';

    if (bounties.length === 0) {
        bountyListContainer.innerHTML = `<p class="empty-message">目前江湖平靜，暫無任何懸賞。</p>`;
        return;
    }

    bounties.forEach(bounty => {
        const card = document.createElement('div');
        card.className = `bounty-card difficulty-${bounty.difficulty}`;

        const expireDate = new Date(bounty.expireAt);
        const now = new Date();
        const timeLeft = expireDate.getTime() - now.getTime();
        const daysLeft = Math.ceil(timeLeft / (1000 * 60 * 60 * 24));
        const timeLeftString = daysLeft > 0 ? `剩餘 ${daysLeft} 天` : '即將到期';

        card.innerHTML = `
            <div class="card-header">
                <h2 class="card-title">${bounty.title}</h2>
                <span class="card-difficulty difficulty-${bounty.difficulty}">${bounty.difficulty}</span>
            </div>
            <div class="card-body">
                <p>${bounty.content.replace(/\n/g, '<br>')}</p>
            </div>
            <div class="card-footer">
                <span><i class="fas fa-user-tag"></i> 發布者：${bounty.issuer}</span>
                <span><i class="fas fa-clock"></i> ${timeLeftString}</span>
            </div>
        `;
        bountyListContainer.appendChild(card);
    });
}
