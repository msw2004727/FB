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


// --- Helper Functions ---
function displayRomanceValue(value) {
    // 根據 romanceValue 計算愛心等級 (0-5)
    // 0: 0-9, 1: 10-29, 2: 30-49, 3: 50-69, 4: 70-89, 5: 90+
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
        heartSpan.className = i < level ? 'fas fa-heart' : 'far fa-heart'; // 實心或空心
        heartsContainer.appendChild(heartSpan);
    }

    // 清除舊的愛心顯示
    const existingHearts = chatNpcInfo.querySelector('.romance-hearts');
    if (existingHearts) {
        existingHearts.remove();
    }
    
    // 插入到外觀描述的前面
    chatNpcInfo.prepend(heartsContainer);
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
    chatNpcInfo.innerHTML = profile.appearance || ''; // 使用innerHTML以便後續插入HTML元素
    
    // 【核心修改】呼叫新的函式來顯示心動值
    displayRomanceValue(profile.romanceValue);

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
