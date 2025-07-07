// scripts/modalManager.js
import { api } from './api.js';

// --- 獲取所有彈窗相關的 DOM 元素 ---
const deceasedOverlay = document.getElementById('deceased-overlay');
const deceasedTitle = document.getElementById('deceased-title');

const combatModal = document.getElementById('combat-modal');
const combatTitle = document.getElementById('combat-title');
const combatEnemies = document.getElementById('combat-enemies');
const combatLog = document.getElementById('combat-log');
const combatLoader = document.getElementById('combat-loader');

const chatModal = document.getElementById('chat-modal');
const chatNpcName = document.getElementById('chat-npc-name');
const chatNpcInfo = document.getElementById('chat-npc-info');
const chatLog = document.getElementById('chat-log');
const chatLoader = document.getElementById('chat-loader');

const giveItemBtn = document.getElementById('give-item-btn');
const giveItemModal = document.getElementById('give-item-modal');
const giveInventoryList = document.getElementById('give-inventory-list');
const cancelGiveBtn = document.getElementById('cancel-give-btn');

// 【核心新增】結局彈窗相關元素
const epilogueModal = document.getElementById('epilogue-modal');
const epilogueStory = document.getElementById('epilogue-story');
const closeEpilogueBtn = document.getElementById('close-epilogue-btn');


// --- Helper Functions ---
function displayRomanceValue(value) {
    let level = 0;
    if (value >= 90) {
        level = 5;
    } else if (value >= 70) {
        level = 4;
    } else if (value >= 50) {
        level = 3;
    } else if (value >= 30) {
        level = 2;
    } else if (value >= 10) {
        level = 1;
    }

    const heartsContainer = document.createElement('div');
    heartsContainer.className = 'romance-hearts';
    heartsContainer.title = `心動值: ${value}`;

    for (let i = 0; i < 5; i++) {
        const heartSpan = document.createElement('span');
        heartSpan.className = i < level ? 'fas fa-heart' : 'far fa-heart';
        heartsContainer.appendChild(heartSpan);
    }

    const existingHearts = chatNpcInfo.querySelector('.romance-hearts');
    if (existingHearts) {
        existingHearts.remove();
    }
    
    chatNpcInfo.prepend(heartsContainer);
}

// 根據友好度數值，創建並顯示計量棒
function displayFriendlinessBar(value) {
    // 將友好度數值從 -100 到 100 的範圍，轉換為 0% 到 100% 的百分比
    const percentage = ((value || 0) + 100) / 200 * 100;

    const barContainer = document.createElement('div');
    barContainer.className = 'friendliness-bar-container';

    // 根據百分比決定漸層色的起點
    const gradientColor = `linear-gradient(to right, #dc3545, #868e96 ${percentage}%, #198754)`;

    barContainer.innerHTML = `
        <div class="friendliness-bar-labels">
            <span>死敵</span>
            <span>崇拜</span>
        </div>
        <div class="friendliness-bar-background">
            <div class="friendliness-bar-indicator" style="left: ${percentage}%;"></div>
        </div>
    `;

    const barBackground = barContainer.querySelector('.friendliness-bar-background');
    if(barBackground) {
        barBackground.style.background = gradientColor;
    }

    const existingBar = chatNpcInfo.querySelector('.friendliness-bar-container');
    if (existingBar) {
        existingBar.remove();
    }

    chatNpcInfo.appendChild(barContainer);
}


// --- 死亡畫面 ---
export function showDeceasedScreen() {
    const username = localStorage.getItem('username');
    deceasedTitle.textContent = `${username || '你'}的江湖路已到盡頭`;
    deceasedOverlay.classList.add('visible');
}

// --- 戰鬥彈窗 ---
export function openCombatModal(initialState) {
    const enemyNames = initialState.enemies.map(e => e.name).join('、');
    combatTitle.textContent = `遭遇強敵`;
    combatEnemies.textContent = `對手: ${enemyNames}`;
    combatLog.innerHTML = '';
    if (initialState.log && initialState.log.length > 0) {
        appendToCombatLog(initialState.log[0], 'combat-intro-text');
    }
    combatModal.classList.add('visible');
}

export function closeCombatModal() {
    combatModal.classList.remove('visible');
}

export function appendToCombatLog(text, className = '') {
    const p = document.createElement('p');
    p.className = className;
    p.innerHTML = text.replace(/\n/g, '<br>');
    combatLog.appendChild(p);
    combatLog.scrollTop = combatLog.scrollHeight;
}

export function setCombatLoading(isLoading) {
    if (combatLoader) {
        combatLoader.classList.toggle('visible', isLoading);
    }
}

// --- 對話彈窗 ---
export function openChatModalUI(profile) {
    chatNpcName.textContent = `與 ${profile.name} 交談`;
    chatNpcInfo.innerHTML = profile.appearance || '';
    
    displayRomanceValue(profile.romanceValue);
    displayFriendlinessBar(profile.friendlinessValue);

    chatLog.innerHTML = `<p class="system-message">你開始與${profile.name}交談...</p>`;
    chatModal.classList.add('visible');
}

export function closeChatModal() {
    chatModal.classList.remove('visible');
}

export function appendChatMessage(speaker, message) {
    const messageDiv = document.createElement('div');
    if(speaker === 'player' || speaker === 'npc' || speaker === 'system') {
        messageDiv.className = `chat-log-area ${speaker}-message`;
    } else {
         messageDiv.className = `chat-log-area npc-message`;
    }
    
    messageDiv.innerHTML = message;

    chatLog.appendChild(messageDiv);
    chatLog.scrollTop = chatLog.scrollHeight;
}


export function setChatLoading(isLoading) {
    if (chatLoader) {
        chatLoader.classList.toggle('visible', isLoading);
    }
}

// --- 贈予物品彈窗 ---
export async function openGiveItemModal(currentNpcName, giveItemCallback) {
    giveInventoryList.innerHTML = '<p class="system-message">正在翻檢你的行囊...</p>';
    giveItemModal.classList.add('visible');

    try {
        const inventory = await api.getInventory();
        giveInventoryList.innerHTML = ''; 

        let hasItems = false;

        for (const [itemName, itemData] of Object.entries(inventory)) {
            // 【***核心修改***】 只有當物品數量大於0時，才顯示在清單上
            if (itemData.quantity > 0) {
                hasItems = true;
                const itemDiv = document.createElement('div');
                itemDiv.classList.add('give-item');
                
                let iconClass = 'fa-box-open';
                if (itemName === '銀兩') {
                    iconClass = 'fa-coins';
                }

                itemDiv.innerHTML = `<i class="fas ${iconClass}"></i> ${itemName} (數量: ${itemData.quantity})`;
                
                itemDiv.addEventListener('click', () => {
                    if (itemName === '銀兩') {
                        const amount = prompt(`你要給予多少銀兩？ (最多 ${itemData.quantity})`, itemData.quantity);
                        if (amount && !isNaN(amount) && amount > 0 && parseInt(amount) <= itemData.quantity) {
                            giveItemCallback({ type: 'money', amount: parseInt(amount), itemName: '銀兩' });
                        } else if (amount !== null) {
                            alert('請輸入有效的數量。');
                        }
                    } else {
                        giveItemCallback({ type: 'item', itemId: itemName, itemName: itemName });
                    }
                });
                giveInventoryList.appendChild(itemDiv);
            }
        }

        if (!hasItems) {
            giveInventoryList.innerHTML = '<p class="system-message">你身無長物，行囊空空。</p>';
        }

    } catch (error) {
        console.error("獲取背包資料失敗:", error);
        giveInventoryList.innerHTML = `<p class="system-message">翻檢行囊時出錯: ${error.message}</p>`;
    }
}

export function closeGiveItemModal() {
    giveItemModal.classList.remove('visible');
}

// --- 【核心新增】結局彈窗 ---
export function showEpilogueModal(storyHtml, onEpilogueEnd) {
    if (epilogueModal && epilogueStory && closeEpilogueBtn) {
        epilogueStory.innerHTML = storyHtml;
        epilogueModal.classList.add('visible');

        const handleClick = () => {
            closeEpilogueModal();
            if (typeof onEpilogueEnd === 'function') {
                onEpilogueEnd();
            }
            // 移除監聽器，避免重複觸發
            closeEpilogueBtn.removeEventListener('click', handleClick);
        };

        closeEpilogueBtn.addEventListener('click', handleClick);
    }
}

export function closeEpilogueModal() {
    if (epilogueModal) {
        epilogueModal.classList.remove('visible');
    }
}
