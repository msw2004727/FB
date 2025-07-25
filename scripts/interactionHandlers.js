// scripts/interactionHandlers.js

import { api } from './api.js';
import { gameState } from './gameState.js';
import * as modal from './modalManager.js';
import { updateUI, appendMessageToStory, addRoundTitleToStory, handleApiError } from './uiUpdater.js';
import { dom } from './dom.js';

let gameLoop = {};

// --- Helper Functions (Internal to this module) ---

function showNpcInteractionMenu(targetElement, npcProfile, isDeceased = false) {
    const disabledAttr = isDeceased ? 'disabled' : '';
    const npcName = npcProfile.name;

    // 【核心修改】在頭像外層新增一個滿版的容器 (avatar-container)
    let avatarHtml = '';
    if (npcProfile.avatarUrl) {
        avatarHtml = `<div class="npc-interaction-avatar-container"><div class="npc-interaction-avatar" style="background-image: url('${npcProfile.avatarUrl}')"></div></div>`;
    } else {
        const placeholder = npcName.charAt(0);
        avatarHtml = `<div class="npc-interaction-avatar-container"><div class="npc-interaction-avatar"><span class="npc-interaction-avatar-placeholder">${placeholder}</span></div></div>`;
    }

    dom.npcInteractionMenu.innerHTML = `
        ${avatarHtml}
        <div class="npc-interaction-buttons">
            <button class="npc-interaction-btn trade" data-npc-name="${npcName}" ${disabledAttr}><i class="fas fa-exchange-alt"></i> 交易</button>
            <button class="npc-interaction-btn chat" data-npc-name="${npcName}" ${disabledAttr}><i class="fas fa-comments"></i> 聊天</button>
            <button class="npc-interaction-btn attack" data-npc-name="${npcName}" ${disabledAttr}><i class="fas fa-khanda"></i> 動手</button>
        </div>
    `;
    
    if (!isDeceased) {
        dom.npcInteractionMenu.querySelector('.trade').addEventListener('click', handleTradeButtonClick);
        dom.npcInteractionMenu.querySelector('.chat').addEventListener('click', handleChatButtonClick);
        dom.npcInteractionMenu.querySelector('.attack').addEventListener('click', showAttackIntention);
    }

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
            <span class="confirm-prompt-text">確定要「${intention}」？</span>
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


async function endCombat(combatResult) {
    gameState.isInCombat = false;
    modal.closeCombatModal();

    if (!combatResult) {
        gameLoop.setLoading(false);
        return;
    }

    gameLoop.setLoading(true, "正在結算戰鬥結果...");

    try {
        const data = await api.finalizeCombat({
            combatResult: combatResult,
            model: dom.aiModelSelector.value
        });
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
    gameLoop.setLoading(true, `正在與 ${npcName} 準備交易...`);
    try {
        const tradeData = await api.startTrade(npcName);
        
        const onTradeComplete = (newRound) => {
            modal.closeTradeModal(); 
            if (newRound && newRound.roundData) {
                addRoundTitleToStory(newRound.roundData.EVT || `第 ${newRound.roundData.R} 回`);
                updateUI(newRound.story, newRound.roundData, null, newRound.locationData);
                gameState.currentRound = newRound.roundData.R;
                gameState.roundData = newRound.roundData;
            }
        };

        modal.openTradeModal(tradeData, npcName, onTradeComplete, modal.closeTradeModal);

    } catch (error) {
        console.error("處理交易點擊時出錯:", error);
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
    gameLoop.setLoading(true, '正在查找此人檔案...');
    try {
        const profile = await api.getNpcProfile(npcName);
        gameState.isInChat = true;
        gameState.currentChatNpc = profile.name;
        gameState.chatHistory = [];
        modal.openChatModalUI(profile, 'chat'); 
        dom.chatInput.focus();
    } catch (error) {
        if (error.message && error.message.includes('並未見到')) {
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
    
    gameLoop.setLoading(true, `準備與 ${npcName} 對決...`);
    try {
        const data = await api.initiateCombat({ 
            targetNpcName: npcName, 
            intention: intention
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

function startCombat(initialState) {
    gameState.isInCombat = true;
    gameState.combat.state = initialState;
    
    const cancelCombat = () => {
        gameState.isInChat = false;
        gameLoop.setLoading(false); 
    };
    
    modal.openCombatModal(initialState, cancelCombat);
    
    document.querySelectorAll('.strategy-btn').forEach(btn => {
        btn.addEventListener('click', () => handleStrategySelection(btn.dataset.strategy));
    });

    const surrenderBtn = document.getElementById('combat-surrender-btn');
    if(surrenderBtn) surrenderBtn.addEventListener('click', handleCombatSurrender);
}

function handleStrategySelection(strategy) {
    gameState.combat.selectedStrategy = strategy;
    gameState.combat.selectedSkill = null; 
    gameState.combat.selectedPowerLevel = 1;

    document.querySelectorAll('.strategy-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.strategy === strategy);
    });

    const skillSelectionContainer = document.getElementById('skill-selection');
    const confirmBtn = document.getElementById('combat-confirm-btn');
    skillSelectionContainer.innerHTML = '';
    
    const playerSkills = gameState.combat.state?.player?.skills || [];
    const currentWeaponType = gameState.combat.state?.player?.currentWeaponType;
    
    const categoryMap = { 
        'attack': '攻擊', 
        'defend': '防禦', 
        'evade': '迴避',
        'support': '輔助',
        'heal': '治癒'
    };
    const targetCategory = categoryMap[strategy];

    const relevantSkills = playerSkills.filter(skill => skill.combatCategory === targetCategory);

    if (relevantSkills.length > 0) {
        relevantSkills.forEach(skill => {
            const requiredWeapon = skill.requiredWeaponType;
            
            const isUsable = 
                (requiredWeapon && requiredWeapon !== '無' && requiredWeapon === currentWeaponType) ||
                (requiredWeapon === '無' && currentWeaponType === null);

            const disabledClass = isUsable ? '' : 'disabled';

            let weaponStatusHtml = '';
            if (requiredWeapon && requiredWeapon !== '無') {
                if (isUsable) {
                    weaponStatusHtml = `<span class="weapon-status equipped">&lt;已裝備兵器&gt;</span>`;
                } else {
                    weaponStatusHtml = `<span class="weapon-status missing">需裝備：${requiredWeapon}</span>`;
                }
            }

            const skillControl = document.createElement('div');
            skillControl.className = `skill-controls ${disabledClass}`;
            skillControl.dataset.skillName = skill.skillName;

            skillControl.innerHTML = `
                <button class="skill-btn" ${isUsable ? '' : 'disabled'}>
                    <span class="skill-name">${skill.skillName} (L${skill.level})</span>
                    ${weaponStatusHtml}
                    <span class="skill-cost" data-base-cost="${skill.cost || 5}">內力 ${skill.cost || 5}</span>
                </button>
                <div class="power-level-adjuster">
                    <input type="range" class="power-level-slider" min="1" max="${skill.level}" value="1" step="1" ${isUsable ? '' : 'disabled'}>
                    <span class="power-level-display">1 成</span>
                </div>
            `;
            
            if (isUsable) {
                skillControl.querySelector('.skill-btn').addEventListener('click', () => handleSkillSelection(skill.skillName));
                
                const slider = skillControl.querySelector('.power-level-slider');
                slider.addEventListener('input', () => {
                    const powerLevel = slider.value;
                    const costSpan = skillControl.querySelector('.skill-cost');
                    const baseCost = parseInt(costSpan.dataset.baseCost, 10);
                    const totalCost = baseCost * powerLevel;
                    const currentMp = gameState.combat.state.player.mp;

                    skillControl.querySelector('.power-level-display').textContent = `${powerLevel} 成`;
                    costSpan.textContent = `內力 ${totalCost}`;

                    if (totalCost > currentMp) {
                        costSpan.style.color = '#dc3545'; 
                        confirmBtn.disabled = true;
                    } else {
                        costSpan.style.color = ''; 
                        confirmBtn.disabled = false;
                    }
                    
                    if (gameState.combat.selectedSkill === skill.skillName) {
                        gameState.combat.selectedPowerLevel = parseInt(powerLevel, 10);
                    }
                });
            }

            skillSelectionContainer.appendChild(skillControl);
        });
    } else {
         skillSelectionContainer.innerHTML = `<p class="system-message">你沒有可用於此策略的武學。</p>`;
    }
    
    if (confirmBtn) {
        confirmBtn.disabled = false;
    }
}


function handleSkillSelection(skillName) {
    if (gameState.combat.selectedSkill === skillName) {
        gameState.combat.selectedSkill = null;
        gameState.combat.selectedPowerLevel = null;
        document.querySelector(`.skill-controls[data-skill-name="${skillName}"]`)?.classList.remove('selected');
        return;
    }

    gameState.combat.selectedSkill = skillName;
    gameState.combat.selectedPowerLevel = 1; 

    document.querySelectorAll('.skill-controls').forEach(control => {
        const isSelected = control.dataset.skillName === skillName;
        control.classList.toggle('selected', isSelected);
        if (isSelected) {
            const slider = control.querySelector('.power-level-slider');
            const display = control.querySelector('.power-level-display');
            const costSpan = control.querySelector('.skill-cost');
            const baseCost = parseInt(costSpan.dataset.baseCost, 10);
            
            if(slider) slider.value = 1;
            if(display) display.textContent = `1 成`;
            if(costSpan) costSpan.textContent = `內力 ${baseCost}`;
        }
    });
    
    const confirmBtn = document.getElementById('combat-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = false;
}

async function handleBeggarInquiry(npcName, npcProfile) {
    hideNpcInteractionMenu();
    if (gameState.isRequesting) return;
    
    gameState.isInChat = true;
    gameState.currentChatNpc = npcName;
    gameState.chatHistory = [];
    
    modal.openChatModalUI(npcProfile, 'inquiry'); 
    modal.appendChatMessage('npc', "客官想打聽點什麼？（每次提問將花費100銀兩）");
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

        if (localNpcData && (localNpcData.status_title === '丐幫弟子' || localNpcData.isTemp)) {
            await handleBeggarInquiry(npcName, localNpcData);
        } else {
            try {
                targetIsNpc.style.cursor = 'wait';
                hideNpcInteractionMenu();
                const profile = await api.getNpcProfile(npcName);
                targetIsNpc.style.cursor = 'pointer';

                if (profile.status_title === '丐幫弟子') {
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
                    const moneyContent = document.getElementById('money-content');
                    if (moneyContent) moneyContent.textContent = `${paymentResult.newBalance} 兩銀子`;
                }
            } catch (error) {
                if(error.message.includes('銀兩不足')) {
                    modal.appendChatMessage('npc', '嘿嘿，客官，您的銀兩似乎不太夠啊...');
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
        modal.appendChatMessage('system', `[系統錯誤: ${error.message}]`);
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
    gameLoop.setLoading(true, '正在總結對話，更新江湖事態...');

    try {
        const data = await api.endChat({
            npcName: npcNameToSummarize,
            fullChatHistory: gameState.chatHistory,
            model: dom.aiModelSelector.value
        });
        if (data && data.roundData && typeof data.roundData.R !== 'undefined') {
            appendMessageToStory(`<p class="system-message">結束了與${npcNameToSummarize}的交談。</p>`);
            gameLoop.processNewRoundData(data);
        } else {
            throw new Error('從伺服器收到的回應格式不正確。');
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
    gameLoop.setLoading(true, "正在更新江湖事態..."); 

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
            throw new Error("從伺服器收到的回應格式不正確。");
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
    if (!window.confirm("你確定要在此刻認輸嗎？")) return;
    
    gameLoop.setLoading(true, "正在與對方交涉...");

    try {
        const data = await api.combatSurrender({ model: dom.aiModelSelector.value });

        if (data.status === 'SURRENDER_ACCEPTED') {
            modal.updateCombatLog(`<p class="system-message">${data.narrative}</p>`);
            setTimeout(() => {
                modal.closeCombatModal();
                gameLoop.processNewRoundData(data.newRound);
                gameLoop.setLoading(false);
            }, 2000);
        } else {
            modal.updateCombatLog(`<p class="system-message">${data.narrative}</p>`);
            gameLoop.setLoading(false);
        }
    } catch (error) {
        modal.updateCombatLog(`[系統] 你的認輸請求似乎被對方無視了。(${error.message})`, 'system-message');
        gameLoop.setLoading(false);
    }
}

export async function handleConfirmCombatAction() {
    if (!gameState.combat.selectedStrategy) {
        alert('請選擇一個策略！');
        return;
    }
    
    const relevantSkills = (gameState.combat.state?.player?.skills || []).filter(s => s.combatCategory === {attack: '攻擊', defend: '防禦', evade: '迴避', support: '輔助', heal: '治癒'}[gameState.combat.selectedStrategy]);

    if (relevantSkills.length > 0 && !gameState.combat.selectedSkill) {
         // 允許不選技能，視為普通攻擊
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
            setTimeout(() => endCombat(data.combatResult), 1500);
        } else {
            document.querySelectorAll('.strategy-btn.selected, .skill-controls.selected').forEach(el => el.classList.remove('selected'));
            document.getElementById('skill-selection').innerHTML = '<p class="system-message">請先選擇一個策略</p>';
            document.getElementById('combat-confirm-btn').disabled = true;
            gameState.combat.selectedStrategy = null;
            gameState.combat.selectedSkill = null;
            gameState.combat.selectedPowerLevel = null;
            gameLoop.setLoading(false);
        }

    } catch (error) {
        modal.updateCombatLog(`[系統] 你的招式似乎沒有生效，江湖的氣息有些不穩，請再試一次。(${error.message})`, 'system-message');
        gameLoop.setLoading(false);
    }
}
