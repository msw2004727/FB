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

const epilogueModal = document.getElementById('epilogue-modal');
const epilogueStory = document.getElementById('epilogue-story');
const closeEpilogueBtn = document.getElementById('close-epilogue-btn');

// 【核心新增】武學彈窗元素
const skillsModal = document.getElementById('skills-modal');
const closeSkillsBtn = document.getElementById('close-skills-btn');
const skillsTabsContainer = document.getElementById('skills-tabs-container');
const skillsBodyContainer = document.getElementById('skills-body-container');


// --- Helper Functions ---
function displayRomanceValue(value) {
    let level = 0;
    if (value >= 90) level = 5;
    else if (value >= 70) level = 4;
    else if (value >= 50) level = 3;
    else if (value >= 30) level = 2;
    else if (value >= 10) level = 1;

    const heartsContainer = document.createElement('div');
    heartsContainer.className = 'romance-hearts';
    heartsContainer.title = `心動值: ${value}`;
    for (let i = 0; i < 5; i++) {
        const heartSpan = document.createElement('span');
        heartSpan.className = i < level ? 'fas fa-heart' : 'far fa-heart';
        heartsContainer.appendChild(heartSpan);
    }
    const existingHearts = chatNpcInfo.querySelector('.romance-hearts');
    if (existingHearts) existingHearts.remove();
    chatNpcInfo.prepend(heartsContainer);
}

function displayFriendlinessBar(value) {
    // 數值範圍是 -100 到 100，總範圍是 200。我們將其轉換為 0% 到 100% 的百分比。
    const percentage = ((value || 0) + 100) / 200 * 100;
    
    const barContainer = document.createElement('div');
    barContainer.className = 'friendliness-bar-container';

    // 【***核心修改***】生成新的 HTML 結構，包含底圖、填充條和指示器
    barContainer.innerHTML = `
        <div class="friendliness-bar-labels">
            <span>死敵</span>
            <span title="好感度: ${value}">崇拜</span>
        </div>
        <div class="friendliness-bar-background">
            <div class="friendliness-bar-fill" style="width: ${percentage}%;"></div>
            <div class="friendliness-bar-indicator" style="left: ${percentage}%;"></div>
        </div>
    `;
    const existingBar = chatNpcInfo.querySelector('.friendliness-bar-container');
    if (existingBar) existingBar.remove();
    chatNpcInfo.appendChild(barContainer);
}

// --- 死亡與結局 ---
export function showDeceasedScreen() {
    const username = localStorage.getItem('username');
    deceasedTitle.textContent = `${username || '你'}的江湖路已到盡頭`;
    deceasedOverlay.classList.add('visible');
}

export function showEpilogueModal(storyHtml, onEpilogueEnd) {
    if (epilogueModal && epilogueStory && closeEpilogueBtn) {
        epilogueStory.innerHTML = storyHtml;
        epilogueModal.classList.add('visible');
        const handleClick = () => {
            closeEpilogueModal();
            if (typeof onEpilogueEnd === 'function') onEpilogueEnd();
            closeEpilogueBtn.removeEventListener('click', handleClick);
        };
        closeEpilogueBtn.addEventListener('click', handleClick);
    }
}

export function closeEpilogueModal() {
    if (epilogueModal) epilogueModal.classList.remove('visible');
}

// --- 戰鬥彈窗 ---
export function openCombatModal(initialState) {
    combatTitle.textContent = `遭遇強敵`;
    combatEnemies.textContent = `對手: ${initialState.enemies.map(e => e.name).join('、')}`;
    combatLog.innerHTML = '';
    if (initialState.log && initialState.log.length > 0) {
        appendToCombatLog(initialState.log[0], 'combat-intro-text');
    }
    combatModal.classList.add('visible');
}
export function closeCombatModal() { combatModal.classList.remove('visible'); }
export function appendToCombatLog(text, className = '') {
    const p = document.createElement('p');
    p.className = className;
    p.innerHTML = text.replace(/\n/g, '<br>');
    combatLog.appendChild(p);
    combatLog.scrollTop = combatLog.scrollHeight;
}
export function setCombatLoading(isLoading) { if (combatLoader) combatLoader.classList.toggle('visible', isLoading); }

// --- 對話彈窗 ---
export function openChatModalUI(profile) {
    chatNpcName.textContent = `與 ${profile.name} 交談`;
    chatNpcInfo.innerHTML = profile.appearance || '';
    displayRomanceValue(profile.romanceValue);
    displayFriendlinessBar(profile.friendlinessValue);
    chatLog.innerHTML = `<p class="system-message">你開始與${profile.name}交談...</p>`;
    chatModal.classList.add('visible');
}
export function closeChatModal() { chatModal.classList.remove('visible'); }
export function appendChatMessage(speaker, message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-log-area ${speaker}-message`;
    messageDiv.innerHTML = message;
    chatLog.appendChild(messageDiv);
    chatLog.scrollTop = chatLog.scrollHeight;
}
export function setChatLoading(isLoading) { if (chatLoader) chatLoader.classList.toggle('visible', isLoading); }

// --- 贈予物品彈窗 ---
export async function openGiveItemModal(currentNpcName, giveItemCallback) {
    giveInventoryList.innerHTML = '<p class="system-message">正在翻檢你的行囊...</p>';
    giveItemModal.classList.add('visible');
    try {
        const inventory = await api.getInventory();
        giveInventoryList.innerHTML = '';
        let hasItems = false;
        
        // 將物品轉換為陣列並排序，確保 "銀兩" 總在最前面
        const sortedInventory = Object.entries(inventory).sort(([a], [b]) => {
            if (a === '銀兩') return -1;
            if (b === '銀兩') return 1;
            return a.localeCompare(b);
        });

        for (const [itemName, itemData] of sortedInventory) {
            if (itemData.quantity > 0) {
                hasItems = true;
                const itemDiv = document.createElement('div');
                itemDiv.className = 'give-item';
                
                let iconClass = 'fa-box-open';
                if (itemName === '銀兩' || itemData.itemType === '財寶') {
                    iconClass = 'fa-coins';
                } else if (itemData.itemType === '武器') {
                    iconClass = 'fa-glaive-battle-axe'; // 假設是武器圖示
                } else if (itemData.itemType === '秘笈') {
                    iconClass = 'fa-book-scroll'; // 假設是秘笈圖示
                }

                itemDiv.innerHTML = `<i class="fas ${iconClass}"></i> ${itemName} (數量: ${itemData.quantity})`;
                itemDiv.title = `類型: ${itemData.itemType}\n稀有度: ${itemData.rarity}\n描述: ${itemData.description}`;

                itemDiv.addEventListener('click', () => {
                    if (itemName === '銀兩') {
                        const amount = prompt(`你要給予多少銀兩？ (你目前擁有 ${itemData.quantity} 文)`, itemData.quantity);
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
        if (!hasItems) giveInventoryList.innerHTML = '<p class="system-message">你身無長物，行囊空空。</p>';
    } catch (error) {
        console.error("獲取背包資料失敗:", error);
        giveInventoryList.innerHTML = `<p class="system-message">翻檢行囊時出錯: ${error.message}</p>`;
    }
}
export function closeGiveItemModal() { giveItemModal.classList.remove('visible'); }


// --- 武學總覽彈窗 ---
export function openSkillsModal(skillsData) {
    if (!skillsModal || !skillsTabsContainer || !skillsBodyContainer) return;

    skillsTabsContainer.innerHTML = '';
    skillsBodyContainer.innerHTML = '';

    if (!skillsData || skillsData.length === 0) {
        skillsBodyContainer.innerHTML = '<p class="system-message">你尚未習得任何武學。</p>';
        skillsModal.classList.add('visible');
        return;
    }

    const skillsByType = skillsData.reduce((acc, skill) => {
        const type = skill.type || '雜學';
        if (!acc[type]) {
            acc[type] = [];
        }
        acc[type].push(skill);
        return acc;
    }, {});

    const skillTypes = Object.keys(skillsByType);

    skillTypes.forEach((type, index) => {
        const tabButton = document.createElement('button');
        tabButton.className = 'skill-tab';
        tabButton.textContent = type;
        tabButton.dataset.tab = type;
        
        const tabContent = document.createElement('div');
        tabContent.className = 'skill-tab-content';
        tabContent.id = `tab-${type}`;

        skillsByType[type].forEach(skill => {
            const maxLevel = skill.max_level || 10;
            let expToNextLevel = (skill.level === 0) ? 100 : skill.level * 100;
            if (skill.level >= maxLevel) expToNextLevel = skill.exp; // 已滿級，分母等於分子

            const expPercentage = (skill.level >= maxLevel) ? 100 : (skill.exp / expToNextLevel) * 100;
            
            const skillEntry = document.createElement('div');
            skillEntry.className = 'skill-entry';
            skillEntry.innerHTML = `
                <div class="skill-entry-header">
                    <h4>${skill.name}</h4>
                    <span class="skill-type" title="功體加成: ${skill.power_type}">${skill.type}</span>
                </div>
                <p class="skill-description">${skill.description || '暫無描述。'}</p>
                <div class="skill-progress-container">
                    <span class="level-label" title="潛力上限: ${maxLevel}級">等級 ${skill.level}</span>
                    <div class="exp-bar-background" title="${skill.exp} / ${expToNextLevel}">
                        <div class="exp-bar-fill" style="width: ${expPercentage}%;"></div>
                    </div>
                    <span class="exp-text">${skill.exp} / ${expToNextLevel}</span>
                </div>
            `;
            tabContent.appendChild(skillEntry);
        });
        
        skillsTabsContainer.appendChild(tabButton);
        skillsBodyContainer.appendChild(tabContent);

        if (index === 0) {
            tabButton.classList.add('active');
            tabContent.classList.add('active');
        }
    });

    // 事件監聽只綁定一次在容器上
    const tabClickHandler = (e) => {
        if (e.target.classList.contains('skill-tab')) {
            const tabName = e.target.dataset.tab;
            
            skillsTabsContainer.querySelectorAll('.skill-tab').forEach(tab => tab.classList.remove('active'));
            skillsBodyContainer.querySelectorAll('.skill-tab-content').forEach(content => content.classList.remove('active'));
            
            e.target.classList.add('active');
            document.getElementById(`tab-${tabName}`).classList.add('active');
        }
    };
    
    // 移除舊的監聽器再新增，防止重複綁定
    skillsTabsContainer.removeEventListener('click', tabClickHandler);
    skillsTabsContainer.addEventListener('click', tabClickHandler);

    skillsModal.classList.add('visible');
}

export function closeSkillsModal() {
    if (skillsModal) {
        skillsModal.classList.remove('visible');
    }
}
