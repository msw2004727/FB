// scripts/interactionHandlers.js

import { api } from './api.js';
import { gameState } from './gameState.js';
import * as modal from './modalManager.js';
import { updateUI, appendMessageToStory, addRoundTitleToStory, handleApiError } from './uiUpdater.js';

// 由於 gameLoop.js 會處理讀取狀態，我們需要一個方式讓這裡的函式可以呼叫它
// 我們稍後會在 gameLoop.js 中定義這個函式，並將其賦值給這個變數
export let getGameLoop;
export function setGameLoop(loop) {
    getGameLoop = loop;
}

// --- NPC 互動選單 ---

export function hideNpcInteractionMenu() {
    const npcInteractionMenu = document.getElementById('npc-interaction-menu');
    if (npcInteractionMenu) {
        npcInteractionMenu.classList.remove('visible');
        npcInteractionMenu.innerHTML = '';
    }
}

function showNpcInteractionMenu(targetElement, npcName) {
    const npcInteractionMenu = document.getElementById('npc-interaction-menu');
    const storyPanel = document.getElementById('story-panel');

    npcInteractionMenu.innerHTML = `
        <button class="npc-interaction-btn trade" data-npc-name="${npcName}"><i class="fas fa-exchange-alt"></i> 交易</button>
        <button class="npc-interaction-btn chat" data-npc-name="${npcName}"><i class="fas fa-comments"></i> 聊天</button>
        <button class="npc-interaction-btn attack" data-npc-name="${npcName}"><i class="fas fa-khanda"></i> 動手</button>
    `;
    
    npcInteractionMenu.querySelector('.trade').addEventListener('click', handleTradeButtonClick);
    npcInteractionMenu.querySelector('.chat').addEventListener('click', handleChatButtonClick);
    npcInteractionMenu.querySelector('.attack').addEventListener('click', showAttackConfirmation);

    const menuRect = npcInteractionMenu.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const panelRect = storyPanel.getBoundingClientRect();

    let top = targetRect.bottom - panelRect.top + storyPanel.scrollTop + 8;
    let left = targetRect.left - panelRect.left + (targetRect.width / 2) - (menuRect.width / 2);

    if (top + menuRect.height > storyPanel.scrollHeight) {
        top = targetRect.top - panelRect.top + storyPanel.scrollTop - menuRect.height - 8;
    }

    const rightEdge = left + menuRect.width;
    if (rightEdge > panelRect.width) {
        left = panelRect.width - menuRect.width - 5; 
    }
    if (left < 0) {
        left = 5;
    }

    npcInteractionMenu.style.top = `${top}px`;
    npcInteractionMenu.style.left = `${left}px`;
    npcInteractionMenu.classList.add('visible');
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


// --- 交易處理 ---

async function handleTradeButtonClick(event) {
    const npcName = event.currentTarget.dataset.npcName;
    hideNpcInteractionMenu();
    if (gameState.isRequesting) return;
    getGameLoop().setLoading(true, `正在與 ${npcName} 準備交易...`);
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
        getGameLoop().setLoading(false);
    }
}


// --- 聊天處理 ---

async function handleChatButtonClick(event) {
    const npcName = event.currentTarget.dataset.npcName;
    hideNpcInteractionMenu();
    if (gameState.isRequesting) return;
    getGameLoop().setLoading(true, '正在查找此人檔案...');
    try {
        const profile = await api.getNpcProfile(npcName);
        gameState.isInChat = true;
        gameState.currentChatNpc = profile.name;
        gameState.chatHistory = [];
        modal.openChatModalUI(profile);
        document.getElementById('chat-input').focus();
    } catch (error) {
        if (error.message && error.message.includes('並未見到')) {
            appendMessageToStory(error.message, 'system-message');
        } else {
            handleApiError(error);
        }
    } finally {
        getGameLoop().setLoading(false);
    }
}

export async function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    const message = chatInput.value.trim();
    if (!message || gameState.isRequesting) return;
    chatInput.value = '';
    modal.appendChatMessage('player', message);
    gameState.chatHistory.push({ speaker: 'player', message: message });
    getGameLoop().setLoading(true);

    try {
        const data = await api.npcChat({
            npcName: gameState.currentChatNpc,
            chatHistory: gameState.chatHistory,
            playerMessage: message,
            model: document.getElementById('ai-model-selector').value
        });
        modal.appendChatMessage('npc', data.reply);
        gameState.chatHistory.push({ speaker: 'npc', message: data.reply });
    } catch (error) {
        modal.appendChatMessage('system', `[系統錯誤: ${error.message}]`);
    } finally {
        getGameLoop().setLoading(false);
    }
}

export async function endChatSession() {
    if (gameState.isRequesting || !gameState.currentChatNpc) return;
    const npcNameToSummarize = gameState.currentChatNpc;
    
    modal.closeChatModal();
    gameState.isInChat = false; 
    getGameLoop().setLoading(true, '正在總結對話，更新江湖事態...');

    try {
        const data = await api.endChat({
            npcName: npcNameToSummarize,
            fullChatHistory: gameState.chatHistory,
            model: document.getElementById('ai-model-selector').value
        });
        if (data && data.roundData && typeof data.roundData.R !== 'undefined') {
            appendMessageToStory(`<p class="system-message">結束了與${npcNameToSummarize}的交談。</p>`);
            getGameLoop().processNewRoundData(data);
        } else {
            throw new Error('從伺服器收到的回應格式不正確。');
        }
    } catch (error) {
        handleApiError(error);
    } finally {
        gameState.currentChatNpc = null;
        gameState.chatHistory = [];
        getGameLoop().setLoading(false);
    }
}


// --- 贈予物品處理 ---

export async function handleGiveItem(giveData) {
    modal.closeGiveItemModal(); 
    modal.closeChatModal(); 
    gameState.isInChat = false;
    getGameLoop().setLoading(true, "正在更新江湖事態..."); 

    try {
        const body = {
            giveData: {
                target: gameState.currentChatNpc,
                ...giveData
            },
            model: document.getElementById('ai-model-selector').value
        };
        const data = await api.giveItemToNpc(body);
        if (data && data.roundData) {
            getGameLoop().processNewRoundData(data);
        } else {
            throw new Error("從伺服器收到的回應格式不正確。");
        }
    } catch (error) {
        handleApiError(error); 
    } finally {
        gameState.currentChatNpc = null;
        gameState.chatHistory = [];
        getGameLoop().setLoading(false); 
    }
}


// --- 攻擊與戰鬥處理 ---

function showAttackConfirmation(event) {
    const npcName = event.currentTarget.dataset.npcName;
    const npcInteractionMenu = document.getElementById('npc-interaction-menu');
    const existingButtons = npcInteractionMenu.querySelectorAll('.npc-interaction-btn');
    existingButtons.forEach(btn => btn.style.display = 'none');
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
    npcInteractionMenu.appendChild(promptText);
    npcInteractionMenu.appendChild(cancelBtn);
    npcInteractionMenu.appendChild(confirmBtn);
    cancelBtn.addEventListener('click', hideNpcInteractionMenu);
    confirmBtn.addEventListener('click', confirmAndInitiateAttack);
}

async function confirmAndInitiateAttack(event) {
    const npcName = event.currentTarget.dataset.npcName;
    hideNpcInteractionMenu();
    if (gameState.isRequesting) return;
    
    getGameLoop().setLoading(true, `準備與 ${npcName} 對決...`);
    try {
        const data = await api.initiateCombat({ targetNpcName: npcName, isSparring: false });
        if (data.status === 'COMBAT_START') {
            startCombat(data.initialState);
        }
    } catch (error) {
        handleApiError(error);
    } finally {
        if (!gameState.isInCombat) {
             getGameLoop().setLoading(false);
        }
    }
}

function startCombat(initialState) {
    gameState.isInCombat = true;
    gameState.combat.state = initialState;
    
    modal.openCombatModal(initialState, () => {
        if (window.confirm("確定要逃離這次戰鬥嗎？這可能會對你的江湖聲望造成影響。")) {
            gameState.isInCombat = false;
            getGameLoop().setLoading(false); 
            appendMessageToStory("[系統] 你決定不戰而退，迅速離開了現場。", 'system-message');
        }
    });
    
    document.querySelectorAll('.strategy-btn').forEach(btn => {
        btn.addEventListener('click', () => handleStrategySelection(btn.dataset.strategy));
    });
    
    document.getElementById('combat-surrender-btn').addEventListener('click', handleCombatSurrender);
}

export async function handleCombatSurrender() {
    if (!gameState.isInCombat || gameState.isRequesting) return;
    if (!window.confirm("你確定要在此刻認輸嗎？")) return;
    
    getGameLoop().setLoading(true, "正在與對方交涉...");

    try {
        const data = await api.combatSurrender({ model: document.getElementById('ai-model-selector').value });

        if (data.status === 'SURRENDER_ACCEPTED') {
            modal.updateCombatLog(`<p class="system-message">${data.narrative}</p>`);
            setTimeout(() => endCombat(data.newRound), 2000);
        } else {
            modal.updateCombatLog(`<p class="system-message">${data.narrative}</p>`);
            getGameLoop().setLoading(false);
        }
    } catch (error) {
        modal.updateCombatLog(`[系統] 你的認輸請求似乎被對方無視了。(${error.message})`, 'system-message');
        getGameLoop().setLoading(false);
    }
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

    getGameLoop().setLoading(true);

    try {
        const combatActionPayload = {
            strategy: gameState.combat.selectedStrategy,
            skill: gameState.combat.selectedSkill,
            target: gameState.combat.selectedTarget, 
            model: document.getElementById('ai-model-selector').value
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
        if (gameState.isInCombat) getGameLoop().setLoading(false);
    }
}

function endCombat(newRoundData) {
    gameState.isInCombat = false;
    modal.closeCombatModal();
    
    if (newRoundData && newRoundData.roundData && newRoundData.roundData.playerState === 'dead') {
        updateUI(newRoundData.story, newRoundData.roundData, null, newRoundData.locationData);
        getGameLoop().handlePlayerDeath();
        return;
    }

    if (newRoundData && newRoundData.roundData && newRoundData.story) {
        getGameLoop().processNewRoundData(newRoundData);
    } else {
        appendMessageToStory("[系統] 戰鬥已結束，請繼續你的旅程。", 'system-message');
    }
    document.getElementById('player-input').focus();
    getGameLoop().setLoading(false);
}
