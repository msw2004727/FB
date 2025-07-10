// scripts/interactionHandlers.js

import { api } from './api.js';
import { gameState } from './gameState.js';
import * as modal from './modalManager.js';
import { updateUI, appendMessageToStory, addRoundTitleToStory, handleApiError } from './uiUpdater.js';
import { dom } from './dom.js';

let gameLoop = {};
export function setGameLoop(loop) {
    gameLoop = loop;
}

function showAttackConfirmation(event) {
    const npcName = event.currentTarget.dataset.npcName;
    dom.npcInteractionMenu.querySelectorAll('.npc-interaction-btn').forEach(btn => btn.style.display = 'none');
    const promptText = document.createElement('span');
    promptText.className = 'confirm-prompt-text';
    promptText.textContent = '確定要動手？';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'npc-interaction-btn cancel-attack';
    cancelBtn.dataset.npcName = npcName;
    cancelBtn.innerHTML = '<i class="fas fa-times"></i>';
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'npc-interaction-btn confirm-attack';
    confirmBtn.dataset.npcName = npcName;
    confirmBtn.innerHTML = '<i class="fas fa-check"></i>';
    dom.npcInteractionMenu.appendChild(promptText);
    dom.npcInteractionMenu.appendChild(cancelBtn);
    dom.npcInteractionMenu.appendChild(confirmBtn);
    cancelBtn.addEventListener('click', hideNpcInteractionMenu);
    confirmBtn.addEventListener('click', confirmAndInitiateAttack);
}

async function handleTradeButtonClick(event) {
    const npcName = event.currentTarget.dataset.npcName;
    hideNpcInteractionMenu();
    if (gameState.isRequesting) return;
    gameLoop.setLoading(true, `正在與 ${npcName} 準備交易...`);
    try {
        const tradeData = await api.startTrade(npcName);
        modal.openTradeModal(tradeData, npcName, (newRound) => {
            modal.closeTradeModal();
            if (newRound && newRound.roundData) {
                addRoundTitleToStory(newRound.roundData.EVT || `第 ${newRound.roundData.R} 回`);
                updateUI(newRound.story, newRound.roundData, null, newRound.locationData);
                gameState.currentRound = newRound.roundData.R;
                gameState.roundData = newRound.roundData;
            }
        });
    } catch (error) {
        handleApiError(error);
    } finally {
        gameLoop.setLoading(false);
    }
}

async function handleChatButtonClick(event) {
    const npcName = event.currentTarget.dataset.npcName;
    hideNpcInteractionMenu();
    if (gameState.isRequesting) return;
    gameLoop.setLoading(true, '正在查找此人檔案...');
    try {
        const profile = await api.getNpcProfile(npcName);
        gameState.isInChat = true;
        gameState.currentChatNpc = profile.name;
        gameState.chatHistory = [];
        modal.openChatModalUI(profile);
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
    const npcName = event.currentTarget.dataset.npcName;
    hideNpcInteractionMenu();
    if (gameState.isRequesting) return;
    
    gameLoop.setLoading(true, `準備與 ${npcName} 對決...`);
    try {
        const data = await api.initiateCombat({ targetNpcName: npcName, isSparring: false });
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
    
    modal.openCombatModal(initialState, () => {
        if (window.confirm("確定要逃離這次戰鬥嗎？這可能會對你的江湖聲望造成影響。")) {
            gameState.isInCombat = false;
            gameLoop.setLoading(false); 
            appendMessageToStory("[系統] 你決定不戰而退，迅速離開了現場。", 'system-message');
        }
    });
    
    document.querySelectorAll('.strategy-btn').forEach(btn => {
        btn.addEventListener('click', () => handleStrategySelection(btn.dataset.strategy));
    });

    const surrenderBtn = document.getElementById('combat-surrender-btn');
    if(surrenderBtn) surrenderBtn.addEventListener('click', handleCombatSurrender);
}

function endCombat(newRoundData) {
    gameState.isInCombat = false;
    modal.closeCombatModal();
    
    if (newRoundData && newRoundData.roundData && newRoundData.roundData.playerState === 'dead') {
        updateUI(newRoundData.story, newRoundData.roundData, null, newRoundData.locationData);
        gameLoop.handlePlayerDeath();
        return;
    }

    if (newRoundData && newRoundData.roundData && newRoundData.story) {
        gameLoop.processNewRoundData(newRoundData);
    } else {
        appendMessageToStory("[系統] 戰鬥已結束，請繼續你的旅程。", 'system-message');
    }
    dom.playerInput.focus();
    gameLoop.setLoading(false);
}

function handleStrategySelection(strategy) {
    gameState.combat.selectedStrategy = strategy;
    gameState.combat.selectedSkill = null; 

    document.querySelectorAll('.strategy-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.strategy === strategy);
    });

    const skillSelectionContainer = document.getElementById('skill-selection');
    const confirmBtn = document.getElementById('combat-confirm-btn');
    skillSelectionContainer.innerHTML = '';
    if (confirmBtn) confirmBtn.disabled = true;

    const playerSkills = gameState.combat.state?.player?.skills || [];
    
    const categoryMap = { 'attack': '攻擊', 'defend': '防禦', 'evade': '迴避' };
    const targetCategory = categoryMap[strategy];

    const relevantSkills = playerSkills.filter(skill => skill.combatCategory === targetCategory);

    if (relevantSkills.length > 0) {
        relevantSkills.forEach(skill => {
            const skillBtn = document.createElement('button');
            skillBtn.className = 'skill-btn';
            skillBtn.dataset.skillName = skill.name;
            skillBtn.innerHTML = `
                <span class="skill-name">${skill.name} (L${skill.level})</span>
                <span class="skill-cost">內力 ${skill.cost || 5}</span>
            `;
            skillBtn.addEventListener('click', () => handleSkillSelection(skill.name));
            skillSelectionContainer.appendChild(skillBtn);
        });
    } else {
         skillSelectionContainer.innerHTML = `<p class="system-message">你沒有可用於此策略的武學。</p>`;
    }
    
    if (strategy === 'evade') {
         if (confirmBtn) confirmBtn.disabled = false;
    }
}

function handleSkillSelection(skillName) {
    gameState.combat.selectedSkill = skillName;
    document.querySelectorAll('.skill-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.skillName === skillName);
    });
    const confirmBtn = document.getElementById('combat-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = false;
}

export function hideNpcInteractionMenu() {
    if (dom.npcInteractionMenu) {
        dom.npcInteractionMenu.classList.remove('visible');
        dom.npcInteractionMenu.innerHTML = '';
    }
}

export function handleNpcClick(event) {
    const targetIsNpc = event.target.closest('.npc-name');
    const targetIsMenu = event.target.closest('.npc-interaction-menu');

    if (targetIsNpc) {
        const npcName = targetIsNpc.dataset.npcName || targetIsNpc.textContent;
        showNpcInteractionMenu(targetIsNpc, npcName);
    } else if (!targetIsMenu) {
        hideNpcInteractionMenu();
    }
}

export async function sendChatMessage() {
    const message = dom.chatInput.value.trim();
    if (!message || gameState.isRequesting) return;
    dom.chatInput.value = '';
    modal.appendChatMessage('player', message);
    gameState.chatHistory.push({ speaker: 'player', message: message });
    gameLoop.setLoading(true);

    try {
        const data = await api.npcChat({
            npcName: gameState.currentChatNpc,
            chatHistory: gameState.chatHistory,
            playerMessage: message,
            model: dom.aiModelSelector.value
        });
        modal.appendChatMessage('npc', data.reply);
        gameState.chatHistory.push({ speaker: 'npc', message: data.reply });
    } catch (error) {
        modal.appendChatMessage('system', `[系統錯誤: ${error.message}]`);
    } finally {
        gameLoop.setLoading(false);
    }
}

export async function endChatSession() {
    if (gameState.isRequesting || !gameState.currentChatNpc) return;
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
            setTimeout(() => endCombat(data.newRound), 2000);
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
    
    const hasRelevantSkills = (gameState.combat.state?.player?.skills || []).some(s => s.combatCategory === {attack: '攻擊', defend: '防禦', evade: '迴避'}[gameState.combat.selectedStrategy]);

    if (gameState.combat.selectedStrategy !== 'evade' && hasRelevantSkills && !gameState.combat.selectedSkill) {
        alert('請選擇一門武學！');
        return;
    }

    gameLoop.setLoading(true);

    try {
        const combatActionPayload = {
            strategy: gameState.combat.selectedStrategy,
            skill: gameState.combat.selectedSkill,
            target: gameState.combat.selectedTarget, 
            model: dom.aiModelSelector.value
        };

        const data = await api.combatAction(combatActionPayload);
        
        modal.setTurnCounter(data.updatedState.turn);
        modal.updateCombatLog(data.narrative);
        modal.updateCombatUI(data.updatedState);
        gameState.combat.state = data.updatedState;

        if (data.status === 'COMBAT_END') {
            setTimeout(() => endCombat(data.newRound), 2000);
        } else {
            document.querySelectorAll('.strategy-btn.selected, .skill-btn.selected').forEach(el => el.classList.remove('selected'));
            document.getElementById('skill-selection').innerHTML = '<p class="system-message">請先選擇一個策略</p>';
            document.getElementById('combat-confirm-btn').disabled = true;
            gameState.combat.selectedStrategy = null;
            gameState.combat.selectedSkill = null;
        }

    } catch (error) {
        modal.updateCombatLog(`[系統] 你的招式似乎沒有生效，江湖的氣息有些不穩，請再試一次。(${error.message})`, 'system-message');
    } finally {
        if (gameState.isInCombat) gameLoop.setLoading(false);
    }
}
