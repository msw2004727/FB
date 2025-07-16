// scripts/modalManager.js
import { api } from './api.js';
import { initializeTrade, closeTradeUI } from './tradeManager.js';
import { dom } from './dom.js';
import { processNewRoundData } from './gameLoop.js';

// --- 處理自廢武功的函式 ---
async function handleForgetSkill(skillName, skillType) {
    if (!skillName) return;

    const confirmationText = `你確定要廢除「${skillName}」這門武學嗎？\n此過程不可逆，所有修練成果將會煙消雲散！`;
    if (!confirm(confirmationText)) {
        return;
    }

    closeSkillsModal(); 
    const gameLoop = await import('./gameLoop.js'); 
    gameLoop.setLoading(true, '正在散去功力，重塑經脈...');

    try {
        const result = await api.forgetSkill({ skillName: skillName, skillType: skillType });
        
        if (result.success && result.roundData) {
            processNewRoundData(result);
        } else {
            throw new Error(result.message || '廢功失敗，但未收到明確原因。');
        }

    } catch (error) {
        console.error('自廢武功失敗:', error);
        alert(`操作失敗：${error.message}`);
    } finally {
        const gameLoop = await import('./gameLoop.js');
        if (!document.getElementById('epilogue-modal').classList.contains('visible')) {
            gameLoop.setLoading(false);
        }
    }
}


// --- 交易系統函式 ---
export function openTradeModal(tradeData, npcName, onTradeComplete, closeCallback) {
    const tradeModalEl = document.getElementById('trade-modal');
    if (!tradeModalEl) {
        console.error("【嚴重錯誤】: 找不到 ID 為 'trade-modal' 的 HTML 元素！請檢查 index.html。");
        return;
    }
    if (!tradeData) {
        console.error("【嚴重錯誤】: 傳入的 tradeData 為空！");
        return;
    }
    initializeTrade(tradeData, npcName, onTradeComplete, closeCallback);
    tradeModalEl.classList.add('visible');
}

export function closeTradeModal() {
    const tradeModalEl = document.getElementById('trade-modal');
    if (tradeModalEl) {
        tradeModalEl.classList.remove('visible');
        closeTradeUI();
    }
}

// --- Helper Functions ---
function displayRomanceValue(value) {
    const chatNpcInfo = document.getElementById('chat-npc-info');
    if (!chatNpcInfo) return;

    const existingHearts = chatNpcInfo.querySelector('.romance-hearts');
    if (existingHearts) existingHearts.remove();

    if (!value || value <= 0) return;

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

    chatNpcInfo.prepend(heartsContainer);
}

function displayFriendlinessBar(value) {
    const chatNpcInfo = document.getElementById('chat-npc-info');
    if (!chatNpcInfo) return;

    const existingBar = chatNpcInfo.querySelector('.friendliness-bar-container');
    if (existingBar) existingBar.remove();

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
    const deceasedOverlay = document.getElementById('deceased-overlay');
    const deceasedTitle = document.getElementById('deceased-title');
    if (!deceasedOverlay || !deceasedTitle) return;

    const username = localStorage.getItem('username');
    deceasedTitle.textContent = `${username || '你'}的江湖路已到盡頭`;
    deceasedOverlay.classList.add('visible');
}

export function showEpilogueModal(storyHtml, onEpilogueEnd) {
    const epilogueModal = document.getElementById('epilogue-modal');
    const epilogueStory = document.getElementById('epilogue-story');
    const closeEpilogueBtn = document.getElementById('close-epilogue-btn');
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
    const epilogueModal = document.getElementById('epilogue-modal');
    if (epilogueModal) epilogueModal.classList.remove('visible');
}

// --- 戰鬥彈窗 ---
export function openCombatModal(initialState, onCombatCancel) {
    const combatModal = document.getElementById('combat-modal');
    if (!combatModal) return;

    const alliesRoster = document.getElementById('allies-roster');
    const enemiesRoster = document.getElementById('enemies-roster');
    const combatLog = document.getElementById('combat-log');
    const combatTurnCounter = document.getElementById('combat-turn-counter');
    const strategyButtonsContainer = document.getElementById('strategy-buttons');
    const skillSelectionContainer = document.getElementById('skill-selection');
    const confirmActionContainer = document.getElementById('confirm-action');

    alliesRoster.innerHTML = '<h4><i class="fas fa-users"></i> 我方陣營</h4>';
    enemiesRoster.innerHTML = '<h4><i class="fas fa-skull-crossbones"></i> 敵方陣營</h4>';

    if (initialState.player) alliesRoster.appendChild(createCharacterCard(initialState.player));
    if (initialState.allies) initialState.allies.forEach(ally => alliesRoster.appendChild(createCharacterCard(ally)));
    if (initialState.enemies) initialState.enemies.forEach(enemy => enemiesRoster.appendChild(createCharacterCard(enemy)));

    combatLog.innerHTML = `<p>${initialState.log?.[0] || '戰鬥開始！'}</p>`;
    combatTurnCounter.textContent = `第 ${initialState.turn || 1} 回合`;

    strategyButtonsContainer.innerHTML = `
        <button class="strategy-btn" data-strategy="attack"><i class="fas fa-gavel"></i> 攻擊</button>
        <button class="strategy-btn" data-strategy="defend"><i class="fas fa-shield-alt"></i> 防禦</button>
        <button class="strategy-btn" data-strategy="evade"><i class="fas fa-running"></i> 迴避</button>
        <button class="strategy-btn" data-strategy="support"><i class="fas fa-hands-helping"></i> 輔助</button>
        <button class="strategy-btn" data-strategy="heal"><i class="fas fa-briefcase-medical"></i> 治癒</button>
    `;

    skillSelectionContainer.innerHTML = '<div class="system-message">請先選擇一個策略</div>';
    confirmActionContainer.innerHTML = `
        <button id="combat-confirm-btn" class="confirm-btn" disabled>確定</button>
        <button id="combat-surrender-btn" class="surrender-btn">認輸</button>
    `;

    const closeCombatBtn = document.getElementById('close-combat-btn');
    if (closeCombatBtn) {
        closeCombatBtn.onclick = () => {
            closeCombatModal();
            if (typeof onCombatCancel === 'function') onCombatCancel();
        };
    }

    combatModal.classList.add('visible');
}

export function updateCombatUI(updatedState) {
    const combatModal = document.getElementById('combat-modal');
    if (!combatModal) return;

    const allCombatants = [ updatedState.player, ...(updatedState.allies || []), ...(updatedState.enemies || []) ];
    allCombatants.forEach(character => {
        if (!character) return;
        const characterName = character.name || character.username;
        const card = combatModal.querySelector(`.character-card[data-name="${characterName}"]`);
        if (card) {
            const hpBar = card.querySelector('.hp-bar-fill');
            const hpValueText = card.querySelector('.hp-bar-container .bar-value-text');
            if(hpBar && hpValueText) {
                hpBar.style.width = `${(character.hp / character.maxHp) * 100}%`;
                hpValueText.textContent = character.hp;
            }

            const mpBar = card.querySelector('.mp-bar-fill');
            const mpValueText = card.querySelector('.mp-bar-container .bar-value-text');
            if (mpBar && mpValueText && character.mp !== undefined) {
                mpBar.style.width = `${(character.mp / character.maxMp) * 100}%`;
                mpValueText.textContent = character.mp;
            }
        }
    });
}

export function updateCombatLog(htmlContent, className = '') {
    const combatLog = document.getElementById('combat-log');
    if (!combatLog) return;
    const p = document.createElement('div');
    if (className) p.className = className;
    p.innerHTML = htmlContent.replace(/\n/g, '<br>');
    combatLog.appendChild(p);
    combatLog.scrollTop = combatLog.scrollHeight;
}

export function setTurnCounter(turn) {
    const combatTurnCounter = document.getElementById('combat-turn-counter');
    if(combatTurnCounter) combatTurnCounter.textContent = `第 ${turn} 回合`;
}

export function closeCombatModal() {
    const combatModal = document.getElementById('combat-modal');
    if(combatModal) combatModal.classList.remove('visible');
}
export function setCombatLoading(isLoading) {
    const combatLoader = document.getElementById('combat-loader');
    if (combatLoader) combatLoader.classList.toggle('visible', isLoading);
}


// --- 對話彈窗 ---
export function openChatModalUI(profile, mode = 'chat') {
    const chatModal = document.getElementById('chat-modal');
    const chatNpcName = document.getElementById('chat-npc-name');
    const chatNpcInfo = document.getElementById('chat-npc-info');
    const chatLog = document.getElementById('chat-log');
    const giveItemBtn = document.getElementById('give-item-btn');
    const chatFooter = document.querySelector('.chat-footer');
    const chatActionBtn = document.getElementById('chat-action-btn');

    if (!chatModal || !chatNpcName || !chatNpcInfo || !chatLog || !giveItemBtn || !chatFooter) return;

    if (mode === 'inquiry') {
        chatNpcName.textContent = `向 ${profile.name} 探聽秘聞`;
        chatNpcInfo.innerHTML = `<span class="inquiry-cost-text"><i class="fas fa-coins"></i> 花費100銀兩</span>`;
    } else {
        chatNpcName.textContent = `與 ${profile.name} 交談`;
        chatNpcInfo.innerHTML = profile.status_title || '';
        displayRomanceValue(profile.romanceValue);
        displayFriendlinessBar(profile.friendlinessValue);
    }

    giveItemBtn.style.display = mode === 'inquiry' ? 'none' : 'inline-flex';
    chatFooter.style.display = mode === 'inquiry' ? 'none' : 'block';
    chatLog.innerHTML = `<p class="system-message">你開始與${profile.name}交談...</p>`;

    if (chatActionBtn) chatActionBtn.disabled = false;

    chatModal.classList.add('visible');
    chatModal.dataset.mode = mode;
}

export function closeChatModal() {
    const chatModal = document.getElementById('chat-modal');
    if(chatModal) chatModal.classList.remove('visible');
}
export function appendChatMessage(speaker, message) {
    const chatLog = document.getElementById('chat-log');
    if(!chatLog) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = `${speaker}-message`;
    messageDiv.innerHTML = message;
    chatLog.appendChild(messageDiv);
    chatLog.scrollTop = chatLog.scrollHeight;
}
export function setChatLoading(isLoading) {
    const chatLoader = document.getElementById('chat-loader');
    if (chatLoader) chatLoader.classList.toggle('visible', isLoading);
}

// --- 贈予物品彈窗 ---
export async function openGiveItemModal(currentNpcName, giveItemCallback) {
    const giveItemModal = document.getElementById('give-item-modal');
    const giveInventoryList = document.getElementById('give-inventory-list');
    if(!giveItemModal || !giveInventoryList) return;

    giveInventoryList.innerHTML = '<p class="system-message">正在翻檢你的行囊...</p>';
    giveItemModal.classList.add('visible');
    try {
        const inventory = await api.getInventory();
        giveInventoryList.innerHTML = '';

        if (inventory && inventory.length > 0) {
            inventory.forEach(itemData => {
                if (itemData.quantity > 0) {
                    const itemName = itemData.itemName || itemData.templateId;
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'give-item';
                    itemDiv.innerHTML = `<i class="fas ${itemName === '銀兩' ? 'fa-coins' : 'fa-box-open'}"></i> ${itemName} (數量: ${itemData.quantity})`

                    itemDiv.addEventListener('click', () => {
                        if (itemName === '銀兩') {
                            const amount = prompt(`你要給予多少銀兩？ (最多 ${itemData.quantity})`, itemData.quantity);
                            if (amount && !isNaN(amount) && amount > 0 && parseInt(amount) <= itemData.quantity) {
                                giveItemCallback({ type: 'money', amount: parseInt(amount), itemName: '銀兩' });
                            } else if (amount !== null) {
                                alert('請輸入有效的數量。');
                            }
                        } else {
                            giveItemCallback({ type: 'item', itemId: itemData.instanceId, itemName: itemName });
                        }
                    });
                    giveInventoryList.appendChild(itemDiv);
                }
            });
        } else {
             giveInventoryList.innerHTML = '<p class="system-message">你身無長物，行囊空空。</p>';
        }

    } catch (error) {
        console.error("獲取背包資料失敗:", error);
        giveInventoryList.innerHTML = `<p class="system-message">翻檢行囊時出錯: ${error.message}</p>`;
    }
}
export function closeGiveItemModal() {
    const giveItemModal = document.getElementById('give-item-modal');
    if(giveItemModal) giveItemModal.classList.remove('visible');
}


// --- 武學總覽彈窗 ---
export function openSkillsModal(skillsData) {
    const skillsModal = document.getElementById('skills-modal');
    const skillsTabsContainer = document.getElementById('skills-tabs-container');
    const skillsBodyContainer = document.getElementById('skills-body-container');
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
        if (!acc[type]) acc[type] = [];
        acc[type].push(skill);
        return acc;
    }, {});

    const skillTypes = Object.keys(skillsByType);
    const powerTypeMap = { internal: '內功', external: '外功', lightness: '輕功', none: '無' };

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
            const translatedPowerType = powerTypeMap[skill.power_type] || '無';

            const customTagHtml = skill.isCustom ? '<span class="skill-custom-tag">自創</span>' : '';
            // 【核心修改】為所有非「現代搏擊」的武學添加廢除按鈕
            const forgetButtonHtml = skill.skillName !== '現代搏擊' 
                ? `<button class="skill-forget-btn" title="自廢武功" data-skill-name="${skill.skillName}" data-skill-type="${skill.power_type}"><i class="fas fa-trash-alt"></i></button>` 
                : '';

            const skillEntry = document.createElement('div');
            skillEntry.className = 'skill-entry';
            skillEntry.innerHTML = `
                <div class="skill-entry-header">
                    <div class="skill-title-group">
                        <h4>${skill.skillName}</h4>
                        ${customTagHtml}
                    </div>
                    <div class="skill-header-controls">
                        <span class="skill-type">${translatedPowerType}</span>
                        ${forgetButtonHtml}
                    </div>
                </div>
                <p class="skill-description">${skill.base_description || '暫無描述。'}</p>
                <div class="skill-progress-container">
                    <span class="level-label">等級 ${skill.level}</span>
                    <div class="exp-bar-background"><div class="exp-bar-fill" style="width: ${expPercentage}%;"></div></div>
                    <span class="exp-text">${skill.exp} / ${expToNextLevel}</span>
                </div>`;
            tabContent.appendChild(skillEntry);
        });

        skillsTabsContainer.appendChild(tabButton);
        skillsBodyContainer.appendChild(tabContent);

        if (index === 0) {
            tabButton.classList.add('active');
            tabContent.classList.add('active');
        }
    });

    skillsTabsContainer.onclick = (e) => {
        if (e.target.classList.contains('skill-tab')) {
            const tabName = e.target.dataset.tab;
            skillsTabsContainer.querySelectorAll('.skill-tab').forEach(tab => tab.classList.remove('active'));
            skillsBodyContainer.querySelectorAll('.skill-tab-content').forEach(content => content.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(`tab-${tabName}`).classList.add('active');
        }
    };
    
    skillsBodyContainer.querySelectorAll('.skill-forget-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const skillName = e.currentTarget.dataset.skillName;
            const skillType = e.currentTarget.dataset.skillType;
            handleForgetSkill(skillName, skillType);
        });
    });

    skillsModal.classList.add('visible');
}


export function closeSkillsModal() {
    const skillsModal = document.getElementById('skills-modal');
    if (skillsModal) skillsModal.classList.remove('visible');
}

// --- 地點詳情彈窗 ---
const keyMap = {
    類型: '類型',
    層級: '層級',
    地理: '地理',
    terrain: '地形',
    nearbyLocations: '鄰近地點',
    經濟潛力: '經濟潛力',
    特產: '特產',
    歷史: '歷史',
    currentProsperity: '當前繁榮度',
    統治: '統治資訊',
    governance: '統治資訊',
    ruler: '統治者',
    allegiance: '歸屬',
    security: '安全狀況',
    當前事務: '當前事務',
    設施: '設施',
    buildings: '建築',
};

function formatObjectForDisplay(obj, keysToExclude = []) {
    if (obj === null || typeof obj !== 'object') {
        return obj || '無';
    }

    let html = '<ul class="location-detail-list">';
    for (const [key, value] of Object.entries(obj)) {
        if (keysToExclude.includes(key) || value === undefined || value === null) continue;

        const displayKey = keyMap[key] || key; 
        let displayValue;

        if (Array.isArray(value)) {
            if (value.length === 0) {
                displayValue = '無';
            } else {
                displayValue = '<ul class="nested-list">';
                value.forEach(item => {
                    if (typeof item === 'object' && item !== null) {
                        const name = item.name || '未知項目';
                        const travelTime = item.travelTime ? ` (${item.travelTime})` : '';
                        displayValue += `<li>${name}${travelTime}</li>`;
                    } else {
                        displayValue += `<li>${item}</li>`;
                    }
                });
                displayValue += '</ul>';
            }
        } else if (typeof value === 'object') {
            displayValue = formatObjectForDisplay(value, keysToExclude); 
        } else {
            displayValue = value.toString().trim() !== '' ? value.toString().replace(/\n/g, '<br>') : '無';
        }

        if (typeof value === 'object' && value !== null) {
            html += `<li class="nested-object">
                        <span class="key">${displayKey}:</span>
                        <div class="value">${displayValue}</div>
                     </li>`;
        } else {
            html += `<li>
                       <span class="key">${displayKey}:</span>
                       <span class="value">${displayValue}</span>
                     </li>`;
        }
    }
    html += '</ul>';
    return html;
}

export function openLocationDetailsModal(locationData) {
    if (!dom.locationDetailsModal || !locationData) return;
    dom.locationModalTitle.textContent = locationData.locationName || '地區情報';
    
    let bodyHtml = '';
    
    const staticData = {
        類型: locationData.locationType,
        層級: locationData.address ? Object.values(locationData.address).join(' > ') : '未知',
        地理: locationData.geography,
        經濟潛力: locationData.economy?.prosperityPotential,
        特產: locationData.economy?.specialty?.join(', ') || '無',
        歷史: locationData.lore?.history,
    };
    
    const dynamicData = {
        當前繁榮度: locationData.economy?.currentProsperity,
        統治: locationData.governance,
        當前事務: locationData.lore?.currentIssues?.join('<br>') || '暫無',
        設施: locationData.facilities?.map(f => `${f.name} (${f.type})`).join(', ') || '無',
        建築: locationData.buildings?.map(b => `${b.name} (${b.type})`).join(', ') || '無',
    };

    bodyHtml += `<div class="location-section"><h4><i class="fas fa-landmark"></i> 靜態情報 (世界設定)</h4>${formatObjectForDisplay(staticData)}</div>`;
    bodyHtml += `<div class="location-section"><h4><i class="fas fa-users"></i> 動態情報 (玩家專屬)</h4>${formatObjectForDisplay(dynamicData)}</div>`;

    dom.locationModalBody.innerHTML = bodyHtml;
    dom.locationDetailsModal.classList.add('visible');
}

export function closeLocationDetailsModal() {
    if(dom.locationDetailsModal) dom.locationDetailsModal.classList.remove('visible');
}
