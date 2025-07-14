// scripts/main.js

import * as gameLoop from './gameLoop.js';
import * as interaction from './interactionHandlers.js';
import * as modal from './modalManager.js';
import { initializeGmPanel } from './gmManager.js';
import { gameState } from './gameState.js'; 
import { initializeDOM, dom } from './dom.js'; 
import { api } from './api.js';

interaction.setGameLoop(gameLoop);

document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('jwt_token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    initializeDOM();

    const username = localStorage.getItem('username');
    if (dom.playerInput && username) {
        dom.playerInput.placeholder = `${username}接下來...`;
    } else if (dom.playerInput) {
        dom.playerInput.placeholder = '接下來...';
    }
    
    // 【核心新增】獲取新彈窗的元素
    const itemDetailsModal = document.getElementById('item-details-modal');
    const itemDetailsTitle = document.getElementById('item-details-title');
    const itemDetailsDescription = document.getElementById('item-details-description');
    const itemDetailsStats = document.getElementById('item-details-stats');
    const itemDetailsDeleteBtn = document.getElementById('item-details-delete-btn');
    const closeItemDetailsBtn = document.getElementById('close-item-details-btn');

    function setGameContainerHeight() {
        if (dom.gameContainer) {
            dom.gameContainer.style.height = `${window.innerHeight}px`;
        }
    }
    
    // 【核心新增】打開物品詳情彈窗的函式
    function openItemDetailsModal(itemId) {
        if (!itemDetailsModal || !gameState.roundData || !gameState.roundData.inventory) return;
        
        const item = gameState.roundData.inventory.find(i => i.instanceId === itemId);
        if (!item) {
            console.error(`找不到 ID 為 ${itemId} 的物品。`);
            return;
        }

        itemDetailsTitle.textContent = item.itemName || '未知物品';
        itemDetailsDescription.textContent = item.baseDescription || '這是一個神秘的物品，沒有任何描述。';
        
        let statsHtml = '';
        statsHtml += `<li><span class="key">類型</span> <span class="value">${item.itemType || '未知'}</span></li>`;
        statsHtml += `<li><span class="key">價值</span> <span class="value">${item.value || 0} 銀兩</span></li>`;
        statsHtml += `<li><span class="key">份量</span> <span class="value">${item.bulk || '中'}</span></li>`;
        if (item.stats) {
            if (item.stats.attack > 0) statsHtml += `<li><span class="key">攻擊</span> <span class="value">${item.stats.attack}</span></li>`;
            if (item.stats.defense > 0) statsHtml += `<li><span class="key">防禦</span> <span class="value">${item.stats.defense}</span></li>`;
        }
        itemDetailsStats.innerHTML = statsHtml;
        
        // 為了避免重複綁定事件，先移除舊的，再綁定新的
        const newDeleteBtn = itemDetailsDeleteBtn.cloneNode(true);
        itemDetailsDeleteBtn.parentNode.replaceChild(newDeleteBtn, itemDetailsDeleteBtn);
        newDeleteBtn.dataset.itemId = itemId; // 將ID存到按鈕上
        newDeleteBtn.addEventListener('click', handleDropItemClick);

        itemDetailsModal.classList.add('visible');
    }
    
    // 【核心新增】關閉物品詳情彈窗的函式
    function closeItemDetailsModal() {
        if (itemDetailsModal) {
            itemDetailsModal.classList.remove('visible');
        }
    }
    
    // 【核心新增】處理丟棄物品按鈕點擊的函式
    async function handleDropItemClick(event) {
        const itemId = event.currentTarget.dataset.itemId;
        if (!itemId) return;

        if (confirm(`你確定要永久丟棄這個物品嗎？此操作無法復原。`)) {
            closeItemDetailsModal();
            gameLoop.setLoading(true, '正在丟棄物品...');
            try {
                const result = await api.dropItem({ itemId });
                if (result.success) {
                    // 使用後端回傳的最新數據更新遊戲狀態和UI
                    gameState.roundData.inventory = result.inventory;
                    gameState.roundData.bulkScore = result.bulkScore;
                    gameLoop.appendMessageToStory(result.message, 'system-message');
                    modal.updateUI(null, gameState.roundData, null, gameState.currentLocationData);
                } else {
                    throw new Error(result.message);
                }
            } catch(error) {
                gameLoop.handleApiError(error);
            } finally {
                gameLoop.setLoading(false);
            }
        }
    }


    function initialize() {
        let currentTheme = localStorage.getItem('game_theme') || 'light';
        const themeIcon = dom.themeSwitcher.querySelector('i');
        document.body.className = `${currentTheme}-theme`;
        themeIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        
        dom.themeSwitcher.addEventListener('click', () => {
            currentTheme = (document.body.classList.contains('light-theme')) ? 'dark' : 'light';
            localStorage.setItem('game_theme', currentTheme);
            document.body.className = `${currentTheme}-theme`;
            themeIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        });

        dom.headerToggleButton.addEventListener('click', () => {
            dom.storyHeader.classList.toggle('collapsed');
            dom.headerToggleButton.querySelector('i').classList.toggle('fa-chevron-up');
            dom.headerToggleButton.querySelector('i').classList.toggle('fa-chevron-down');
        });

        dom.menuToggle.addEventListener('click', () => dom.gameContainer.classList.toggle('sidebar-open'));
        
        dom.logoutButton.addEventListener('click', () => {
            localStorage.removeItem('jwt_token');
            localStorage.removeItem('username');
            window.location.href = 'login.html';
        });
        
        dom.suicideButton.addEventListener('click', async () => {
            interaction.hideNpcInteractionMenu();
            if (gameState.isRequesting) return;
            if (window.confirm("你確定要了卻此生，讓名號永載史冊嗎？")) { 
                gameLoop.setLoading(true, '英雄末路，傳奇落幕...');
                try {
                    const data = await api.forceSuicide({ model: dom.aiModelSelector.value });
                    gameLoop.processNewRoundData(data);
                    gameLoop.handlePlayerDeath();
                } catch (error) {
                    handleApiError(error);
                    gameLoop.setLoading(false);
                }
            }
        });

        if (dom.skillsBtn) {
            dom.skillsBtn.addEventListener('click', async () => {
                interaction.hideNpcInteractionMenu();
                if (gameState.isRequesting) return;
                gameLoop.setLoading(true, '獲取武學資料...');
                try {
                    const skills = await api.getSkills();
                    modal.openSkillsModal(skills);
                } catch (error) {
                    handleApiError(error);
                } finally {
                    gameLoop.setLoading(false);
                }
            });
        }
        
        if (dom.bountiesBtn) {
            dom.bountiesBtn.addEventListener('click', () => {
                interaction.hideNpcInteractionMenu();
                dom.bountiesBtn.classList.remove('has-new-bounty');
            });
        }
        
        const dashboardContent = document.querySelector('.dashboard-content');
        if (dashboardContent) {
            dashboardContent.addEventListener('click', (e) => {
                const locationBtn = e.target.closest('#view-location-details-btn');
                if (locationBtn) {
                    if (gameState.currentLocationData) {
                        modal.openLocationDetailsModal(gameState.currentLocationData);
                    } else {
                        alert("當前地區的詳細情報尚未載入。");
                    }
                }
                
                // 【核心新增】使用事件委託處理物品連結點擊
                const itemLink = e.target.closest('.item-link');
                if(itemLink) {
                    e.preventDefault();
                    const itemId = itemLink.dataset.itemId;
                    openItemDetailsModal(itemId);
                }
            });
        }
        
        initializeGmPanel(dom.gmPanel, dom.gmCloseBtn, dom.gmMenu, dom.gmContent);

        dom.submitButton.addEventListener('click', gameLoop.handlePlayerAction);
        dom.playerInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); gameLoop.handlePlayerAction(); } });
        
        document.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'combat-confirm-btn') {
                interaction.handleConfirmCombatAction();
            }
        });

        dom.storyPanel.addEventListener('click', interaction.handleNpcClick);

        dom.chatActionBtn.addEventListener('click', interaction.sendChatMessage);
        dom.chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); interaction.sendChatMessage(); } });
        
        dom.closeChatBtn.addEventListener('click', () => {
             gameState.isInChat = false;
             gameState.currentChatNpc = null;
             gameState.chatHistory = [];
             modal.closeChatModal();
             gameLoop.setLoading(false); 
        });
        dom.endChatBtn.addEventListener('click', interaction.endChatSession);

        dom.giveItemBtn.addEventListener('click', () => {
            if (gameState.isInChat && gameState.currentChatNpc) {
                modal.openGiveItemModal(gameState.currentChatNpc, interaction.handleGiveItem);
            }
        });

        dom.cancelGiveBtn.addEventListener('click', modal.closeGiveItemModal);
        dom.closeSkillsBtn.addEventListener('click', modal.closeSkillsModal);
        
        if(dom.closeLocationDetailsBtn) {
            dom.closeLocationDetailsBtn.addEventListener('click', modal.closeLocationDetailsModal);
        }
        if(dom.locationDetailsModal) {
            dom.locationDetailsModal.addEventListener('click', (e) => {
                if(e.target === dom.locationDetailsModal) {
                    modal.closeLocationDetailsModal();
                }
            });
        }
        
        // 【核心新增】為物品詳情彈窗綁定關閉事件
        if(closeItemDetailsBtn) {
            closeItemDetailsBtn.addEventListener('click', closeItemDetailsModal);
        }
        if(itemDetailsModal) {
            itemDetailsModal.addEventListener('click', (e) => {
                if(e.target === itemDetailsModal) {
                    closeItemDetailsModal();
                }
            });
        }

        setGameContainerHeight();
        window.addEventListener('resize', setGameContainerHeight);

        gameLoop.loadInitialGame();
    }

    initialize();
});
