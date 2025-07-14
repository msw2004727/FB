// scripts/gameLoop.js

import { api } from './api.js';
import { gameState } from './gameState.js';
import { updateStory, updateDashboard, handleApiError, appendMessageToStory, addRoundTitleToStory } from './uiUpdater.js';
import * as modal from './modalManager.js';
import { gameTips } from './tips.js';
import * as interaction from './interactionHandlers.js';
import { dom } from './dom.js';

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
    // 【核心修改】調整載入提示文字
    dom.submitButton.textContent = isLoading ? '事態演變中...' : '動作';
    dom.chatInput.disabled = isLoading;
    dom.chatActionBtn.disabled = isLoading;
    dom.endChatBtn.disabled = isLoading;

    const combatSurrenderBtn = document.getElementById('combat-surrender-btn');
    if (combatSurrenderBtn) {
        combatSurrenderBtn.disabled = isLoading;
    }
    
    // 【核心修改】分離全局載入動畫與按鈕狀態
    const showGlobalLoader = gameState.isRequesting && !gameState.isInCombat && !gameState.isInChat && !document.getElementById('epilogue-modal').classList.contains('visible');

    if (showGlobalLoader) {
        const loaderTextElement = dom.aiThinkingLoader.querySelector('.loader-text');
        if (loaderTextElement) loaderTextElement.textContent = text || '江湖百曉生正在構思...';
        
        const rotateTip = () => { /* ... */ };
        const rotateDisclaimer = () => { /* ... */ };
        rotateTip();
        rotateDisclaimer();
        tipInterval = setInterval(rotateTip, 10000);
        disclaimerInterval = setInterval(rotateDisclaimer, 10000);

        dom.aiThinkingLoader.classList.add('visible');
    } else {
        clearInterval(tipInterval);
        clearInterval(disclaimerInterval);
        if (dom.aiThinkingLoader) dom.aiThinkingLoader.classList.remove('visible');
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
    // (此函式保持不變)
}

function processFinalData(data) {
    if (!data || !data.roundData) return;

    // 【核心修改】現在只處理數據更新
    updateDashboard(data.roundData, data.locationData);
    
    gameState.currentRound = data.roundData.R;
    gameState.roundData = data.roundData;
    gameState.currentLocationData = data.locationData;
    
    updateBountyButton(data.hasNewBounties);

    if (data.roundData.playerState === 'dead') {
        setLoading(false);
        handlePlayerDeath();
    }
}

// 【核心新增】輪詢函式，用於在背景等待數據更新完成
async function pollForCompletion(taskId, retries = 10, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await api.pollUpdate(taskId);
            if (response.status === 'completed') {
                console.log('[輪詢成功] 後端數據已處理完畢，正在更新儀表板...');
                processFinalData(response.data);
                setLoading(false); // 所有流程結束，解鎖UI
                return;
            } else if (response.status === 'error') {
                throw new Error(response.message || '後台處理任務時發生錯誤。');
            }
            // 如果狀態是 'processing'，則等待後繼續輪詢
        } catch (error) {
            // 處理輪詢本身的錯誤
            console.error(`[輪詢失敗] 第 ${i + 1} 次嘗試失敗:`, error);
            if (i === retries - 1) {
                handleApiError(new Error('與伺服器的數據同步超時，請刷新頁面再試。'));
                setLoading(false);
                return;
            }
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}


export async function handlePlayerAction() {
    interaction.hideNpcInteractionMenu();
    const actionText = dom.playerInput.value.trim();
    if (!actionText || gameState.isRequesting) return;

    dom.playerInput.value = '';

    const prequelElement = dom.storyTextContainer.querySelector('.prequel-summary');
    if (prequelElement) {
        dom.storyTextContainer.innerHTML = '';
    }

    // 【核心重構】兩階段加載流程
    // 1. 立即鎖定UI並顯示第一階段提示
    setLoading(true, '江湖百曉生正在構思...');
    appendMessageToStory(`> ${actionText}`, 'player-action-log');

    try {
        // 2. 發送交互請求，只期望獲得即時的劇情回應
        const initialResponse = await api.interact({
            action: actionText,
            round: gameState.currentRound,
            model: dom.aiModelSelector.value
        });

        // 3. 處理第一階段的回應
        if (initialResponse && initialResponse.status === 'processing') {
            // 立刻顯示劇情文字，但UI保持鎖定
            addRoundTitleToStory(`第 ${gameState.currentRound + 1} 回`);
            updateStory(initialResponse.story, initialResponse.suggestion);
            
            // 啟動後台輪詢來獲取最終的數據更新
            pollForCompletion(initialResponse.taskId);

        } else if (initialResponse && initialResponse.roundData) {
            // 對於某些直接返回完整數據的舊流程（如丐幫），直接處理
            processFinalData(initialResponse);
            setLoading(false);
        } else {
            throw new Error("從伺服器收到的回應格式不正確。");
        }

    } catch (error) {
        console.error('API 錯誤或通訊中斷:', error);
        handleApiError(error);
        setLoading(false); // 出錯時解鎖UI
    }
}

export async function loadInitialGame() {
    setLoading(true, '正在連接你的世界，讀取記憶中...');
    
    try {
        const data = await api.getLatestGame();
        
        dom.storyTextContainer.innerHTML = ''; 

        if (data.gameState === 'deceased') {
            if(data.roundData) {
                if (data.locationData) gameState.currentLocationData = data.locationData;
                updateDashboard(data.roundData, data.locationData);
            }
            handlePlayerDeath();
        } else {
            if (data.prequel) {
                const prequelDiv = document.createElement('div');
                prequelDiv.className = 'prequel-summary';
                prequelDiv.innerHTML = `<h3>前情提要</h3><p>${data.prequel.replace(/\n/g, '<br>')}</p>`;
                dom.storyTextContainer.appendChild(prequelDiv);
            }
            addRoundTitleToStory(data.roundData.EVT || `第 ${data.roundData.R} 回`);
            updateStory(data.story, data.suggestion, data.roundData);
            processFinalData(data);
        }
    } catch (error) {
        if (error.message.includes('找不到存檔')) {
            dom.storyTextContainer.innerHTML = '';
            const initialMessage = '你的旅程似乎尚未開始。請在下方輸入你的第一個動作，例如「睜開眼睛，環顧四周」。';
            const roundZeroData = { R: 0, EVT: '楔子', ATM: ['迷茫'], WRD: '未知', LOC: ['未知之地'], PC: '身體虛弱，內息紊亂', NPC: [], ITM: '行囊空空', QST: '', PSY: '我是誰...我在哪...', CLS: '', timeOfDay: '上午', internalPower: 5, externalPower: 5, lightness: 5, morality: 0, yearName: '元祐', year: 1, month: 1, day: 1, stamina: 100, suggestion: '先檢查一下自己的身體狀況吧。' };
            
            addRoundTitleToStory(roundZeroData.EVT);
            appendMessageToStory(initialMessage, 'system-message');
            updateDashboard(roundZeroData, null);
        } else {
            handleApiError(error);
        }
    } finally {
         if (!document.getElementById('epilogue-modal').classList.contains('visible')) {
             setLoading(false);
        }
    }
}
