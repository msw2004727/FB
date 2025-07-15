// scripts/main.js

import * as gameLoop from './gameLoop.js';
import * as interaction from './interactionHandlers.js';
import * as modal from './modalManager.js';
import { initializeGmPanel } from './gmManager.js';
import { gameState } from './gameState.js';
import { initializeDOM, dom } from './dom.js';
import { api } from './api.js';
import { handleApiError, renderInventory, updateBulkStatus, appendMessageToStory } from './uiUpdater.js';


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

    const itemDetailsModal = document.getElementById('item-details-modal');
    const itemDetailsTitle = document.getElementById('item-details-title');
    const itemDetailsDescription = document.getElementById('item-details-description');
    const itemDetailsStats = document.getElementById('item-details-stats');
    const itemDetailsDeleteBtn = document.getElementById('item-details-delete-btn');
    const closeItemDetailsBtn = document.getElementById('close-item-details-btn');

    // 【核心新增】獲取閉關彈窗的所有元素
    const cultivationModal = document.getElementById('cultivation-modal');
    const openCultivationBtn = document.getElementById('open-cultivation-btn');
    const closeCultivationBtn = document.getElementById('close-cultivation-btn');
    const skillSelect = document.getElementById('cultivation-skill-select');
    const daysSelector = document.querySelector('.cultivation-days-selector');
    const daysInput = document.getElementById('cultivation-days-input');
    const startCultivationBtn = document.getElementById('start-cultivation-btn');
    const reqLocation = document.getElementById('req-location');
    const reqStamina = document.getElementById('req-stamina');
    const reqFood = document.getElementById('req-food');

    function setGameContainerHeight() {
        if (dom.gameContainer) {
            dom.gameContainer.style.height = `${window.innerHeight}px`;
        }
    }

    function openItemDetailsModal(itemId) {
        if (!itemDetailsModal || !gameState.roundData || !gameState.roundData.inventory) return;

        const item = gameState.roundData.inventory.find(i => i.instanceId === itemId);
        if (!item) {
            appendMessageToStory(`在你的背包中找不到ID為 ${itemId} 的物品。`, 'system-message');
            console.error(`在遊戲狀態中找不到 ID 為 ${itemId} 的物品。`);
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

        itemDetailsDeleteBtn.dataset.itemId = itemId;

        itemDetailsModal.classList.add('visible');
    }

    function closeItemDetailsModal() {
        if (itemDetailsModal) {
            itemDetailsModal.classList.remove('visible');
        }
    }

    async function handleDropItemClick(event) {
        const itemId = event.currentTarget.dataset.itemId;
        if (!itemId) return;

        if (confirm(`你確定要永久丟棄「${itemDetailsTitle.textContent}」嗎？此操作無法復原。`)) {
            closeItemDetailsModal();
            gameLoop.setLoading(true, '正在丟棄物品...');
            try {
                const result = await api.dropItem({ itemId });
                if (result.success) {
                    gameState.roundData.inventory = result.inventory;
                    gameState.roundData.bulkScore = result.bulkScore;
                    appendMessageToStory(result.message, 'system-message');
                    renderInventory(gameState.roundData.inventory);
                    updateBulkStatus(gameState.roundData.bulkScore);
                } else {
                    throw new Error(result.message);
                }
            } catch (error) {
                handleApiError(error);
            } finally {
                gameLoop.setLoading(false);
            }
        }
    }

    // --- 【核心新增】閉關系統相關函式 ---
    function updateCultivationConditions() {
        if (!gameState.roundData || !cultivationModal.classList.contains('visible')) return;

        const { currentLocationData, roundData } = gameState;
        const days = parseInt(daysInput.value, 10);

        // 條件1: 私密地點
        const isPrivate = currentLocationData?.isPrivate === true;
        reqLocation.innerHTML = `<i class="fas ${isPrivate ? 'fa-check-circle' : 'fa-times-circle'}"></i> 需身處私密地點 (${isPrivate ? '達成' : '未達成'})`;

        // 條件2: 精力
        const staminaSufficient = roundData.stamina >= 80;
        reqStamina.innerHTML = `<i class="fas ${staminaSufficient ? 'fa-check-circle' : 'fa-times-circle'}"></i> 精力需高於80% (${roundData.stamina}%)`;

        // 條件3: 食物飲水
        const foodItems = roundData.inventory.filter(item => item.category === '食物');
        const drinkItems = roundData.inventory.filter(item => item.category === '飲品');
        const totalFood = foodItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
        const totalDrinks = drinkItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
        const resourcesSufficient = totalFood >= days && totalDrinks >= days;
        reqFood.innerHTML = `<i class="fas ${resourcesSufficient ? 'fa-check-circle' : 'fa-times-circle'}"></i> 需備足糧食飲水 (需${days}份, 備有${totalFood}糧/${totalDrinks}水)`;
        
        // 最終判斷
        startCultivationBtn.disabled = !(isPrivate && staminaSufficient && resourcesSufficient);
    }

    async function openCultivationModal() {
        modal.closeSkillsModal();
        cultivationModal.classList.add('visible');
        skillSelect.innerHTML = '<option>載入武學中...</option>';
        startCultivationBtn.disabled = true;

        try {
            const skills = await api.getSkills();
            if (skills && skills.length > 0) {
                skillSelect.innerHTML = skills.map(s => `<option value="${s.skillName}">${s.skillName} (Lv.${s.level})</option>`).join('');
            } else {
                skillSelect.innerHTML = '<option value="">無任何可修練的武學</option>';
            }
        } catch (error) {
            handleApiError(error);
            skillSelect.innerHTML = '<option value="">讀取武學失敗</option>';
        } finally {
            updateCultivationConditions();
        }
    }
    
    async function handleStartCultivation() {
        if (startCultivationBtn.disabled || gameState.isRequesting) return;

        const skillName = skillSelect.value;
        const days = parseInt(daysInput.value, 10);

        if (!skillName) {
            alert('請選擇一門要修練的武學。');
            return;
        }

        cultivationModal.classList.remove('visible');
        gameLoop.setLoading(true, `正在閉關修練 ${skillName}，預計耗時${days}日...`);
        
        try {
            const result = await api.startCultivation({ skillName, days });
            if (result.success) {
                gameLoop.processNewRoundData(result);
            } else {
                throw new Error(result.message);
            }
        } catch (error) {
            handleApiError(error);
        } finally {
            gameLoop.setLoading(false);
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

        dom.mainContent.addEventListener('click', () => {
            if (window.innerWidth <= 1024 && dom.gameContainer.classList.contains('sidebar-open')) {
                dom.gameContainer.classList.remove('sidebar-open');
            }
        });

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
        
        document.addEventListener('click', (e) => {
            const locationBtn = e.target.closest('#view-location-details-btn');
            if (locationBtn) {
                if (gameState.currentLocationData) {
                    modal.openLocationDetailsModal(gameState.currentLocationData);
                } else {
                    alert("當前地區的詳細情報尚未載入。");
                }
            }

            const itemLink = e.target.closest('.item-link');
            if (itemLink) {
                e.preventDefault();
                const itemId = itemLink.dataset.itemId;
                if (itemId) {
                    openItemDetailsModal(itemId);
                }
            }
        });

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

        if (dom.closeLocationDetailsBtn) {
            dom.closeLocationDetailsBtn.addEventListener('click', modal.closeLocationDetailsModal);
        }
        if (dom.locationDetailsModal) {
            dom.locationDetailsModal.addEventListener('click', (e) => {
                if (e.target === dom.locationDetailsModal) {
                    modal.closeLocationDetailsModal();
                }
            });
        }

        if (closeItemDetailsBtn) {
            closeItemDetailsBtn.addEventListener('click', closeItemDetailsModal);
        }
        if (itemDetailsDeleteBtn) {
            itemDetailsDeleteBtn.addEventListener('click', handleDropItemClick);
        }
        if (itemDetailsModal) {
            itemDetailsModal.addEventListener('click', (e) => {
                if (e.target === itemDetailsModal) {
                    closeItemDetailsModal();
                }
            });
        }
        
        // --- 【核心新增】為閉關系統綁定事件 ---
        if (openCultivationBtn) openCultivationBtn.addEventListener('click', openCultivationModal);
        if (closeCultivationBtn) closeCultivationBtn.addEventListener('click', () => cultivationModal.classList.remove('visible'));
        if (skillSelect) skillSelect.addEventListener('change', updateCultivationConditions);
        if (daysSelector) {
            daysSelector.addEventListener('click', (e) => {
                if (e.target.classList.contains('day-btn')) {
                    daysSelector.querySelectorAll('.day-btn').forEach(btn => btn.classList.remove('selected'));
                    e.target.classList.add('selected');
                    daysInput.value = e.target.dataset.days;
                    updateCultivationConditions();
                }
            });
            // 預設選中第一天
            daysSelector.querySelector('.day-btn[data-days="1"]').classList.add('selected');
        }
        if (startCultivationBtn) startCultivationBtn.addEventListener('click', handleStartCultivation);

        setGameContainerHeight();
        window.addEventListener('resize', setGameContainerHeight);

        gameLoop.loadInitialGame();
    }

    initialize();
});
