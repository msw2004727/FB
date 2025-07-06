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
    chatNpcName.textContent = `與 ${profile.name} 密談中`;
    chatNpcInfo.textContent = profile.appearance || '';
    chatLog.innerHTML = `<p class="system-message">你開始與${profile.name}交談...</p>`;
    chatModal.classList.add('visible');
}

export function closeChatModal() {
    chatModal.classList.remove('visible');
}

export function appendChatMessage(speaker, message) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add(`${speaker}-message`);
    messageDiv.textContent = message;
    chatLog.appendChild(messageDiv);
    chatLog.scrollTop = chatLog.scrollHeight;
}

export function setChatLoading(isLoading) {
    if (chatLoader) {
        chatLoader.classList.toggle('visible', isLoading);
    }
}
