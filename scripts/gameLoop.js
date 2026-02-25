// scripts/gameLoop.js

import { api } from './api.js';
import { gameState } from './gameState.js';
import { updateUI, handleApiError, appendMessageToStory, addRoundTitleToStory, renderInventory, updateBulkStatus } from './uiUpdater.js';
import * as modal from './modalManager.js';
import { gameTips } from './tips.js';
import * as interaction from './interactionHandlers.js';
import { dom } from './dom.js';

// ... (setLoading, handlePlayerDeath, startProactiveChat ????????) ...
const loadingDisclaimers = [
    '正在連接你的世界，讀取記憶中...',
    '江湖傳聞正在匯聚...',
    '整理命運線索與人物動向...',
    '世界狀態更新中，請稍候...',
    '正在準備下一回合...'
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
    dom.submitButton.textContent = isLoading ? '送出中...' : '送出';
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
            // ???????????????????????????????????????????????????
            if (gameState.roundData && gameState.roundData.PSY) {
                if (loaderDisclaimerElement) {
                    // ???????<pre> ??????獢豱??????????????????????????????em>???偃??????????
                    loaderDisclaimerElement.innerHTML = `???????????????em>??{gameState.roundData.PSY}??/em>`;
                }
                // ?????????????????????????????????????????????
                if (disclaimerInterval) {
                    clearInterval(disclaimerInterval);
                    disclaimerInterval = null;
                }
            } else {
                // ????????PSY???????????????????????????????????
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
    modal.showEpilogueModal('<div class="loading-placeholder"><p>?????????????????????????潸縐?????..</p><div class="loader-dots"><span></span><span></span><span></span></div></div>', () => {
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
            throw new Error('載入結局失敗。');
        }
    } catch (error) {
        modal.showEpilogueModal(`<p class="system-message">???????????????????????????????????????..<br>(${error.message})</p>`, () => {
            modal.showDeceasedScreen();
        });
        console.error("???????????:", error);
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
            const itemNames = itemChanges.map((item) => String(item.itemName) + ' x' + String(item.quantity)).join(', ');
            const giftMessage = `系統：${npcName} 給了你 ${itemNames}。`;
            modal.appendChatMessage('system', giftMessage);
            gameState.chatHistory.push({ speaker: 'system', message: giftMessage });
        }

        dom.chatInput.focus();
    } catch (error) {
        console.error(`?????${npcName} ?????????????`, error);
        appendMessageToStory(`與 ${npcName} 的主動對話啟動失敗。`, 'system-message');
    }
}


/**
 * ?????????????v2.0 - ????畾???????選??????
 * ??????謏???????????????????????????????????????????? `gameState`
 * @param {object} data - ???????????謅???∴???????????????
 */
export async function processNewRoundData(data) {
    if (!data.roundData) {
        console.error('API 回應缺少 roundData', data);
        return;
    }
    
    // ??????????????????????????????雓??????????????選??????????????????????????
    const newSuggestion = data.suggestion || "???????????????????????????謏????";
    data.roundData.suggestion = newSuggestion;

    // ????????????????????????????????
    addRoundTitleToStory(data.roundData.EVT || `第${data.roundData.R}回合`);

    // --- ????? gameState ????選??????? ---
    // 1. ??????????????寧圾??

    // 2. ???????? (????????瞏剜????????????????????data.inventory ??????????????????????????????
    if(data.inventory) {
        gameState.roundData.inventory = data.inventory;
    } else {
        console.warn('[同步] API 回應缺少 inventory，保留現有背包資料。');
    }

    // 3. ????????瞏剜?????????????????????秋?????????????????Ⅹ????????
    if (data.roundData.NPC && Array.isArray(data.roundData.NPC)) {
        data.roundData.NPC.forEach(updatedNpc => {
            const existingNpcIndex = gameState.roundData.NPC.findIndex(npc => npc.name === updatedNpc.name);
            if (existingNpcIndex > -1) {
                // ????NPC??????????????
                Object.assign(gameState.roundData.NPC[existingNpcIndex], updatedNpc);
            } else {
                // ??????????????????????
                gameState.roundData.NPC.push(updatedNpc);
            }
        });
        // ????雓????????????????秋??
        gameState.roundData.NPC = gameState.roundData.NPC.filter(npc => !npc.isDeceased);
    }
    
    // 4. ????????????選????????????????????gameState
    Object.assign(gameState.roundData, data.roundData);
    gameState.currentRound = data.roundData.R;

    // 5. ???????????謏?????????????
    if (data.locationData) {
        gameState.currentLocationData = data.locationData;
    }
    // --- ????? gameState ????選???????? ---
    
    // ?????????????????????? gameState.roundData ???????????
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

    setLoading(true, '正在處理你的行動...');
    appendMessageToStory(`> ${actionText}`, 'player-action-log');

    try {
        const data = await api.interact({
            action: actionText,
            round: gameState.currentRound,
            model: dom.aiModelSelector.value
        });
        
        // ????????????????????????????????????????????????????????
        if (data && data.roundData) {
            // ????????????瞏剜????????????????? await api.getInventory(); ???????????
            // ????????????????????????????蹓??????桀?????processNewRoundData
            processNewRoundData(data);
        } else {
            throw new Error('API 未回傳有效的 roundData。');
        }

        if (data.combatInfo && data.combatInfo.status === 'COMBAT_START') {
            interaction.startCombat(data.combatInfo.initialState);
        }

    } catch (error) {
        console.error('API ?????????????????', error);
        const errorMessage = String(error.message || '');
        const cultivationErrorKeywords = ['cultivation', 'training', 'stamina', 'internal', 'external', 'lightness'];
        const isCultivationError = cultivationErrorKeywords.some(keyword => errorMessage.includes(keyword));
        if (isCultivationError) {
            appendMessageToStory(errorMessage, 'system-message cultivation-error');
        } else {
            appendMessageToStory('操作失敗：' + errorMessage, 'system-message');
        }
    } finally {
        if (!document.getElementById('epilogue-modal').classList.contains('visible') && !gameState.isInChat) {
             setLoading(false);
        }
    }
}


// ??????獢??????????????獢?????????
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
                prequelDiv.innerHTML = `<h3>??????</h3><p>${data.prequel.replace(/\n/g, '<br>')}</p>`;
                dom.storyTextContainer.appendChild(prequelDiv);
            }
            // ?????????????????????????????????????????????? gameState
            gameState.roundData = data.roundData;
            gameState.currentLocationData = data.locationData;
            gameState.currentRound = data.roundData.R;
            // ?????????????????UI
            updateUI(data.story, data.roundData, null, data.locationData);
            updateBountyButton(data.hasNewBounties);
        }
    } catch (error) {
        handleApiError(error);
    }
    finally {
         if (!document.getElementById('epilogue-modal').classList.contains('visible')) {
             setLoading(false);
        }
    }
}
