// scripts/main.js

import * as gameLoop from './gameLoop.js';
import * as interaction from './interactionHandlers.js';
import * as modal from './modalManager.js';
import { initializeGmPanel } from './gmManager.js';
import { gameState } from './gameState.js';
import { initializeDOM, dom } from './dom.js';
import { api } from './api.js';
import { handleApiError, renderInventory, updateBulkStatus, appendMessageToStory } from './uiUpdater.js';
import { ensureLocalPreviewAuthSession, isLocalPreviewMockEnabled } from './localPreviewMode.js';


interaction.setGameLoop(gameLoop);

document.addEventListener('DOMContentLoaded', () => {
    ensureLocalPreviewAuthSession();

    const token = localStorage.getItem('jwt_token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    initializeDOM();

    if (isLocalPreviewMockEnabled()) {
        console.info('[Local Preview] Mock API mode enabled for localhost preview.');
    }

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

    // 【核心修改】重新獲取閉關彈窗的所有元素
    const cultivationModal = document.getElementById('cultivation-modal');
    const openCultivationBtn = document.getElementById('open-cultivation-btn');
    const closeCultivationBtn = document.getElementById('close-cultivation-btn');
    const skillSelect = document.getElementById('cultivation-skill-select');
    const daysInput = document.getElementById('cultivation-days-input'); // 現在是 range slider
    const daysDisplay = document.getElementById('cultivation-days-display'); // 新增的天數顯示標籤
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

    // --- 【核心修改 v2.0】閉關系統相關函式 ---
    function updateCultivationConditions() {
        if (!gameState.roundData || !cultivationModal.classList.contains('visible')) return;

        const { currentLocationData, roundData } = gameState;
        const days = parseInt(daysInput.value, 10);

        // 更新天數顯示
        if(daysDisplay) daysDisplay.textContent = `${days} 天`;

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
            daysInput.value = 1; // 每次打開時重置為1天
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
        if (!days || days <= 0) {
            alert('請選擇有效的閉關天數。');
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
        // ... (initialize 函式中的其他事件綁定保持不變) ...
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
            const isCollapsed = dom.storyHeader.classList.toggle('collapsed');
            dom.headerToggleButton.setAttribute('aria-expanded', String(!isCollapsed));
            dom.headerToggleButton.title = isCollapsed ? '展開資訊欄' : '收起資訊欄';
            dom.headerToggleButton.setAttribute('aria-label', isCollapsed ? '展開日期與時辰資訊欄' : '收起日期與時辰資訊欄');
        });

        const menuToggleIcon = dom.menuToggle?.querySelector('i');
        const setSidebarOpenState = (isOpen) => {
            dom.gameContainer.classList.toggle('sidebar-open', isOpen);
            if (dom.menuToggle) {
                dom.menuToggle.setAttribute('aria-expanded', String(isOpen));
                dom.menuToggle.title = isOpen ? '收起右側欄' : '展開右側欄';
                dom.menuToggle.setAttribute('aria-label', isOpen ? '收起右側欄' : '展開右側欄');
            }
            if (menuToggleIcon) {
                menuToggleIcon.classList.toggle('fa-bars', !isOpen);
                menuToggleIcon.classList.toggle('fa-xmark', isOpen);
            }
        };
        setSidebarOpenState(dom.gameContainer.classList.contains('sidebar-open'));

        dom.menuToggle.addEventListener('click', () => {
            const willOpen = !dom.gameContainer.classList.contains('sidebar-open');
            setSidebarOpenState(willOpen);
        });

        dom.mainContent.addEventListener('click', (e) => {
            if (e.target !== dom.mainContent) return;
            if (window.innerWidth <= 1024 && dom.gameContainer.classList.contains('sidebar-open')) {
                setSidebarOpenState(false);
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
        
        // --- 【核心修改 v2.0】為閉關系統綁定事件 ---
        if (openCultivationBtn) openCultivationBtn.addEventListener('click', openCultivationModal);
        if (closeCultivationBtn) closeCultivationBtn.addEventListener('click', () => cultivationModal.classList.remove('visible'));
        if (skillSelect) skillSelect.addEventListener('change', updateCultivationConditions);
        if (daysInput) { // 現在監聽 slider 的 input 事件
            daysInput.addEventListener('input', updateCultivationConditions);
        }
        if (startCultivationBtn) startCultivationBtn.addEventListener('click', handleStartCultivation);

        setGameContainerHeight();
        window.addEventListener('resize', setGameContainerHeight);

        gameLoop.loadInitialGame();
    }

    initialize();
});
