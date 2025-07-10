// scripts/modalManager.js
import { api } from './api.js';
import { initializeTrade } from './tradeManager.js'; 

// --- 獲取所有彈窗相關的 DOM 元素 ---
const deceasedOverlay = document.getElementById('deceased-overlay');
const deceasedTitle = document.getElementById('deceased-title');

const combatModal = document.getElementById('combat-modal');
const closeCombatBtn = document.getElementById('close-combat-btn');
const combatLog = document.getElementById('combat-log');
const combatLoader = document.getElementById('combat-loader');
const combatTurnCounter = document.getElementById('combat-turn-counter');
const alliesRoster = document.getElementById('allies-roster');
const enemiesRoster = document.getElementById('enemies-roster');
const strategyButtonsContainer = document.getElementById('strategy-buttons');
const skillSelectionContainer = document.getElementById('skill-selection');
const confirmActionContainer = document.getElementById('confirm-action');


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

const skillsModal = document.getElementById('skills-modal');
const closeSkillsBtn = document.getElementById('close-skills-btn');
const skillsTabsContainer = document.getElementById('skills-tabs-container');
const skillsBodyContainer = document.getElementById('skills-body-container');


// --- 交易系統函式 ---

export function openTradeModal(tradeData, npcName, onTradeComplete) {
    const tradeModalEl = document.getElementById('trade-modal');
    if (!tradeModalEl || !tradeData) return;

    initializeTrade(tradeData, npcName, onTradeComplete);
    
    tradeModalEl.classList.remove('hidden');
    tradeModalEl.classList.add('flex');
}

export function closeTradeModal() {
    const tradeModalEl = document.getElementById('trade-modal');
    if (tradeModalEl) {
        tradeModalEl.classList.add('hidden');
        tradeModalEl.classList.remove('flex');
    }
}

// --- Helper Functions ---
function displayRomanceValue(value) {
    if (!value || value <= 0) {
        const existingHearts = chatNpcInfo.querySelector('.romance-hearts');
        if (existingHearts) existingHearts.remove();
        return;
    }

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
    const percentage = ((value || 0) + 100) / 200 * 100;
    const barContainer = document.createElement('div');
    barContainer.className = 'friendliness-bar-container';
    const gradientColor = `linear-gradient(to right, #dc3545, #868e96 ${percentage}%, #198754)`;
    barContainer.innerHTML = `
        <div class="friendliness-bar-labels"><span>死敵</span><span>崇拜</span></div>
        <div class="friendliness-bar-background" style="background: ${gradientColor};">
            <div class="friendliness-bar-indicator" style="left: ${percentage}%;"></div>
        </div>
    `;
    const existingBar = chatNpcInfo.querySelector('.friendliness-bar-container');
    if (existingBar) existingBar.remove();
    chatNpcInfo.appendChild(barContainer);
}

function createCharacterCard(character) {
    const card = document.createElement('div');
    card.className = 'character-card';
    card.dataset.name = character.name || character.username;

    let tagsHtml = '';
    if (character.tags && Array.isArray(character.tags)) {
        tagsHtml = `<div class="tags-container">
            ${character.tags.map(tag => `<span class="trait-tag tag-${tag.type}">${tag.name}</span>`).join('')}
        </div>`;
    }

    let mpBarHtml = '';
    if (character.mp !== undefined && character.maxMp !== undefined) {
        const mpPercentage = (character.mp / character.maxMp) * 100;
        mpBarHtml = `
            <div class="mp-bar-container" title="內力">
                <div class="mp-bar-fill" style="width: ${mpPercentage}%;"></div>
                <span class="bar-value-text">${character.mp}</span>
            </div>
        `;
    }

    const hpPercentage = (character.hp / character.maxHp) * 100;

    card.innerHTML = `
        <div class="character-info">
            <div class="character-name">${character.name || character.username}</div>
            ${tagsHtml}
        </div>
        <div class="stats-bars-container">
            <div class="hp-bar-container" title="氣血">
                <div class="hp-bar-fill" style="width: ${hpPercentage}%;"></div>
                <span class="bar-value-text">${character.hp}</span>
            </div>
            ${mpBarHtml}
        </div>
    `;
    return card;
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

export function openCombatModal(initialState, onCombatCancel) {
    alliesRoster.innerHTML = '<h4><i class="fas fa-users"></i> 我方陣營</h4>';
    enemiesRoster.innerHTML = '<h4><i class="fas fa-skull-crossbones"></i> 敵方陣營</h4>';
    strategyButtonsContainer.innerHTML = '';
    skillSelectionContainer.innerHTML = '<div class="system-message">請先選擇一個策略</div>';
    confirmActionContainer.innerHTML = '';

    if (initialState.player) {
        alliesRoster.appendChild(createCharacterCard(initialState.player));
    }
    if (initialState.allies && initialState.allies.length > 0) {
        initialState.allies.forEach(ally => alliesRoster.appendChild(createCharacterCard(ally)));
    }
    if (initialState.enemies && initialState.enemies.length > 0) {
        initialState.enemies.forEach(enemy => enemiesRoster.appendChild(createCharacterCard(enemy)));
    }

    combatLog.innerHTML = '';
    if (initialState.log && initialState.log.length > 0) {
        updateCombatLog(`<p>${initialState.log[0]}</p>`);
    }
    setTurnCounter(initialState.turn || 1);
    
    strategyButtonsContainer.innerHTML = `
        <button class="strategy-btn" data-strategy="attack"><i class="fas fa-gavel"></i> 攻擊</button>
        <button class="strategy-btn" data-strategy="defend"><i class="fas fa-shield-alt"></i> 防禦</button>
        <button class="strategy-btn" data-strategy="evade"><i class="fas fa-running"></i> 迴避</button>
    `;
    
    confirmActionContainer.innerHTML = `
        <button id="combat-confirm-btn" class="confirm-btn" disabled>確定</button>
        <button id="combat-surrender-btn" class="surrender-btn">認輸</button>
    `;
    
    if (closeCombatBtn) {
        // 【核心修改】將關閉按鈕的邏輯簡化為直接取消
        const closeHandler = () => {
            closeCombatModal();
            if (typeof onCombatCancel === 'function') {
                onCombatCancel();
            }
            // 移除監聽器以避免記憶體洩漏
            closeCombatBtn.removeEventListener('click', closeHandler);
        };
        closeCombatBtn.addEventListener('click', closeHandler);
    }

    combatModal.classList.add('visible');
}

export function updateCombatUI(updatedState) {
    const allCombatants = [
        updatedState.player,
        ...(updatedState.allies || []),
        ...(updatedState.enemies || [])
    ];

    allCombatants.forEach(character => {
        if (!character) return;
        const characterName = character.name || character.username;
        const card = combatModal.querySelector(`.character-card[data-name="${characterName}"]`);
        if (card) {
            const hpBar = card.querySelector('.hp-bar-fill');
            const hpValueText = card.querySelector('.hp-bar-container .bar-value-text');
            const hpPercentage = (character.hp / character.maxHp) * 100;
            if (hpBar) hpBar.style.width = `${hpPercentage}%`;
            if (hpValueText) hpValueText.textContent = character.hp;
            
            const mpBar = card.querySelector('.mp-bar-fill');
            const mpValueText = card.querySelector('.mp-bar-container .bar-value-text');
            if (mpBar && mpValueText && character.mp !== undefined) {
                const mpPercentage = (character.mp / character.maxMp) * 100;
                mpBar.style.width = `${mpPercentage}%`;
                mpValueText.textContent = character.mp;
            }
        }
    });
}

export function updateCombatLog(htmlContent, className = '') {
    const p = document.createElement('div');
    if (className) p.className = className;
    p.innerHTML = htmlContent.replace(/\n/g, '<br>');
    combatLog.appendChild(p);
    combatLog.scrollTop = combatLog.scrollHeight;
}

export function setTurnCounter(turn) {
    combatTurnCounter.textContent = `第 ${turn} 回合`;
}

export function closeCombatModal() { 
    if(combatModal) combatModal.classList.remove('visible'); 
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
    messageDiv.className = `${speaker}-message`;
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
        for (const [itemName, itemData] of Object.entries(inventory)) {
            if (itemData.quantity > 0) {
                hasItems = true;
                const itemDiv = document.createElement('div');
                itemDiv.className = 'give-item';
                itemDiv.innerHTML = `<i class="fas ${itemName === '銀兩' ? 'fa-coins' : 'fa-box-open'}"></i> ${itemName} (數量: ${itemData.quantity})`;
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
        const type = skill.skillType || '雜學';
        if (!acc[type]) {
            acc[type] = [];
        }
        acc[type].push(skill);
        return acc;
    }, {});

    const skillTypes = Object.keys(skillsByType);

    // 【核心新增】建立一個翻譯對照表
    const powerTypeMap = {
        internal: '內功',
        external: '外功',
        lightness: '輕功',
        none: '無'
    };

    skillTypes.forEach((type, index) => {
        const tabButton = document.createElement('button');
        tabButton.className = 'skill-tab';
        tabButton.textContent = type;
        tabButton.dataset.tab = type;
        
        const tabContent = document.createElement('div');
        tabContent.className = 'skill-tab-content';
        tabContent.id = `tab-${type}`;

        skillsByType[type].forEach(skill => {
            const expToNextLevel = (skill.level + 1) * 100;
            const expPercentage = expToNextLevel > 0 ? (skill.exp / expToNextLevel) * 100 : 0;
            
            // 【核心修改】使用翻譯後的中文名稱
            const translatedPowerType = powerTypeMap[skill.power_type] || '無';

            const skillEntry = document.createElement('div');
            skillEntry.className = 'skill-entry';
            skillEntry.innerHTML = `
                <div class="skill-entry-header">
                    <h4>${skill.skillName}</h4>
                    <span class="skill-type">${translatedPowerType}</span>
                </div>
                <p class="skill-description">${skill.base_description || '暫無描述。'}</p>
                <div class="skill-progress-container">
                    <span class="level-label">等級 ${skill.level}</span>
                    <div class="exp-bar-background">
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

    skillsTabsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('skill-tab')) {
            const tabName = e.target.dataset.tab;
            
            skillsTabsContainer.querySelectorAll('.skill-tab').forEach(tab => tab.classList.remove('active'));
            skillsBodyContainer.querySelectorAll('.skill-tab-content').forEach(content => content.classList.remove('active'));
            
            e.target.classList.add('active');
            document.getElementById(`tab-${tabName}`).classList.add('active');
        }
    });

    skillsModal.classList.add('visible');
}

export function closeSkillsModal() {
    if (skillsModal) {
        skillsModal.classList.remove('visible');
    }
}
