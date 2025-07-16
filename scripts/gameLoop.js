// scripts/gameLoop.js

import { api } from './api.js';
import { gameState } from './gameState.js';
import { updateUI, handleApiError, appendMessageToStory, addRoundTitleToStory, renderInventory, updateBulkStatus } from './uiUpdater.js';
import * as modal from './modalManager.js';
import { gameTips } from './tips.js';
import * as interaction from './interactionHandlers.js';
import { dom } from './dom.js';

// ... (setLoading, handlePlayerDeath, startProactiveChat 保持不變) ...
const loadingDisclaimers = [
    "說書人掐指一算：此番推演約需二十至四十五息。若遇江湖新奇，則需額外十數息為其立傳建檔。",
    "天機運轉，世界演化...若初遇奇人、初探秘境，耗時或將近一分鐘，還望少俠耐心等候。",
    "我正為你鋪展前路，此刻切莫分心。若移步他處，恐致天機紊亂，因果錯亂，前功盡棄矣。",
    "江湖之大，變數無窮。為你編織全新際遇需耗心神，請稍安勿躁，莫要離開。",
    "緣法交織，命途展開...為保推演無誤，請留在此畫面，靜候佳音。"
];

let tipInterval = null;
let disclaimerInterval = null;

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
            // 【核心修改】優先顯示上一回合的內心獨白
            if (gameState.roundData && gameState.roundData.PSY) {
                if (loaderDisclaimerElement) {
                    // 使用 <pre> 標籤保留可能的格式，並用<em>使其更突出
                    loaderDisclaimerElement.innerHTML = `【前情回憶】<em>「${gameState.roundData.PSY}」</em>`;
                }
                // 如果顯示了PSY，則不啟動隨機提示的計時器
                if (disclaimerInterval) {
                    clearInterval(disclaimerInterval);
                    disclaimerInterval = null;
                }
            } else {
                // 如果沒有PSY，則退回原來的隨機提示邏輯
                const rotateDisclaimer = () => {
                    if (loadingDisclaimers.length > 0) {
                        const randomIndex = Math.floor(Math.random() * loadingDisclaimers.length);
                        if(loaderDisclaimerElement) {
                            loaderDisclaimerElement.innerHTML = loadingDisclaimers.sort(() => 0.5 - Math.random())[0];
                        }
                    }
                };
                rotateDisclaimer();
                disclaimerInterval = setInterval(rotateDisclaimer, 10000);
            }

            const rotateTip = () => {
                if (gameTips.length > 0) {
                    const randomIndex = Math.floor(Math.random() * gameTips.length);
                    if (loaderTipElement) {
                        loaderTipElement.innerHTML = gameTips.length > 0 ? gameTips.sort(() => 0.5 - Math.random())[0] : '';
                    }
                }
            };
            rotateTip();
            tipInterval = setInterval(rotateTip, 10000);

        } else {
            clearInterval(tipInterval);
            if(disclaimerInterval) {
                 clearInterval(disclaimerInterval);
                 disclaimerInterval = null;
            }
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
        appendMessageToStory(`【系統】${npcName}似乎想對你說些什麼，但你沒有聽清。`, 'system-message');
    }
}


/**
 * 【核心重構 v2.0 - 前端水合】
 * 處理從後端傳來的精簡數據包，並更新本地的 `gameState`
 * @param {object} data - 後端回傳的精簡數據包
 */
export async function processNewRoundData(data) {
    if (!data.roundData) {
        console.error("收到了無效的回合數據！", data);
        return;
    }
    
    // 將新回合的建議儲存起來，準備在UI更新後顯示
    const newSuggestion = data.suggestion || "江湖之大，何處不可去得？";
    data.roundData.suggestion = newSuggestion;

    // 將新回合的標題加入故事面板
    addRoundTitleToStory(data.roundData.EVT || `第 ${data.roundData.R} 回`);

    // --- 本地 gameState 水合開始 ---
    // 1. 更新核心數值
    if (data.roundData.powerChange) {
        gameState.roundData.internalPower += data.roundData.powerChange.internal || 0;
        gameState.roundData.externalPower += data.roundData.powerChange.external || 0;
        gameState.roundData.lightness += data.roundData.powerChange.lightness || 0;
    }
    if (data.roundData.moralityChange) {
        gameState.roundData.morality += data.roundData.moralityChange;
    }
    gameState.roundData.stamina = data.roundData.stamina;

    // 2. 更新物品 (這部分比較複雜，暫時先完全替換)
    if(data.inventory) {
        gameState.roundData.inventory = data.inventory;
    }

    // 3. 【優化】只更新變動的NPC，而不是替換整個列表
    if (data.roundData.NPC && Array.isArray(data.roundData.NPC)) {
        data.roundData.NPC.forEach(updatedNpc => {
            const existingNpcIndex = gameState.roundData.NPC.findIndex(npc => npc.name === updatedNpc.name);
            if (existingNpcIndex > -1) {
                // 如果NPC已存在，則更新
                Object.assign(gameState.roundData.NPC[existingNpcIndex], updatedNpc);
            } else {
                // 如果是新NPC，則新增
                gameState.roundData.NPC.push(updatedNpc);
            }
        });
        // 過濾掉已死亡的NPC
        gameState.roundData.NPC = gameState.roundData.NPC.filter(npc => !npc.isDeceased);
    }
    
    // 4. 將其他資訊直接覆蓋到本地gameState
    Object.assign(gameState.roundData, data.roundData);
    gameState.currentRound = data.roundData.R;

    // 5. 如果有地點數據，則更新
    if (data.locationData) {
        gameState.currentLocationData = data.locationData;
    }
    // --- 本地 gameState 水合結束 ---
    
    // 使用水合後的、最新的 gameState.roundData 來更新UI
    updateUI(data.story, gameState.roundData, data.randomEvent, gameState.currentLocationData);

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
        
        // 【核心修改】收到後端數據後，交給新的處理函式
        if (data && data.roundData) {
            // 在處理新回合數據前，先獲取一次完整的背包狀態並更新
            // 這是因為後端可能只回傳了變化，前端需要一個完整的基準來應用這些變化
            const fullInventory = await api.getInventory();
            data.inventory = fullInventory;
            processNewRoundData(data);
        } else {
            throw new Error("從伺服器收到的回應格式不正確。");
        }

        if (data.combatInfo && data.combatInfo.status === 'COMBAT_START') {
            interaction.startCombat(data.combatInfo.initialState);
        }

    } catch (error) {
        console.error('API 錯誤或通訊中斷:', error);
        const errorMessage = error.message.replace(/\n/g, '<br>');
        const cultivationErrorKeywords = ["閉關", "靜修", "修行", "糧食飲水不足", "身心俱疲", "尚未習得", "身無長技", "身負數門絕學", "人多嘴雜"];
        const isCultivationError = cultivationErrorKeywords.some(keyword => errorMessage.includes(keyword));
        if (isCultivationError) {
            appendMessageToStory(`<div class="cultivation-error">${errorMessage}</div>`, 'system-message');
        } else {
            appendMessageToStory(`【系統提示】<br>${errorMessage}`, 'system-message');
        }
    } finally {
        if (!document.getElementById('epilogue-modal').classList.contains('visible') && !gameState.isInChat) {
             setLoading(false);
        }
    }
}


// 初始載入遊戲的邏輯保持不變
export async function loadInitialGame() {
    setLoading(true, '正在連接你的世界，讀取記憶中...');
    try {
        const data = await api.getLatestGame();
        dom.storyTextContainer.innerHTML = '';
        if (data.gameState === 'deceased') {
            if(data.roundData) {
                if (data.locationData) gameState.currentLocationData = data.locationData;
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
            // 【核心修改】將完整的初始數據賦予給本地 gameState
            gameState.roundData = data.roundData;
            gameState.currentLocationData = data.locationData;
            gameState.currentRound = data.roundData.R;
            // 使用初始數據更新UI
            updateUI(data.story, data.roundData, null, data.locationData);
            updateBountyButton(data.hasNewBounties);
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
