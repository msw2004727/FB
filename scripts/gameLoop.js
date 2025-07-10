// scripts/gameLoop.js

import { api } from './api.js';
import { gameState } from './gameState.js';
import { updateUI, handleApiError, appendMessageToStory, addRoundTitleToStory } from './uiUpdater.js';
import * as modal from './modalManager.js';
import { gameTips } from './tips.js';
import * as interaction from './interactionHandlers.js';

let tipInterval = null;

// --- Private Functions ---

function updateBountyButton(hasNew) {
    const bountiesBtn = document.getElementById('bounties-btn');
    if (bountiesBtn) {
        bountiesBtn.classList.toggle('has-new-bounty', hasNew);
    }
}

// --- Exported Functions ---

export function setLoading(isLoading, text = '') {
    const playerInput = document.getElementById('player-input');
    const submitButton = document.getElementById('submit-button');
    const chatInput = document.getElementById('chat-input');
    const chatActionBtn = document.getElementById('chat-action-btn');
    const endChatBtn = document.getElementById('end-chat-btn');
    const combatSurrenderBtn = document.getElementById('combat-surrender-btn');
    const aiThinkingLoader = document.querySelector('.ai-thinking-loader');
    const loaderTipElement = aiThinkingLoader.querySelector('.loader-tip');
    const loaderTextElement = aiThinkingLoader.querySelector('.loader-text');

    gameState.isRequesting = isLoading;
    playerInput.disabled = isLoading || gameState.isInCombat || gameState.isInChat;
    submitButton.disabled = isLoading || gameState.isInCombat || gameState.isInChat;
    submitButton.textContent = isLoading ? '撰寫中...' : '動作';
    chatInput.disabled = isLoading;
    chatActionBtn.disabled = isLoading;
    endChatBtn.disabled = isLoading;

    if (combatSurrenderBtn) {
        combatSurrenderBtn.disabled = isLoading;
    }
    
    if(loaderTextElement) loaderTextElement.textContent = text;
    
    const showGlobalLoader = isLoading && !gameState.isInCombat && !gameState.isInChat && !document.getElementById('epilogue-modal').classList.contains('visible');

    if (showGlobalLoader) {
        const rotateTip = () => {
            if (gameTips.length > 0) {
                const randomIndex = Math.floor(Math.random() * gameTips.length);
                if (loaderTipElement) {
                    loaderTipElement.innerHTML = gameTips[randomIndex];
                }
            }
        };
        rotateTip();
        tipInterval = setInterval(rotateTip, 10000);
    } else {
        clearInterval(tipInterval);
    }

    aiThinkingLoader.classList.toggle('visible', showGlobalLoader);
    modal.setCombatLoading(isLoading && gameState.isInCombat);
    modal.setChatLoading(isLoading && gameState.isInChat);
}

export async function handlePlayerDeath() {
    modal.showEpilogueModal('<div class="loading-placeholder"><p>史官正在為您的人生撰寫終章...</p><div class="loader-dots"><span></span><span></span><span></span></div></div>', () => {
        modal.showDeceasedScreen();
    });

    try {
        const data = await api.getEpilogue();
        if (data && data.epilogue) {
            const formattedEpilogue = data.epilogue.replace(/\n/g, '<br><br>');
            modal.showEpilogueModal(formattedEpilogue, () => {
                modal.showDeceasedScreen();
            });
        } else {
            throw new Error("未能獲取有效的結局故事。");
        }
    } catch (error) {
        modal.showEpilogueModal(`<p class="system-message">史官的筆墨耗盡，未能為您寫下終章...<br>(${error.message})</p>`, () => {
            modal.showDeceasedScreen();
        });
        console.error("獲取結局失敗:", error);
    }
}

async function startProactiveChat(proactiveData) {
    const { npcName, openingLine, itemChanges } = proactiveData;
    
    try {
        const profile = await api.getNpcProfile(npcName);
        
        gameState.isInChat = true;
        gameState.currentChatNpc = npcName;
        gameState.chatHistory = [];

        modal.openChatModalUI(profile); 
        
        modal.appendChatMessage('npc', openingLine);
        gameState.chatHistory.push({ speaker: 'npc', message: openingLine });

        if (itemChanges && itemChanges.length > 0) {
            const itemNames = itemChanges.map(item => `${item.itemName} x${item.quantity}`).join('、');
            const giftMessage = `你獲得了來自 ${npcName} 的贈禮：${itemNames}。`;
            modal.appendChatMessage('system', giftMessage);
            gameState.chatHistory.push({ speaker: 'system', message: giftMessage });
        }

        document.getElementById('chat-input').focus();
    } catch (error) {
        console.error(`啟動與 ${npcName} 的主動對話失敗:`, error);
        appendMessageToStory(`[系統] ${npcName}似乎想對你說些什麼，但你沒有聽清。`, 'system-message');
    }
}

export function processNewRoundData(data) {
    data.roundData.suggestion = data.suggestion;
    addRoundTitleToStory(data.roundData.EVT || `第 ${data.roundData.R} 回`);
    updateUI(data.story, data.roundData, data.randomEvent, data.locationData);
    
    gameState.currentRound = data.roundData.R;
    gameState.roundData = data.roundData;

    updateBountyButton(data.hasNewBounties);

    if (data.roundData.playerState === 'dead') {
        setLoading(false);
        handlePlayerDeath();
        return;
    }
    
    if (data.proactiveChat) {
        setLoading(false); 
        startProactiveChat(data.proactiveChat);
        return; 
    }
}

export async function handlePlayerAction() {
    interaction.hideNpcInteractionMenu();
    const playerInput = document.getElementById('player-input');
    const actionText = playerInput.value.trim();
    if (!actionText || gameState.isRequesting) return;

    if (actionText.toUpperCase() === '/*GM') {
        playerInput.value = '';
        document.getElementById('gm-panel').classList.add('visible');
        return;
    }

    playerInput.value = '';

    const prequelElement = document.getElementById('story-text-wrapper').querySelector('.prequel-summary');
    if (prequelElement) {
        document.getElementById('story-text-wrapper').innerHTML = '';
    }

    setLoading(true, '江湖百曉生正在構思...');
    appendMessageToStory(`> ${actionText}`, 'player-action-log');

    try {
        const data = await api.interact({
            action: actionText,
            round: gameState.currentRound,
            model: document.getElementById('ai-model-selector').value
        });

        if (data && data.roundData) {
            processNewRoundData(data);
        } else {
            throw new Error("從伺服器收到的回應格式不正確。");
        }

        if (data.combatInfo && data.combatInfo.status === 'COMBAT_START') {
            interaction.startCombat(data.combatInfo.initialState);
        }

    } catch (error) {
        console.error('API 錯誤或通訊中斷:', error);
        appendMessageToStory(`[系統] 通訊似乎發生了中斷... 正在嘗試為您同步最新的江湖狀態...`, 'system-message');
        await loadInitialGame();
    } finally {
        if (!document.getElementById('epilogue-modal').classList.contains('visible') && !gameState.isInChat) {
             setLoading(false);
        }
    }
}

export async function loadInitialGame() {
    const storyTextContainer = document.getElementById('story-text-wrapper');
    setLoading(true, '正在連接你的世界，讀取記憶中...');
    
    try {
        const data = await api.getLatestGame();
        
        storyTextContainer.innerHTML = ''; 

        if (data.gameState === 'deceased') {
            if(data.roundData) {
                updateUI('', data.roundData, null, data.locationData);
            }
            handlePlayerDeath();
        } else {
            if (data.prequel) {
                const prequelDiv = document.createElement('div');
                prequelDiv.className = 'prequel-summary';
                prequelDiv.innerHTML = `<h3>前情提要</h3><p>${data.prequel.replace(/\n/g, '<br>')}</p>`;
                storyTextContainer.appendChild(prequelDiv);
            }
            processNewRoundData(data);
        }
    } catch (error) {
        if (error.message.includes('找不到存檔')) {
            storyTextContainer.innerHTML = '';
            const initialMessage = '你的旅程似乎尚未開始。請在下方輸入你的第一個動作，例如「睜開眼睛，環顧四周」。';
            const roundZeroData = { R: 0, EVT: '楔子', ATM: ['迷茫'], WRD: '未知', LOC: ['未知之地'], PC: '身體虛弱，內息紊亂', NPC: [], ITM: '行囊空空', QST: '', PSY: '我是誰...我在哪...', CLS: '', timeOfDay: '上午', internalPower: 5, externalPower: 5, lightness: 5, morality: 0, yearName: '元祐', year: 1, month: 1, day: 1, stamina: 100, suggestion: '先檢查一下自己的身體狀況吧。' };
            
            addRoundTitleToStory(roundZeroData.EVT);
            appendMessageToStory(initialMessage, 'system-message');
            updateUI(null, roundZeroData, null, null);
        } else {
            handleApiError(error);
        }
    } finally {
         if (!document.getElementById('epilogue-modal').classList.contains('visible')) {
             setLoading(false);
        }
    }
}
