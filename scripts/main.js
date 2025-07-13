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

    function setGameContainerHeight() {
        if (dom.gameContainer) {
            dom.gameContainer.style.height = `${window.innerHeight}px`;
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
                    updateUI(data.story, data.roundData, null, data.locationData);
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
        
        // 【核心新增】為地區資訊卡片添加事件委託，以處理動態生成的按鈕
        const locationInfoContainer = document.getElementById('location-info');
        if (locationInfoContainer) {
            locationInfoContainer.addEventListener('click', (e) => {
                const button = e.target.closest('#view-location-details-btn');
                if (button) {
                    if (gameState.currentLocationData) {
                        modal.openLocationDetailsModal(gameState.currentLocationData);
                    } else {
                        alert("當前地區的詳細情報尚未載入。");
                    }
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

        setGameContainerHeight();
        window.addEventListener('resize', setGameContainerHeight);

        gameLoop.loadInitialGame();
    }

    initialize();
});
