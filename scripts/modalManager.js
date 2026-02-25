// scripts/modalManager.js
import { api } from './api.js';
import { initializeTrade, closeTradeUI } from './tradeManager.js';
import { dom } from './dom.js';
import { processNewRoundData } from './gameLoop.js';

// --- Forget Skill Modal Helper ---
async function handleForgetSkill(skillName, skillType) {
    if (!skillName) return;

    const confirmationText = `確定要遺忘「${skillName}」嗎？這可能影響後續戰鬥與修練。`;
    if (!confirm(confirmationText)) {
        return;
    }

    closeSkillsModal();
    const gameLoop = await import('./gameLoop.js');
    gameLoop.setLoading(true, 'Processing skill removal...');

    try {
        const result = await api.forgetSkill({ skillName, skillType, model: dom.aiModelSelector?.value });
        if (result.success && result.roundData) {
            processNewRoundData(result);
        } else {
            throw new Error(result.message || '遺忘技能失敗：回應格式無效。');
        }
    } catch (error) {
        console.error('遺忘技能失敗:', error);
        alert(`遺忘技能失敗：${error.message}`);
    } finally {
        const gameLoop = await import('./gameLoop.js');
        if (!document.getElementById('epilogue-modal').classList.contains('visible')) {
            gameLoop.setLoading(false);
        }
    }
}

// --- Trade Modal ---
export function openTradeModal(tradeData, npcName, onTradeComplete, closeCallback) {
    const tradeModalEl = document.getElementById('trade-modal');
    if (!tradeModalEl) {
        console.error('Missing #trade-modal element in index.html.');
        return;
    }
    if (!tradeData) {
        console.error('Cannot open trade modal: tradeData is empty.');
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
    heartsContainer.title = `情意值 ${value}`;
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
        <div class="friendliness-bar-labels"><span>敵對</span><span>友善</span></div>
        <div class="friendliness-bar-background" style="background: ${gradientColor};">
            <div class="friendliness-bar-indicator" style="left: ${percentage}%;"></div>
        </div>
    `;
    chatNpcInfo.appendChild(barContainer);
}

function escapeCombatText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeSelectorAttrValue(value) {
    const text = String(value ?? '');
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(text);
    }
    return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function clampCombatPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
}

function createCharacterCard(character) {
    const name = character?.name || character?.username || '未知角色';
    const hp = Number(character?.hp ?? 0);
    const maxHp = Math.max(1, Number(character?.maxHp ?? 1));
    const hasMp = character?.mp !== undefined && character?.maxMp !== undefined;
    const mp = Number(character?.mp ?? 0);
    const maxMp = Math.max(0, Number(character?.maxMp ?? 0));
    const isDown = hp <= 0;

    const card = document.createElement('div');
    card.className = `character-card${isDown ? ' is-down' : ''}`;
    card.dataset.name = name;

    let tagsHtml = '';
    if (Array.isArray(character?.tags) && character.tags.length > 0) {
        tagsHtml = `<div class="tags-container">${character.tags.map(tag => `<span class="trait-tag tag-${escapeCombatText(tag.type || 'attack')}">${escapeCombatText(tag.name || '')}</span>`).join('')}</div>`;
    }

    const hpPercentage = clampCombatPercent((hp / maxHp) * 100);
    const mpBarHtml = hasMp ? `
        <div class="mp-bar-container" title="MP">
            <div class="mp-bar-fill" style="width: ${clampCombatPercent(maxMp > 0 ? (mp / maxMp) * 100 : 0)}%;"></div>
            <span class="bar-value-text">${Number.isFinite(mp) ? Math.max(0, mp) : 0}</span>
        </div>
    ` : '';

    card.innerHTML = `
        <div class="character-card-head">
            <div class="character-info">
                <div class="character-name">${escapeCombatText(name)}</div>
                ${character?.status ? `<div class="character-status">${escapeCombatText(character.status)}</div>` : ''}
                ${tagsHtml}
            </div>
            <div class="character-state-chip ${isDown ? 'danger' : ''}">${isDown ? 'Down' : 'Ready'}</div>
        </div>
        <div class="stats-bars-container">
            <div class="hp-bar-container" title="HP">
                <div class="hp-bar-fill" style="width: ${hpPercentage}%;"></div>
                <span class="bar-value-text">${Number.isFinite(hp) ? Math.max(0, hp) : 0}</span>
            </div>
            ${mpBarHtml}
        </div>
    `;
    return card;
}


// --- ?????????????????????? ---
export function showDeceasedScreen() {
    const deceasedOverlay = document.getElementById('deceased-overlay');
    const deceasedTitle = document.getElementById('deceased-title');
    if (!deceasedOverlay || !deceasedTitle) return;

    const username = localStorage.getItem('username');
    deceasedTitle.textContent = `${username || '無名俠客'} 已命喪江湖`;
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

// --- ???????? ---
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

    const allies = Array.isArray(initialState?.allies) ? initialState.allies : [];
    const enemies = Array.isArray(initialState?.enemies) ? initialState.enemies : [];
    const bystanders = Array.isArray(initialState?.bystanders) ? initialState.bystanders : [];

    alliesRoster.innerHTML = `<h4><i class="fas fa-shield-heart"></i> 我方 <span class="roster-count">${1 + allies.length}</span></h4>`;
    enemiesRoster.innerHTML = `<h4><i class="fas fa-crosshairs"></i> 敵方 <span class="roster-count">${enemies.length}</span></h4>`;

    if (initialState.player) alliesRoster.appendChild(createCharacterCard(initialState.player));
    allies.forEach((ally) => alliesRoster.appendChild(createCharacterCard(ally)));
    enemies.forEach((enemy) => enemiesRoster.appendChild(createCharacterCard(enemy)));

    combatLog.innerHTML = '';
    updateCombatLog(initialState.log?.[0] || '戰鬥開始。');

    combatTurnCounter.innerHTML = `
        <div class="combat-turn-pill">第 ${initialState.turn || 1} 回合</div>
        <div class="combat-battle-status">
            ${initialState.intention ? `意圖：${escapeCombatText(initialState.intention)}` : '請選擇本回合行動'}
            ${bystanders.length > 0 ? `｜旁觀者：${bystanders.length}` : ''}
        </div>
    `;

    strategyButtonsContainer.innerHTML = `
        <button class="strategy-btn" data-strategy="attack"><i class="fas fa-gavel"></i> 攻擊</button>
        <button class="strategy-btn" data-strategy="defend"><i class="fas fa-shield-alt"></i> 防禦</button>
        <button class="strategy-btn" data-strategy="evade"><i class="fas fa-running"></i> 閃避</button>
        <button class="strategy-btn" data-strategy="support"><i class="fas fa-hands-helping"></i> 輔助</button>
        <button class="strategy-btn" data-strategy="heal"><i class="fas fa-briefcase-medical"></i> 治療</button>
    `;

    skillSelectionContainer.innerHTML = `
        <div class="system-message">
            <div class="combat-empty-state">
                <i class="fas fa-compass"></i>
                <span>先選擇策略，再挑選技能與目標。</span>
            </div>
        </div>
    `;

    confirmActionContainer.innerHTML = `
        <div class="combat-target-panel">
            <div class="combat-subtitle">目標</div>
            <div id="combat-target-selection" class="combat-target-selection">
                <div class="system-message">請先選擇策略。</div>
            </div>
        </div>
        <div class="combat-summary-panel">
            <div class="combat-subtitle">行動摘要</div>
            <div id="combat-action-summary" class="combat-action-summary">請選擇策略來準備行動。</div>
            <div class="combat-command-row">
                <button id="combat-confirm-btn" class="confirm-btn" type="button" disabled>確認行動</button>
                <button id="combat-surrender-btn" class="surrender-btn" type="button">投降</button>
            </div>
        </div>
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

    const allCombatants = [updatedState.player, ...(updatedState.allies || []), ...(updatedState.enemies || [])];
    allCombatants.forEach(character => {
        if (!character) return;
        const characterName = character.name || character.username;
        const card = combatModal.querySelector(`.character-card[data-name="${escapeSelectorAttrValue(characterName)}"]`);
        if (!card) return;

        const hpBar = card.querySelector('.hp-bar-fill');
        const hpValueText = card.querySelector('.hp-bar-container .bar-value-text');
        if (hpBar && hpValueText) {
            const hp = Number(character.hp || 0);
            const maxHp = Math.max(1, Number(character.maxHp || 1));
            hpBar.style.width = `${clampCombatPercent((hp / maxHp) * 100)}%`;
            hpValueText.textContent = `${Math.max(0, hp)}`;
        }

        const mpBar = card.querySelector('.mp-bar-fill');
        const mpValueText = card.querySelector('.mp-bar-container .bar-value-text');
        if (mpBar && mpValueText && character.mp !== undefined) {
            const mp = Number(character.mp || 0);
            const maxMp = Math.max(0, Number(character.maxMp || 0));
            mpBar.style.width = `${clampCombatPercent(maxMp > 0 ? (mp / maxMp) * 100 : 0)}%`;
            mpValueText.textContent = `${Math.max(0, mp)}`;
        }

        const isDown = Number(character.hp || 0) <= 0;
        card.classList.toggle('is-down', isDown);
        const chip = card.querySelector('.character-state-chip');
        if (chip) {
            chip.textContent = isDown ? '倒下' : '可戰';
            chip.classList.toggle('danger', isDown);
        }
    });
}

export function updateCombatLog(content, className = '', options = {}) {
    const combatLog = document.getElementById('combat-log');
    if (!combatLog) return;

    const entry = document.createElement('div');
    entry.className = `combat-log-entry${className ? ` ${className}` : ''}`;

    const allowHtml = typeof options === 'boolean' ? options : !!options.allowHtml;
    if (allowHtml) {
        entry.innerHTML = String(content || '').replace(/\n/g, '<br>');
    } else {
        entry.textContent = String(content || '');
    }

    combatLog.appendChild(entry);
    combatLog.scrollTop = combatLog.scrollHeight;
}

export function setTurnCounter(turn) {
    const combatTurnCounter = document.getElementById('combat-turn-counter');
    if (!combatTurnCounter) return;
    const pill = combatTurnCounter.querySelector('.combat-turn-pill');
    if (pill) {
        pill.textContent = `第 ${turn} 回合`;
    } else {
        combatTurnCounter.textContent = `第 ${turn} 回合`;
    }
}

export function closeCombatModal() {
    const combatModal = document.getElementById('combat-modal');
    if (combatModal) combatModal.classList.remove('visible');
}
export function setCombatLoading(isLoading) {
    const combatLoader = document.getElementById('combat-loader');
    if (combatLoader) combatLoader.classList.toggle('visible', isLoading);
}


// --- ????????? ---
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
        chatNpcName.textContent = `向 ${profile.name} 打聽消息`;
        chatNpcInfo.innerHTML = `<span class="inquiry-cost-text"><i class="fas fa-coins"></i> 每次提問消耗 100 銀兩</span>`;
    } else {
        chatNpcName.textContent = `與 ${profile.name} 對話`;
        chatNpcInfo.innerHTML = profile.status_title || '';
        displayRomanceValue(profile.romanceValue);
        displayFriendlinessBar(profile.friendlinessValue);
    }

    giveItemBtn.style.display = mode === 'inquiry' ? 'none' : 'inline-flex';
    chatFooter.style.display = mode === 'inquiry' ? 'none' : 'block';
    chatLog.innerHTML = `<p class="system-message">你開始與 ${profile.name} 對話...</p>`;

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

// --- ??????????? ---
export async function openGiveItemModal(currentNpcName, giveItemCallback) {
    const giveItemModal = document.getElementById('give-item-modal');
    const giveInventoryList = document.getElementById('give-inventory-list');
    if (!giveItemModal || !giveInventoryList) return;

    giveInventoryList.innerHTML = '<p class="system-message">載入物品中...</p>';
    giveItemModal.classList.add('visible');

    try {
        const inventory = await api.getInventory();
        giveInventoryList.innerHTML = '';

        if (inventory && inventory.length > 0) {
            inventory.forEach((itemData) => {
                if (itemData.quantity <= 0) return;

                const itemName = itemData.itemName || itemData.templateId;
                const isMoney = /coin|gold|silver|money|cash/i.test(String(itemName || ''));
                const itemDiv = document.createElement('div');
                itemDiv.className = 'give-item';
                itemDiv.innerHTML = `<i class="fas ${isMoney ? 'fa-coins' : 'fa-box-open'}"></i> ${itemName} (Qty: ${itemData.quantity})`;

                itemDiv.addEventListener('click', () => {
                    if (isMoney) {
                        const amount = prompt(`請輸入要給予的金額（最多 ${itemData.quantity}）`, itemData.quantity);
                        if (amount === null) return;
                        const parsed = Number.parseInt(amount, 10);
                        if (Number.isInteger(parsed) && parsed > 0 && parsed <= itemData.quantity) {
                            giveItemCallback({ type: 'money', amount: parsed, itemName });
                        } else {
                            alert('請輸入有效的數量。');
                        }
                        return;
                    }

                    giveItemCallback({ type: 'item', itemId: itemData.instanceId, itemName });
                });

                giveInventoryList.appendChild(itemDiv);
            });
        } else {
            giveInventoryList.innerHTML = '<p class="system-message">目前沒有可給予的物品。</p>';
        }
    } catch (error) {
        console.error('Failed to load give-item inventory:', error);
        giveInventoryList.innerHTML = `<p class="system-message">載入物品失敗：${error.message}</p>`;
    }
}
export function openSkillsModal(skillsData) {
    const skillsModal = document.getElementById('skills-modal');
    const skillsTabsContainer = document.getElementById('skills-tabs-container');
    const skillsBodyContainer = document.getElementById('skills-body-container');
    if (!skillsModal || !skillsTabsContainer || !skillsBodyContainer) return;

    skillsTabsContainer.innerHTML = '';
    skillsBodyContainer.innerHTML = '';

    if (!skillsData || skillsData.length === 0) {
        skillsBodyContainer.innerHTML = '<p class="system-message">目前尚未學會任何技能。</p>';
        skillsModal.classList.add('visible');
        return;
    }

    const skillsByType = skillsData.reduce((acc, skill) => {
        const type = skill.skillType || '未分類';
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

        skillsByType[type].forEach((skill) => {
            const expToNextLevel = (skill.level + 1) * 100;
            const expPercentage = expToNextLevel > 0 ? (skill.exp / expToNextLevel) * 100 : 0;
            const translatedPowerType = powerTypeMap[skill.power_type] || '未知';

            const customTagHtml = skill.isCustom ? '<span class="skill-custom-tag">自創</span>' : '';
            const forgetButtonHtml = skill.skillName !== '基礎拳腳'
                ? `<button class="skill-forget-btn" title="遺忘此技能" data-skill-name="${skill.skillName}" data-skill-type="${skill.power_type}"><i class="fas fa-trash-alt"></i></button>`
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
                <p class="skill-description">${skill.base_description || '尚無技能描述。'}</p>
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
            skillsTabsContainer.querySelectorAll('.skill-tab').forEach((tab) => tab.classList.remove('active'));
            skillsBodyContainer.querySelectorAll('.skill-tab-content').forEach((content) => content.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(`tab-${tabName}`).classList.add('active');
        }
    };

    skillsBodyContainer.querySelectorAll('.skill-forget-btn').forEach((button) => {
        button.addEventListener('click', (e) => {
            const skillName = e.currentTarget.dataset.skillName;
            const skillType = e.currentTarget.dataset.skillType;
            handleForgetSkill(skillName, skillType);
        });
    });

    skillsModal.classList.add('visible');
}


const LOCATION_DETAIL_LABELS = {
    locationType: '類型',
    address: '地址',
    hierarchyPath: '層級路徑',
    geography: '地理',
    nearbyLocations: '附近地點',
    prosperityPotential: '繁榮潛力',
    specialty: '特產',
    history: '歷史',
    description: '描述',
    currentProsperity: '當前繁榮',
    governance: '統治資訊',
    ruler: '統治者',
    allegiance: '歸屬',
    security: '治安',
    currentIssues: '當前議題',
    facilities: '設施',
    buildings: '建築'
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPlaceholderLocationName(value) {
    const text = String(value ?? '').trim();
    if (!text) return true;
    return ['Unknown Location', 'Unknown', '\u672a\u77e5\u5730\u5340', '\u672a\u77e5'].includes(text);
}

function pickDisplayLocationName(...candidates) {
    for (const candidate of candidates) {
        const text = typeof candidate === 'string' ? candidate.trim() : '';
        if (!text) continue;
        if (isPlaceholderLocationName(text)) continue;
        return text;
    }
    return '\u672a\u77e5\u5730\u5340';
}

function formatAddressPath(address) {
    if (!isPlainObject(address)) return '';
    const preferredOrder = ['country', 'province', 'state', 'region', 'city', 'district', 'town', 'village'];
    const parts = [];
    const seen = new Set();

    preferredOrder.forEach((key) => {
        const value = typeof address[key] === 'string' ? address[key].trim() : '';
        if (!value) return;
        parts.push(value);
        seen.add(key);
    });

    Object.entries(address).forEach(([key, raw]) => {
        if (seen.has(key)) return;
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (value) parts.push(value);
    });

    return parts.join(' > ');
}

function formatPrimitiveValue(value) {
    const text = String(value ?? '').trim();
    if (!text) return 'N/A';
    return escapeHtml(text).replace(/\n/g, '<br>');
}

function formatArrayValue(value, keysToExclude) {
    if (!Array.isArray(value) || value.length === 0) return 'N/A';
    let html = '<ul class="nested-list">';
    value.forEach((item) => {
        if (isPlainObject(item)) {
            const itemName = item.name ? formatPrimitiveValue(item.name) : null;
            const itemType = item.type ? formatPrimitiveValue(item.type) : null;
            const itemTravelTime = item.travelTime ? formatPrimitiveValue(item.travelTime) : null;
            if (itemName || itemType || itemTravelTime) {
                const bits = [];
                if (itemName) bits.push(itemName);
                if (itemType) bits.push('(' + itemType + ')');
                if (itemTravelTime) bits.push('[' + itemTravelTime + ']');
                html += '<li>' + bits.join(' ') + '</li>';
            } else {
                html += '<li>' + formatObjectForDisplay(item, keysToExclude) + '</li>';
            }
            return;
        }
        html += '<li>' + formatPrimitiveValue(item) + '</li>';
    });
    html += '</ul>';
    return html;
}

function formatObjectForDisplay(obj, keysToExclude = []) {
    if (!isPlainObject(obj)) {
        return formatPrimitiveValue(obj);
    }

    let html = '<ul class="location-detail-list">';
    for (const [key, value] of Object.entries(obj)) {
        if (keysToExclude.includes(key) || value === undefined || value === null) continue;

        const displayKey = escapeHtml(LOCATION_DETAIL_LABELS[key] || key);
        let displayValue = 'N/A';
        const isNestedObject = isPlainObject(value);

        if (Array.isArray(value)) {
            displayValue = formatArrayValue(value, keysToExclude);
        } else if (isNestedObject) {
            displayValue = formatObjectForDisplay(value, keysToExclude);
        } else {
            displayValue = formatPrimitiveValue(value);
        }

        if (isNestedObject) {
            html += `<li class="nested-object"><span class="key">${displayKey}:</span><div class="value">${displayValue}</div></li>`;
        } else {
            html += `<li><span class="key">${displayKey}:</span><span class="value">${displayValue}</span></li>`;
        }
    }
    html += '</ul>';
    return html;
}

function normalizeLocationModalData(locationData) {
    const current = isPlainObject(locationData?.current) ? locationData.current : {};
    const layers = isPlainObject(locationData?.layers) ? locationData.layers : {};
    const currentStatic = isPlainObject(current.static) ? current.static : (isPlainObject(layers.currentStatic) ? layers.currentStatic : {});
    const currentDynamic = isPlainObject(current.dynamic) ? current.dynamic : (isPlainObject(layers.currentDynamic) ? layers.currentDynamic : {});
    const currentMerged = isPlainObject(current.merged) ? current.merged : (isPlainObject(layers.currentMerged) ? layers.currentMerged : (isPlainObject(locationData) ? locationData : {}));
    const inheritedMerged = isPlainObject(current.inheritedMerged) ? current.inheritedMerged : (isPlainObject(layers.inheritedMerged) ? layers.inheritedMerged : currentMerged);

    const summaryCandidate = isPlainObject(locationData?.summary)
        ? locationData.summary
        : (isPlainObject(current.summary) ? current.summary : {});

    const hierarchyNames = Array.isArray(locationData?.locationHierarchy)
        ? locationData.locationHierarchy.filter(v => typeof v === 'string' && v.trim())
        : (Array.isArray(locationData?.hierarchy) ? locationData.hierarchy.map(node => node?.locationName).filter(Boolean) : []);
    const hierarchyTail = hierarchyNames.length > 0 ? hierarchyNames[hierarchyNames.length - 1] : '';

    const mergedAddress = isPlainObject(inheritedMerged.address) ? inheritedMerged.address : (isPlainObject(currentMerged.address) ? currentMerged.address : {});
    const summary = {
        locationName: pickDisplayLocationName(
            summaryCandidate.locationName,
            currentMerged.locationName,
            currentMerged.name,
            locationData?.locationName,
            locationData?.name,
            hierarchyTail
        ),
        description: summaryCandidate.description || currentMerged.description || locationData?.description || '\u5c1a\u7121\u5730\u5340\u63cf\u8ff0\u3002',
        ruler: summaryCandidate.ruler || currentMerged.governance?.ruler || inheritedMerged.governance?.ruler || '\u672a\u77e5',
        addressPath: summaryCandidate.addressPath || formatAddressPath(mergedAddress),
        locationType: summaryCandidate.locationType || currentMerged.locationType || inheritedMerged.locationType || '\u672a\u77e5'
    };

    const mergedNearby = currentDynamic.geography?.nearbyLocations || currentMerged.geography?.nearbyLocations || currentMerged.nearbyLocations || [];

    const staticSection = {
        locationType: summary.locationType,
        address: summary.addressPath || '\u672a\u77e5',
        hierarchyPath: hierarchyNames.length ? hierarchyNames.join(' > ') : undefined,
        geography: currentStatic.geography || currentMerged.geography,
        prosperityPotential: currentStatic.economy?.prosperityPotential ?? currentMerged.economy?.prosperityPotential,
        specialty: currentStatic.economy?.specialty ?? currentMerged.economy?.specialty ?? [],
        history: currentStatic.lore?.history ?? currentMerged.lore?.history,
        nearbyLocations: mergedNearby
    };

    const dynamicSection = {
        currentProsperity: currentDynamic.economy?.currentProsperity ?? currentMerged.economy?.currentProsperity,
        governance: currentDynamic.governance || currentMerged.governance,
        currentIssues: currentDynamic.lore?.currentIssues ?? currentMerged.lore?.currentIssues ?? [],
        facilities: currentDynamic.facilities ?? currentMerged.facilities ?? [],
        buildings: currentDynamic.buildings ?? currentMerged.buildings ?? []
    };

    return { summary, staticSection, dynamicSection };
}

export function openLocationDetailsModal(locationData) {
    if (!dom.locationDetailsModal || !locationData) return;

    const { summary, staticSection, dynamicSection } = normalizeLocationModalData(locationData);
    dom.locationModalTitle.textContent = summary.locationName || '\u5730\u5340\u8a73\u60c5';

    let bodyHtml = '';
    bodyHtml += `<div class="location-section"><h4><i class="fas fa-compass"></i> 地區摘要</h4>${formatObjectForDisplay({
        locationType: summary.locationType,
        address: summary.addressPath || '未知',
        ruler: summary.ruler,
        description: summary.description
    })}</div>`;
    bodyHtml += `<div class="location-section"><h4><i class="fas fa-landmark"></i> 靜態情報（世界設定）</h4>${formatObjectForDisplay(staticSection)}</div>`;
    bodyHtml += `<div class="location-section"><h4><i class="fas fa-users"></i> 動態情報（當前狀態）</h4>${formatObjectForDisplay(dynamicSection)}</div>`;

    dom.locationModalBody.innerHTML = bodyHtml;
    dom.locationDetailsModal.classList.add('visible');
}

export function closeLocationDetailsModal() {
    if(dom.locationDetailsModal) dom.locationDetailsModal.classList.remove('visible');
}
