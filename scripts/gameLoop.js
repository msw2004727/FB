// scripts/gameLoop.js

import { api } from './api.js';
import { gameState } from './gameState.js';
import { updateUI, handleApiError, appendMessageToStory, addRoundTitleToStory } from './uiUpdater.js';
import * as modal from './modalManager.js';
import { gameTips } from './tips.js';
import * as interaction from './interactionHandlers.js';
import { dom } from './dom.js';

// --- 【核心修改】新增載入提醒文字陣列 ---
const loadingDisclaimers = [
    "說書人掐指一算：此番推演約需二十至四十五息。若遇江湖新奇，則需額外十數息為其立傳建檔。",
    "天機運轉，世界演化...若初遇奇人、初探秘境，耗時或將近一分鐘，還望少俠耐心等候。",
    "我正為你鋪展前路，此刻切莫分心。若移步他處，恐致天機紊亂，因果錯亂，前功盡棄矣。",
    "江湖之大，變數無窮。為你編織全新際遇需耗心神，請稍安勿躁，莫要離開。",
    "緣法交織，命途展開...為保推演無誤，請留在此畫面，靜候佳音。"
];

let tipInterval = null;
let disclaimerInterval = null; // 【核心新增】為載入提醒創建獨立的計時器

function updateBountyButton(hasNew) {
    if (dom.bountiesBtn) {
        dom.bountiesBtn.classList.toggle('has-new-bounty', hasNew);
    }
}

export function setLoading(isLoading, text = '') {
    gameState.isRequesting = isLoading;
    dom.playerInput.disabled = isLoading || gameState.isInCombat || gameState.isInChat;
    dom.submitButton.disabled = isLoading || gameState.isInCombat || gameState.isInChat;
    dom.submitButton.textContent = isLoading ? '撰寫中...' : '動作';
    dom.chatInput.disabled = isLoading;
    dom.chatActionBtn.disabled = isLoading;
    dom.endChatBtn.disabled = isLoading;

    const combatSurrenderBtn = document.getElementById('combat-surrender-btn');
    if (combatSurrenderBtn) {
        combatSurrenderBtn.disabled = isLoading;
    }

    if (dom.aiThinkingLoader) {
        const loaderDisclaimerElement = dom.aiThinkingLoader.querySelector('.loader-disclaimer');
        const loaderTextElement = dom.aiThinkingLoader.querySelector('.loader-text');
        const loaderTipElement = dom.aiThinkingLoader.querySelector('.loader-tip');
        
        if(loaderTextElement) loaderTextElement.textContent = text;
        
        const showGlobalLoader = isLoading && !gameState.isInCombat && !gameState.isInChat && !document.getElementById('epilogue-modal').classList.contains('visible');

        if (showGlobalLoader) {
            // --- 【核心修改】同時啟動兩個獨立的輪播 ---
            
            // 1. 遊戲技巧輪播
            const rotateTip = () => {
                if (gameTips.length > 0) {
                    const randomIndex = Math.floor(Math.random() * gameTips.length);
                    if (loaderTipElement) {
                        loaderTipElement.innerHTML = gameTips[randomIndex];
                    }
                }
            };
            rotateTip();
            tipInterval = setInterval(rotateTip, 10000); // 技巧提示10秒換一次

            // 2. 載入提醒輪播
            const rotateDisclaimer = () => {
                if (loadingDisclaimers.length > 0) {
                    const randomIndex = Math.floor(Math.random() * loadingDisclaimers.length);
                    if(loaderDisclaimerElement) {
                        loaderDisclaimerElement.innerHTML = loadingDisclaimers[randomIndex];
                    }
                }
            };
            rotateDisclaimer();
            disclaimerInterval = setInterval(rotateDisclaimer, 10000); // 載入提醒10秒換一次

        } else {
            // --- 【核心修改】同時停止兩個輪播 ---
            clearInterval(tipInterval);
            clearInterval(disclaimerInterval);
        }
        dom.aiThinkingLoader.classList.toggle('visible', showGlobalLoader);
    }
    
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

        dom.chatInput.focus();
    } catch (error) {
        console.error(`啟動與 ${npcName} 的主動對話失敗:`, error);
        appendMessageToStory(`[系統] ${npcName}似乎想對你說些什麼，但你沒有聽清。`, 'system-message');
    }
}

export function processNewRoundData(data) {
    if(!data.roundData) return;
    
    data.roundData.suggestion = data.suggestion;
    addRoundTitleToStory(data.roundData.EVT || `第 ${data.roundData.R} 回`);
    
    // 更新死亡名單
    if (data.roundData.NPC && Array.isArray(data.roundData.NPC)) {
        data.roundData.NPC.forEach(npc => {
            if (npc.isDeceased && !gameState.deceasedNpcs.includes(npc.name)) {
                gameState.deceasedNpcs.push(npc.name);
                console.log(`[生死簿] 已記錄死亡NPC: ${npc.name}`);
            }
        });
    }

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
        startProactiveChat(data.proactiveChat);
    }
}

export async function handlePlayerAction() {
    interaction.hideNpcInteractionMenu();
    const actionText = dom.playerInput.value.trim();
    if (!actionText || gameState.isRequesting) return;

    if (actionText.toUpperCase() === '/*GM') {
        dom.playerInput.value = '';
        dom.gmPanel.classList.add('visible');
        return;
    }

    dom.playerInput.value = '';

    const prequelElement = dom.storyTextContainer.querySelector('.prequel-summary');
    if (prequelElement) {
        dom.storyTextContainer.innerHTML = '';
    }

    setLoading(true, '江湖百曉生正在構思...');
    appendMessageToStory(`> ${actionText}`, 'player-action-log');

    try {
        const data = await api.interact({
            action: actionText,
            round: gameState.currentRound,
            model: dom.aiModelSelector.value
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
    setLoading(true, '正在連接你的世界，讀取記憶中...');
    
    try {
        const data = await api.getLatestGame();
        
        dom.storyTextContainer.innerHTML = ''; 

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
                dom.storyTextContainer.appendChild(prequelDiv);
            }
            processNewRoundData(data);
        }
    } catch (error) {
        if (error.message.includes('找不到存檔')) {
            dom.storyTextContainer.innerHTML = '';
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
