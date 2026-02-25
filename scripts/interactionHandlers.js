// scripts/interactionHandlers.js

import { api } from './api.js';
import { gameState } from './gameState.js';
import * as modal from './modalManager.js';
import { updateUI, appendMessageToStory, addRoundTitleToStory, handleApiError, updateMoneyBagDisplay } from './uiUpdater.js';
import { dom } from './dom.js';

let gameLoop = {};

const COMBAT_STRATEGY_LABELS = {
    attack: '???',
    defend: '????',
    evade: '閃避',
    support: '輔助',
    heal: '?鞊??'
};

const COMBAT_CATEGORY_MAP = {
    attack: '???',
    defend: '????',
    evade: '閃避',
    support: '輔助',
    heal: '?鞊??'
};

const SELF_TARGET_STRATEGIES = new Set(['defend', 'evade']);

function syncSilverBalanceToInventory(newBalance) {
    if (!gameState.roundData) return;
    if (!Array.isArray(gameState.roundData.inventory)) {
        gameState.roundData.inventory = [];
    }

    const numericBalance = Number(newBalance);
    if (!Number.isFinite(numericBalance) || numericBalance < 0) return;

    const silverIndex = gameState.roundData.inventory.findIndex(item => item && (item.templateId === '\u9280\u5169' || item.itemName === '\u9280\u5169'));
    if (silverIndex >= 0) {
        gameState.roundData.inventory[silverIndex] = {
            ...gameState.roundData.inventory[silverIndex],
            quantity: numericBalance
        };
        return;
    }

    gameState.roundData.inventory.push({
        instanceId: 'currency-silver-liang',
        templateId: '\u9280\u5169',
        itemName: '\u9280\u5169',
        quantity: numericBalance,
        itemType: '\u8ca1\u5bf6',
        category: '\u8ca8\u5e63'
    });
}


// --- Helper Functions (Internal to this module) ---

function showNpcInteractionMenu(targetElement, npcProfile, isDeceased = false) {
    const disabledAttr = isDeceased ? 'disabled' : '';
    const npcName = npcProfile.name;

    let avatarHtml = '';
    // ??朵???NPC ??????頦????? URL
    if (npcProfile.avatarUrl) {
        // ????????頩溝??謅?鞊堊?????
        avatarHtml = `<div class="npc-interaction-avatar-container">
                        <div class="npc-interaction-avatar" style="background-image: url('${npcProfile.avatarUrl}')"></div>
                      </div>`;
    } else {
        // ?????鞊???雓???雓???? "??????" ???
        avatarHtml = `<div class="npc-interaction-avatar-container">
                        <button class="npc-generate-avatar-btn" data-npc-name="${npcName}" ${disabledAttr}>
                            <i class="fas fa-camera-retro"></i>
                            <span>??????</span>
                        </button>
                      </div>`;
    }

    dom.npcInteractionMenu.innerHTML = `
        ${avatarHtml}
        <div class="npc-interaction-buttons">
            <button class="npc-interaction-btn trade" data-npc-name="${npcName}" ${disabledAttr}><i class="fas fa-exchange-alt"></i> ????</button>
            <button class="npc-interaction-btn chat" data-npc-name="${npcName}" ${disabledAttr}><i class="fas fa-comments"></i> ?????/button>
            <button class="npc-interaction-btn attack" data-npc-name="${npcName}" ${disabledAttr}><i class="fas fa-khanda"></i> ???</button>
        </div>
    `;
    
    // ????????????豱???
    if (!isDeceased) {
        // ??"??????" ????????????????
        const generateBtn = dom.npcInteractionMenu.querySelector('.npc-generate-avatar-btn');
        if (generateBtn) {
            generateBtn.addEventListener('click', handleGenerateAvatarClick);
        }
        dom.npcInteractionMenu.querySelector('.trade').addEventListener('click', handleTradeButtonClick);
        dom.npcInteractionMenu.querySelector('.chat').addEventListener('click', handleChatButtonClick);
        dom.npcInteractionMenu.querySelector('.attack').addEventListener('click', showAttackIntention);
    }

    // --- (??祈?????雓????怏??????雓ａ???鞊堊????鞊??) ---
    const menuRect = dom.npcInteractionMenu.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const panelRect = dom.storyPanel.getBoundingClientRect();

    let top = targetRect.bottom - panelRect.top + dom.storyPanel.scrollTop + 8;
    let left = targetRect.left - panelRect.left + (targetRect.width / 2) - (menuRect.width / 2);

    if (top + menuRect.height > dom.storyPanel.scrollHeight) {
        top = targetRect.top - panelRect.top + dom.storyPanel.scrollTop - menuRect.height - 8;
    }

    const rightEdge = left + menuRect.width;
    if (rightEdge > panelRect.width) {
        left = panelRect.width - menuRect.width - 5; 
    }
    if (left < 0) {
        left = 5;
    }

    dom.npcInteractionMenu.style.top = `${top}px`;
    dom.npcInteractionMenu.style.left = `${left}px`;
    dom.npcInteractionMenu.classList.add('visible');
}

async function handleGenerateAvatarClick(event) {
    event.stopPropagation();
    const npcName = event.currentTarget.dataset.npcName;
    if (!npcName || gameState.isRequesting) return;

    const btn = event.currentTarget;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i><span>??頩??雓?????1????雓????????????.</span>`;
    btn.disabled = true;
    
    try {
        const result = await api.generateNpcAvatar(npcName);
        if (result.success && result.avatarUrl) {
            // ??????????????????
            const avatarContainer = btn.parentElement;
            avatarContainer.innerHTML = `<div class="npc-interaction-avatar" style="background-image: url('${result.avatarUrl}')"></div>`;
            // ???蝞??????????????????豯????
            appendMessageToStory(`已為 ${npcName} 生成頭像。`, 'system-message');
        } else {
            throw new Error(result.message || '頭像生成失敗。');
        }
    } catch (error) {
        handleApiError(error);
        // ??????祈????????
        btn.innerHTML = `<i class="fas fa-camera-retro"></i><span>??????</span>`;
        btn.disabled = false;
    }
}


function showAttackIntention(event) {
    event.stopPropagation();
    const npcName = event.currentTarget.dataset.npcName;
    const buttonContainer = dom.npcInteractionMenu.querySelector('.npc-interaction-buttons');
    if (buttonContainer) {
        buttonContainer.innerHTML = `
            <button class="npc-interaction-btn intention" data-intention="切磋" data-npc-name="${npcName}">切磋</button>
            <button class="npc-interaction-btn intention" data-intention="教訓" data-npc-name="${npcName}">教訓</button>
            <button class="npc-interaction-btn intention attack" data-intention="打死" data-npc-name="${npcName}">打死</button>
        `;
        buttonContainer.querySelectorAll('.intention').forEach(btn => {
            btn.addEventListener('click', showFinalConfirmation);
        });
    }
}

function showFinalConfirmation(event) {
    event.stopPropagation();
    const npcName = event.currentTarget.dataset.npcName;
    const intention = event.currentTarget.dataset.intention;
    
    const buttonContainer = dom.npcInteractionMenu.querySelector('.npc-interaction-buttons');
    if (buttonContainer) {
        buttonContainer.innerHTML = `
            <span class="confirm-prompt-text">確定要對 ${npcName} 採取「${intention}」嗎？</span>
            <button class="npc-interaction-btn cancel-attack" data-npc-name="${npcName}" title="取消"><i class="fas fa-times"></i></button>
            <button class="npc-interaction-btn confirm-attack" data-npc-name="${npcName}" data-intention="${intention}" title="確認"><i class="fas fa-check"></i></button>
        `;

        buttonContainer.querySelector('.cancel-attack').addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const profile = await api.getNpcProfile(npcName);
                const originalTarget = document.querySelector(`.npc-name[data-npc-name="${npcName}"]`);
                if (originalTarget && profile) {
                    const isDeceased = originalTarget.dataset.isDeceased === 'true';
                    showNpcInteractionMenu(originalTarget, profile, isDeceased);
                } else {
                    hideNpcInteractionMenu();
                }
            } catch (error) {
                handleApiError(error);
                hideNpcInteractionMenu();
            }
        });
        buttonContainer.querySelector('.confirm-attack').addEventListener('click', confirmAndInitiateAttack);
    }
}


async function endCombat() {
    gameState.isInCombat = false;
    gameState.combat.state = null;
    gameState.combat.selectedStrategy = null;
    gameState.combat.selectedSkill = null;
    gameState.combat.selectedPowerLevel = null;
    gameState.combat.selectedTarget = null;
    modal.closeCombatModal();

    gameLoop.setLoading(true, '??雓?豰??????????...');

    try {
        const data = await api.finalizeCombat({ model: dom.aiModelSelector.value });
        gameLoop.processNewRoundData(data);
    } catch (error) {
        handleApiError(error);
    } finally {
        if (!document.getElementById('epilogue-modal').classList.contains('visible')) {
            gameLoop.setLoading(false);
        }
    }
}

async function handleTradeButtonClick(event) {
    event.stopPropagation();
    const npcName = event.currentTarget.dataset.npcName;
    
    hideNpcInteractionMenu();
    if (gameState.isRequesting) return;
    gameLoop.setLoading(true, `?????${npcName} ?鞊臬???????...`);
    try {
        const tradeData = await api.startTrade(npcName);
        
        const onTradeComplete = (newRound) => {
            modal.closeTradeModal(); 
            if (newRound && newRound.roundData) {
                addRoundTitleToStory(newRound.roundData.EVT || (`第${newRound.roundData.R}回合`));
                updateUI(newRound.story, newRound.roundData, null, newRound.locationData);
                gameState.currentRound = newRound.roundData.R;
                gameState.roundData = newRound.roundData;
            }
        };

        modal.openTradeModal(tradeData, npcName, onTradeComplete, modal.closeTradeModal);

    } catch (error) {
        console.error("?????????秋鬲????抬????", error);
        handleApiError(error);
    } finally {
        gameLoop.setLoading(false);
    }
}

async function handleChatButtonClick(event) {
    event.stopPropagation();
    const npcName = event.currentTarget.dataset.npcName;
    hideNpcInteractionMenu();
    if (gameState.isRequesting) return;
    gameLoop.setLoading(true, '??????????頠??雓帖???...');
    try {
        const profile = await api.getNpcProfile(npcName);
        gameState.isInChat = true;
        gameState.currentChatNpc = profile.name;
        gameState.chatHistory = [];
        modal.openChatModalUI(profile, 'chat'); 
        dom.chatInput.focus();
    } catch (error) {
        if (error.message && error.message.includes('?鞊?????鞊?')) {
            appendMessageToStory(error.message, 'system-message');
        } else {
            handleApiError(error);
        }
    } finally {
        gameLoop.setLoading(false);
    }
}

async function confirmAndInitiateAttack(event) {
    event.stopPropagation();
    const npcName = event.currentTarget.dataset.npcName;
    const intention = event.currentTarget.dataset.intention;
    hideNpcInteractionMenu();
    if (gameState.isRequesting) return;

    gameLoop.setLoading(true, `正在對 ${npcName} 發起動手...`);
    try {
        const data = await api.initiateCombat({
            targetNpcName: npcName,
            intention
        });
        if (data.status === 'COMBAT_START') {
            startCombat(data.initialState);
        }
    } catch (error) {
        handleApiError(error);
    } finally {
        if (!gameState.isInCombat) {
            gameLoop.setLoading(false);
        }
    }
}

function getRelevantCombatSkills(strategy) {
    const targetCategory = COMBAT_CATEGORY_MAP[strategy];
    const playerSkills = gameState.combat.state?.player?.skills || [];
    return playerSkills.filter(skill => {
        const category = skill?.combatCategory;
        if (!targetCategory) return false;
        return category === targetCategory || category === strategy;
    });
}

function getCombatTargetCandidates(strategy) {
    const state = gameState.combat.state || {};
    const playerName = state.player?.username;
    const allies = (state.allies || []).filter(ally => Number(ally?.hp || 0) > 0).map(ally => ({ name: ally.name, side: 'ally' }));
    const enemies = (state.enemies || []).filter(enemy => Number(enemy?.hp || 0) > 0).map(enemy => ({ name: enemy.name, side: 'enemy' }));

    if (!strategy) return [];
    if (SELF_TARGET_STRATEGIES.has(strategy)) {
        return playerName ? [{ name: playerName, side: 'player' }] : [];
    }
    if (strategy === 'attack') return enemies;
    if (strategy === 'heal' || strategy === 'support') {
        const self = playerName ? [{ name: playerName, side: 'player' }] : [];
        return [...self, ...allies];
    }
    return [];
}

function getCombatTargetHint(strategy) {
    if (strategy === 'attack') return '????蝘?????????';
    if (strategy === 'heal') return '????豲??????謅???????領?';
    if (strategy === 'support') return '????????????謅???????領?';
    if (strategy === 'defend') return '防禦會以自身為目標。';
    if (strategy === 'evade') return '閃避會以自身為目標。';
    return '請選擇目標。';
}

function renderCombatTargetSelection(strategy) {
    const targetContainer = document.getElementById('combat-target-selection');
    if (!targetContainer) return;

    const targets = getCombatTargetCandidates(strategy);
    targetContainer.innerHTML = '';

    if (!strategy) {
        targetContainer.innerHTML = '<div class="system-message">?嚚???????氯??/div>';
        return;
    }

    if (targets.length === 0) {
        targetContainer.innerHTML = `<div class="system-message">${getCombatTargetHint(strategy)}</div>`;
        gameState.combat.selectedTarget = null;
        return;
    }

    const hint = document.createElement('div');
    hint.className = 'combat-target-hint';
    hint.textContent = getCombatTargetHint(strategy);
    targetContainer.appendChild(hint);

    const list = document.createElement('div');
    list.className = 'combat-target-list';
    const targetNames = new Set(targets.map(target => target.name));
    if (!targetNames.has(gameState.combat.selectedTarget)) {
        gameState.combat.selectedTarget = targets[0].name;
    }

    targets.forEach(target => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `combat-target-btn side-${target.side}`;
        btn.dataset.targetName = target.name;
        btn.dataset.targetSide = target.side;
        btn.innerHTML = `
            <span class="combat-target-name">${target.name}</span>
            <span class="combat-target-side">${target.side === 'enemy' ? '??謚?' : (target.side === 'ally' ? '??撖?' : '??鞊?')}</span>
        `;
        if (target.name === gameState.combat.selectedTarget) {
            btn.classList.add('selected');
        }
        btn.addEventListener('click', () => {
            gameState.combat.selectedTarget = target.name;
            renderCombatTargetSelection(strategy);
            updateCombatActionSummary();
            updateCombatConfirmState();
        });
        list.appendChild(btn);
    });

    targetContainer.appendChild(list);
}

function updateCombatActionSummary() {
    const summaryEl = document.getElementById('combat-action-summary');
    if (!summaryEl) return;

    const strategy = gameState.combat.selectedStrategy;
    if (!strategy) {
        summaryEl.textContent = '請先選擇策略。';
        return;
    }

    const skillText = gameState.combat.selectedSkill ? ('技能：' + String(gameState.combat.selectedSkill)) : '技能：未選擇';
    const powerText = gameState.combat.selectedSkill ? ('成數：' + String(gameState.combat.selectedPowerLevel || 1)) : '成數：—';
    const targetText = gameState.combat.selectedTarget ? ('目標：' + String(gameState.combat.selectedTarget)) : '目標：未選擇';
    summaryEl.innerHTML = `
        <span class="summary-chip strategy">${COMBAT_STRATEGY_LABELS[strategy] || strategy}</span>
        <span class="summary-chip">${targetText}</span>
        <span class="summary-chip">${skillText}</span>
        <span class="summary-chip">${powerText}</span>
    `;
}

function updateCombatConfirmState() {
    const confirmBtn = document.getElementById('combat-confirm-btn');
    if (!confirmBtn) return;

    const strategy = gameState.combat.selectedStrategy;
    if (!strategy) {
        confirmBtn.disabled = true;
        return;
    }

    const targetCandidates = getCombatTargetCandidates(strategy);
    const requiresTarget = targetCandidates.length > 0;
    const hasTarget = !requiresTarget || targetCandidates.some(target => target.name === gameState.combat.selectedTarget);

    let hasEnoughMp = true;
    if (gameState.combat.selectedSkill) {
        const playerSkills = gameState.combat.state?.player?.skills || [];
        const skill = playerSkills.find(entry => entry.skillName === gameState.combat.selectedSkill);
        if (skill) {
            const powerLevel = Number(gameState.combat.selectedPowerLevel || 1);
            const totalCost = Number(skill.cost || 5) * powerLevel;
            hasEnoughMp = totalCost <= Number(gameState.combat.state?.player?.mp || 0);
        }
    }

    confirmBtn.disabled = !hasTarget || !hasEnoughMp;
}

function resetCombatActionComposer() {
    gameState.combat.selectedStrategy = null;
    gameState.combat.selectedSkill = null;
    gameState.combat.selectedPowerLevel = null;
    gameState.combat.selectedTarget = null;

    document.querySelectorAll('.strategy-btn.selected, .skill-controls.selected').forEach(el => el.classList.remove('selected'));

    const skillSelection = document.getElementById('skill-selection');
    if (skillSelection) {
        skillSelection.innerHTML = `
            <div class="system-message">
                <div class="combat-empty-state">
                    <i class="fas fa-compass"></i>
                    <span>????????????謢瘀???雓▽?雓??頩??謢遴?????綜敢??/span>
                </div>
            </div>
        `;
    }

    const targetSelection = document.getElementById('combat-target-selection');
    if (targetSelection) {
        targetSelection.innerHTML = '<div class="system-message">?嚚???????氯??/div>';
    }

    const summaryEl = document.getElementById('combat-action-summary');
    if (summaryEl) {
        summaryEl.textContent = 'Choose an action to prepare.';
    }

    updateCombatConfirmState();
}

function startCombat(initialState) {
    gameState.isInCombat = true;
    gameState.combat.state = initialState;
    gameState.combat.selectedStrategy = null;
    gameState.combat.selectedSkill = null;
    gameState.combat.selectedPowerLevel = null;
    gameState.combat.selectedTarget = null;

    const cancelCombat = () => {
        gameState.isInCombat = false;
        gameState.combat.state = null;
        gameState.combat.selectedStrategy = null;
        gameState.combat.selectedSkill = null;
        gameState.combat.selectedPowerLevel = null;
        gameState.combat.selectedTarget = null;
        gameLoop.setLoading(false);
    };

    modal.openCombatModal(initialState, cancelCombat);

    document.querySelectorAll('.strategy-btn').forEach(btn => {
        btn.addEventListener('click', () => handleStrategySelection(btn.dataset.strategy));
    });

    const surrenderBtn = document.getElementById('combat-surrender-btn');
    if (surrenderBtn) surrenderBtn.addEventListener('click', handleCombatSurrender);

    resetCombatActionComposer();
}

function handleStrategySelection(strategy) {
    gameState.combat.selectedStrategy = strategy;
    gameState.combat.selectedSkill = null;
    gameState.combat.selectedPowerLevel = 1;

    document.querySelectorAll('.strategy-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.strategy === strategy);
    });

    renderCombatTargetSelection(strategy);
    updateCombatActionSummary();

    const skillSelectionContainer = document.getElementById('skill-selection');
    if (!skillSelectionContainer) return;
    skillSelectionContainer.innerHTML = '';

    const playerSkills = gameState.combat.state?.player?.skills || [];
    const currentWeaponType = gameState.combat.state?.player?.currentWeaponType ?? null;
    const relevantSkills = getRelevantCombatSkills(strategy);

    const helper = document.createElement('div');
    helper.className = 'combat-skill-header';
    helper.textContent = relevantSkills.length > 0 ? '請選擇技能與成數。' : ('目前沒有可用於此策略的技能：' + String(COMBAT_STRATEGY_LABELS[strategy] || strategy));
    skillSelectionContainer.appendChild(helper);

    if (relevantSkills.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'system-message';
        empty.textContent = playerSkills.length === 0 ? '目前沒有可用的戰鬥技能。' : '所選策略沒有相容技能。';
        skillSelectionContainer.appendChild(empty);
        updateCombatConfirmState();
        return;
    }

    relevantSkills.forEach(skill => {
        const requiredWeapon = skill.requiredWeaponType;
        const skillLevel = Math.max(1, Number(skill.level || 1));
        const baseCost = Math.max(0, Number(skill.cost || 5));
        const isUsable =
            (requiredWeapon && requiredWeapon !== '\u7121' && requiredWeapon !== 'none' && requiredWeapon === currentWeaponType) ||
            ((requiredWeapon === '\u7121' || requiredWeapon === 'none') && currentWeaponType === null) ||
            (!requiredWeapon);

        const skillControl = document.createElement('div');
        skillControl.className = `skill-controls${isUsable ? '' : ' disabled'}`;
        skillControl.dataset.skillName = skill.skillName;
        skillControl.innerHTML = `
            <button class="skill-btn" type="button" ${isUsable ? '' : 'disabled'}>
                <span class="skill-name">${skill.skillName} (L${skillLevel})</span>
                ${requiredWeapon ? `<span class="weapon-status ${isUsable ? 'equipped' : 'missing'}">${isUsable ? '可用' : ('需：' + requiredWeapon)}</span>` : ''}
                <span class="skill-cost" data-base-cost="${baseCost}">??? ${baseCost}</span>
            </button>
            <div class="power-level-adjuster">
                <input type="range" class="power-level-slider" min="1" max="${skillLevel}" value="1" step="1" ${isUsable ? '' : 'disabled'}>
                <span class="power-level-display">1 ??/span>
            </div>
        `;

        if (isUsable) {
            skillControl.querySelector('.skill-btn').addEventListener('click', () => handleSkillSelection(skill.skillName));
            const slider = skillControl.querySelector('.power-level-slider');
            slider.addEventListener('input', () => {
                const powerLevel = Number(slider.value || 1);
                const totalCost = baseCost * powerLevel;
                const currentMp = Number(gameState.combat.state?.player?.mp || 0);
                const costSpan = skillControl.querySelector('.skill-cost');
                const powerDisplay = skillControl.querySelector('.power-level-display');

                powerDisplay.textContent = `${powerLevel} 成`;
                costSpan.textContent = `??? ${totalCost}`;
                costSpan.style.color = totalCost > currentMp ? '#dc3545' : '';

                if (gameState.combat.selectedSkill === skill.skillName) {
                    gameState.combat.selectedPowerLevel = powerLevel;
                    updateCombatActionSummary();
                    updateCombatConfirmState();
                }
            });
        }

        skillSelectionContainer.appendChild(skillControl);
    });

    updateCombatConfirmState();
}

function handleSkillSelection(skillName) {
    const controls = document.querySelectorAll('.skill-controls');

    if (gameState.combat.selectedSkill === skillName) {
        gameState.combat.selectedSkill = null;
        gameState.combat.selectedPowerLevel = null;
        controls.forEach(control => {
            if (control.dataset.skillName === skillName) control.classList.remove('selected');
        });
        updateCombatActionSummary();
        updateCombatConfirmState();
        return;
    }

    gameState.combat.selectedSkill = skillName;
    gameState.combat.selectedPowerLevel = 1;

    controls.forEach(control => {
        const isSelected = control.dataset.skillName === skillName;
        control.classList.toggle('selected', isSelected);
        const slider = control.querySelector('.power-level-slider');
        const display = control.querySelector('.power-level-display');
        const costSpan = control.querySelector('.skill-cost');
        const baseCost = Number(costSpan?.dataset.baseCost || 5);

        if (isSelected) {
            if (slider) slider.value = '1';
            if (display) display.textContent = '1 成';
            if (costSpan) {
                costSpan.textContent = `??? ${baseCost}`;
                costSpan.style.color = '';
            }
        }
    });

    updateCombatActionSummary();
    updateCombatConfirmState();
}

async function handleBeggarInquiry(npcName, npcProfile) {
    hideNpcInteractionMenu();
    if (gameState.isRequesting) return;
    
    gameState.isInChat = true;
    gameState.currentChatNpc = npcName;
    gameState.chatHistory = [];
    
    modal.openChatModalUI(npcProfile, 'inquiry'); 
    modal.appendChatMessage('npc', "????????????鞊荒???????雓????????????????00?????");
    dom.chatInput.focus();
}


// --- Exported Functions ---

export function setGameLoop(loop) {
    gameLoop = loop;
}

export function hideNpcInteractionMenu() {
    if (dom.npcInteractionMenu) {
        dom.npcInteractionMenu.classList.remove('visible');
        dom.npcInteractionMenu.innerHTML = '';
    }
}

export async function handleNpcClick(event) {
    const targetIsNpc = event.target.closest('.npc-name');
    const targetIsMenu = event.target.closest('.npc-interaction-menu');

    if (!targetIsNpc && !targetIsMenu) {
        hideNpcInteractionMenu();
        return;
    }

    if (targetIsNpc) {
        event.stopPropagation();
        const npcName = targetIsNpc.dataset.npcName;
        const isDeceased = targetIsNpc.dataset.isDeceased === 'true';

        const localNpcData = gameState.roundData?.NPC?.find(npc => npc.name === npcName);

        if (localNpcData && (localNpcData.status_title === '?鞊???????' || localNpcData.isTemp)) {
            await handleBeggarInquiry(npcName, localNpcData);
        } else {
            try {
                targetIsNpc.style.cursor = 'wait';
                hideNpcInteractionMenu();
                const profile = await api.getNpcProfile(npcName);
                targetIsNpc.style.cursor = 'pointer';

                if (profile.status_title === '?鞊???????') {
                    await handleBeggarInquiry(npcName, profile);
                } else {
                    showNpcInteractionMenu(targetIsNpc, profile, isDeceased);
                }
            } catch (error) {
                targetIsNpc.style.cursor = 'pointer';
                handleApiError(error);
            }
        }
    }
}

export async function sendChatMessage() {
    const message = dom.chatInput.value.trim();
    if (!message || gameState.isRequesting || dom.chatActionBtn.disabled) return;
    dom.chatInput.value = '';
    modal.appendChatMessage('player', message);
    gameLoop.setLoading(true);

    try {
        const chatMode = dom.chatModal.dataset.mode || 'chat';
        let data;

        if (chatMode === 'inquiry') {
            try {
                const paymentResult = await api.startBeggarInquiry();
                if (gameState.roundData) {
                    syncSilverBalanceToInventory(paymentResult.newBalance);
                    updateMoneyBagDisplay(gameState.roundData.inventory);
                }
            } catch (error) {
                if (error.message.includes('not enough') || error.message.includes('不足')) {
                    modal.appendChatMessage('npc', '??銵???雓????剜迫????????????????????謜????..');
                    dom.chatActionBtn.disabled = true;
                    return; 
                } else {
                    throw error; 
                }
            }
            
            data = await api.askBeggarQuestion({
                beggarName: gameState.currentChatNpc,
                userQuery: message,
                model: dom.aiModelSelector.value
            });
            modal.appendChatMessage('npc', data.response);

        } else {
            gameState.chatHistory.push({ speaker: 'player', message: message });
            data = await api.npcChat({
                npcName: gameState.currentChatNpc,
                chatHistory: gameState.chatHistory,
                playerMessage: message,
                model: dom.aiModelSelector.value
            });
            modal.appendChatMessage('npc', data.npcMessage);
            gameState.chatHistory.push({ speaker: 'npc', message: data.npcMessage });
        }
    } catch (error) {
        modal.appendChatMessage('system', `[?鞈??????: ${error.message}]`);
    } finally {
        gameLoop.setLoading(false);
    }
}

export async function endChatSession() {
    if (gameState.isRequesting || !gameState.currentChatNpc) return;
    
    const chatMode = dom.chatModal.dataset.mode || 'chat';
    if (chatMode === 'inquiry') {
        modal.closeChatModal();
        gameState.isInChat = false; 
        gameState.currentChatNpc = null;
        gameState.chatHistory = [];
        return;
    }

    const npcNameToSummarize = gameState.currentChatNpc;
    
    modal.closeChatModal();
    gameState.isInChat = false; 
    gameLoop.setLoading(true, '????鞊堊????頩????????????鞊船?????..');

    try {
        const data = await api.endChat({
            npcName: npcNameToSummarize,
            fullChatHistory: gameState.chatHistory,
            model: dom.aiModelSelector.value
        });
        if (data && data.roundData && typeof data.roundData.R !== 'undefined') {
            appendMessageToStory(`已結束與 ${npcNameToSummarize} 的對話。`, 'system-message');
            gameLoop.processNewRoundData(data);
        } else {
            throw new Error('結束對話回應格式無效。');
        }
    } catch (error) {
        handleApiError(error);
    } finally {
        gameState.currentChatNpc = null;
        gameState.chatHistory = [];
        gameLoop.setLoading(false);
    }
}

export async function handleGiveItem(giveData) {
    modal.closeGiveItemModal(); 
    modal.closeChatModal(); 
    gameState.isInChat = false;
    gameLoop.setLoading(true, "?????豲???雓??????..."); 

    try {
        const body = {
            giveData: {
                target: gameState.currentChatNpc,
                ...giveData
            },
            model: dom.aiModelSelector.value
        };
        const data = await api.giveItemToNpc(body);
        if (data && data.roundData) {
            gameLoop.processNewRoundData(data);
        } else {
            throw new Error('給予物品回應格式無效。');
        }
    } catch (error) {
        handleApiError(error); 
    } finally {
        gameState.currentChatNpc = null;
        gameState.chatHistory = [];
        gameLoop.setLoading(false); 
    }
}

export async function handleCombatSurrender() {
    if (!gameState.isInCombat || gameState.isRequesting) return;
    if (!window.confirm('確定要投降並結束戰鬥嗎？')) return;

    gameLoop.setLoading(true, '??雓?雓高??甇???..');

    try {
        const data = await api.combatSurrender({ model: dom.aiModelSelector.value });

        if (data.status === 'SURRENDER_ACCEPTED') {
            modal.updateCombatLog(data.narrative || '投降成功。', 'system-message');
            setTimeout(() => {
                gameState.isInCombat = false;
                gameState.combat.state = null;
                gameState.combat.selectedStrategy = null;
                gameState.combat.selectedSkill = null;
                gameState.combat.selectedPowerLevel = null;
                gameState.combat.selectedTarget = null;
                modal.closeCombatModal();
                gameLoop.processNewRoundData(data.newRound);
                gameLoop.setLoading(false);
            }, 1200);
        } else {
            modal.updateCombatLog(data.narrative || '投降失敗。', 'system-message');
            gameLoop.setLoading(false);
        }
    } catch (error) {
        modal.updateCombatLog(`[?賹??荒鳥 ?甇???佗?????{error.message}`, 'system-message');
        gameLoop.setLoading(false);
    }
}

export async function handleConfirmCombatAction() {
    if (!gameState.combat.selectedStrategy) {
        alert('請先選擇戰鬥策略。');
        return;
    }

    const targets = getCombatTargetCandidates(gameState.combat.selectedStrategy);
    if (targets.length > 0 && !targets.some(target => target.name === gameState.combat.selectedTarget)) {
        alert('請選擇有效目標。');
        return;
    }

    const relevantSkills = getRelevantCombatSkills(gameState.combat.selectedStrategy);
    if (relevantSkills.length > 0 && !gameState.combat.selectedSkill && gameState.combat.selectedStrategy !== 'defend' && gameState.combat.selectedStrategy !== 'evade') {
        if (!window.confirm('??軋???????????????擳??????甇????鞈???????游??')) {
            return;
        }
    }

    gameLoop.setLoading(true);

    try {
        const combatActionPayload = {
            strategy: gameState.combat.selectedStrategy,
            skill: gameState.combat.selectedSkill,
            powerLevel: gameState.combat.selectedPowerLevel || 1,
            target: gameState.combat.selectedTarget,
            model: dom.aiModelSelector.value
        };

        const data = await api.combatAction(combatActionPayload);

        modal.setTurnCounter(data.updatedState.turn);
        modal.updateCombatLog(data.narrative);
        modal.updateCombatUI(data.updatedState);
        gameState.combat.state = data.updatedState;

        if (data.status === 'COMBAT_END') {
            setTimeout(() => endCombat(), 1200);
        } else {
            resetCombatActionComposer();
            gameLoop.setLoading(false);
        }
    } catch (error) {
        modal.updateCombatLog(`[?賹??荒鳥 ?????雓???璈??謜???????{error.message}`, 'system-message');
        gameLoop.setLoading(false);
    }
}
