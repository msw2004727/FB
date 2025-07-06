// scripts/modalManager.js

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

// 【新增】贈予物品彈窗相關元素
const giveItemBtn = document.getElementById('give-item-btn');
const giveItemModal = document.getElementById('give-item-modal');
const giveInventoryList = document.getElementById('give-inventory-list');
const cancelGiveBtn = document.getElementById('cancel-give-btn');


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
    chatNpcInfo.textContent = profile.appearance || '';
    chatLog.innerHTML = `<p class="system-message">你開始與${profile.name}交談...</p>`;
    chatModal.classList.add('visible');
}

export function closeChatModal() {
    chatModal.classList.remove('visible');
}

export function appendChatMessage(speaker, message) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('chat-message', `${speaker}-message`);

    const speakerSpan = document.createElement('span');
    speakerSpan.classList.add('speaker');
    speakerSpan.textContent = `${speaker}:`;
    
    const messageSpan = document.createElement('span');
    messageSpan.classList.add('message-text');
    messageSpan.textContent = message;

    messageDiv.appendChild(speakerSpan);
    messageDiv.appendChild(messageSpan);
    chatLog.appendChild(messageDiv);
    chatLog.scrollTop = chatLog.scrollHeight;
}

export function setChatLoading(isLoading) {
    if (chatLoader) {
        chatLoader.classList.toggle('visible', isLoading);
    }
}

// --- 【新增】贈予物品彈窗 ---
export function openGiveItemModal(playerState, currentNpcId, giveItemCallback) {
    giveInventoryList.innerHTML = ''; // 清空舊列表

    // 建立金錢選項
    if (playerState.ITM.money > 0) {
        const moneyItem = document.createElement('div');
        moneyItem.classList.add('give-item');
        moneyItem.innerHTML = `<i class="fas fa-coins"></i> 銀兩: ${playerState.ITM.money}`;
        moneyItem.addEventListener('click', () => {
             // 彈出一個輸入框讓玩家決定給多少錢
            const amount = prompt(`你要給予多少銀兩？ (最多 ${playerState.ITM.money})`, playerState.ITM.money);
            if (amount && !isNaN(amount) && amount > 0 && parseInt(amount) <= playerState.ITM.money) {
                giveItemCallback({ type: 'money', amount: parseInt(amount), target: currentNpcId });
            } else if (amount !== null) {
                alert('請輸入有效的數量。');
            }
        });
        giveInventoryList.appendChild(moneyItem);
    }

    // 建立背包物品選項
    for (const [itemId, item] of Object.entries(playerState.ITM.items)) {
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('give-item');
        itemDiv.innerHTML = `<i class="fas fa-box-open"></i> ${item.name} (數量: ${item.quantity})`;
        itemDiv.dataset.itemId = itemId;
        itemDiv.addEventListener('click', () => {
            giveItemCallback({ type: 'item', itemId: itemId, itemName: item.name, target: currentNpcId });
        });
        giveInventoryList.appendChild(itemDiv);
    }

    if (giveInventoryList.children.length === 0) {
        giveInventoryList.innerHTML = '<p class="system-message">你身無分文，也沒有任何物品可以贈送。</p>';
    }

    giveItemModal.classList.add('visible');
}

export function closeGiveItemModal() {
    giveItemModal.classList.remove('visible');
}
