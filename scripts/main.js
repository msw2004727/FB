// scripts/main.js

import * as gameLoop from './gameLoop.js';
import * as interaction from './interactionHandlers.js';
import * as modal from './modalManager.js';
import { initializeGmPanel } from './gmManager.js';
import { gameState } from './gameState.js'; 

// 【核心修改】將 gameLoop 中的函式傳遞給 interactionHandlers，建立連接
// 這樣 interactionHandlers 就可以呼叫 gameLoop 的函式了
interaction.setGameLoop({
    setLoading: (isLoading, text) => gameLoop.setLoading(isLoading, getDomElements(), text),
    processNewRoundData: (data) => gameLoop.processNewRoundData(data),
    handlePlayerDeath: () => gameLoop.handlePlayerDeath()
});

// 輔助函式，用於集中獲取DOM元素，避免重複查詢
function getDomElements() {
    return {
        playerInput: document.getElementById('player-input'),
        submitButton: document.getElementById('submit-button'),
        chatInput: document.getElementById('chat-input'),
        chatActionBtn: document.getElementById('chat-action-btn'),
        endChatBtn: document.getElementById('end-chat-btn'),
        combatSurrenderBtn: document.getElementById('combat-surrender-btn'),
        aiThinkingLoader: document.querySelector('.ai-thinking-loader'),
        storyTextContainer: document.getElementById('story-text-wrapper'),
        gmPanel: document.getElementById('gm-panel'),
        aiModelSelector: document.getElementById('ai-model-selector')
    };
}

document.addEventListener('DOMContentLoaded', () => {
    // --- 登入驗證 ---
    const token = localStorage.getItem('jwt_token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    // --- 【核心修改】在 DOM 載入後，一次性獲取所有元素 ---
    const dom = {
        storyHeader: document.querySelector('.story-header'),
        headerToggleButton: document.getElementById('header-toggle-btn'),
        playerInput: document.getElementById('player-input'),
        submitButton: document.getElementById('submit-button'),
        menuToggle: document.getElementById('menu-toggle'),
        gameContainer: document.querySelector('.game-container'),
        themeSwitcher: document.getElementById('theme-switcher'),
        logoutButton: document.getElementById('logout-btn'),
        suicideButton: document.getElementById('suicide-btn'),
        skillsBtn: document.getElementById('skills-btn'),
        bountiesBtn: document.getElementById('bounties-btn'),
        storyPanel: document.getElementById('story-panel'),
        chatInput: document.getElementById('chat-input'),
        chatActionBtn: document.getElementById('chat-action-btn'),
        closeChatBtn: document.getElementById('close-chat-btn'),
        endChatBtn: document.getElementById('end-chat-btn'),
        giveItemBtn: document.getElementById('give-item-btn'),
        cancelGiveBtn: document.getElementById('cancel-give-btn'),
        closeSkillsBtn: document.getElementById('close-skills-btn'),
        gmPanel: document.getElementById('gm-panel'),
        gmCloseBtn: document.getElementById('gm-close-btn'),
        gmMenu: document.getElementById('gm-menu'),
        gmContent: document.getElementById('gm-content'),
        aiModelSelector: document.getElementById('ai-model-selector'),
    };

    function setGameContainerHeight() {
        if (dom.gameContainer) {
            dom.gameContainer.style.height = `${window.innerHeight}px`;
        }
    }

    function initialize() {
        // 主題切換
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

        // 摺疊/展開儀表板
        dom.headerToggleButton.addEventListener('click', () => {
            dom.storyHeader.classList.toggle('collapsed');
            dom.headerToggleButton.querySelector('i').classList.toggle('fa-chevron-up');
            dom.headerToggleButton.querySelector('i').classList.toggle('fa-chevron-down');
        });

        // 手機側邊欄
        dom.menuToggle.addEventListener('click', () => dom.gameContainer.classList.toggle('sidebar-open'));
        
        // 登出
        dom.logoutButton.addEventListener('click', () => {
            localStorage.removeItem('jwt_token');
            localStorage.removeItem('username');
            window.location.href = 'login.html';
        });
        
        // 了卻此生
        dom.suicideButton.addEventListener('click', async () => {
            interaction.hideNpcInteractionMenu();
            if (gameState.isRequesting) return;
            if (window.confirm("你確定要了卻此生，讓名號永載史冊嗎？")) { 
                gameLoop.setLoading(true, getDomElements(), '英雄末路，傳奇落幕...');
                try {
                    const data = await api.forceSuicide({ model: dom.aiModelSelector.value });
                    updateUI(data.story, data.roundData, null, data.locationData);
                    gameLoop.handlePlayerDeath();
                } catch (error) {
                    handleApiError(error);
                    gameLoop.setLoading(false, getDomElements());
                }
            }
        });

        // 武學總覽
        if (dom.skillsBtn) {
            dom.skillsBtn.addEventListener('click', async () => {
                interaction.hideNpcInteractionMenu();
                if (gameState.isRequesting) return;
                gameLoop.setLoading(true, getDomElements(), '獲取武學資料...');
                try {
                    const skills = await api.getSkills();
                    modal.openSkillsModal(skills);
                } catch (error) {
                    handleApiError(error);
                } finally {
                    gameLoop.setLoading(false, getDomElements());
                }
            });
        }
        
        // 懸賞按鈕
        if (dom.bountiesBtn) {
            dom.bountiesBtn.addEventListener('click', () => {
                interaction.hideNpcInteractionMenu();
                updateBountyButton(false);
            });
        }
        
        // GM 面板
        initializeGmPanel(dom.gmPanel, dom.gmCloseBtn, dom.gmMenu, dom.gmContent);

        // 主要動作提交
        dom.submitButton.addEventListener('click', gameLoop.handlePlayerAction);
        dom.playerInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); gameLoop.handlePlayerAction(); } });
        
        // 戰鬥確認
        document.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'combat-confirm-btn') {
                interaction.handleConfirmCombatAction();
            }
        });

        // NPC 互動
        dom.storyPanel.addEventListener('click', interaction.handleNpcClick);

        // 聊天互動
        dom.chatActionBtn.addEventListener('click', interaction.sendChatMessage);
        dom.chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); interaction.sendChatMessage(); } });
        dom.closeChatBtn.addEventListener('click', () => {
             gameState.isInChat = false;
             gameState.currentChatNpc = null;
             gameState.chatHistory = [];
             modal.closeChatModal();
             gameLoop.setLoading(false, getDomElements()); 
        });
        dom.endChatBtn.addEventListener('click', interaction.endChatSession);

        // 贈予物品
        dom.giveItemBtn.addEventListener('click', () => {
            if (gameState.isInChat && gameState.currentChatNpc) {
                modal.openGiveItemModal(gameState.currentChatNpc, interaction.handleGiveItem);
            }
        });

        // 關閉彈窗
        dom.cancelGiveBtn.addEventListener('click', modal.closeGiveItemModal);
        dom.closeSkillsBtn.addEventListener('click', modal.closeSkillsModal);

        // 設定視窗高度
        setGameContainerHeight();
        window.addEventListener('resize', setGameContainerHeight);

        // 載入遊戲
        gameLoop.loadInitialGame();
    }

    initialize();
});
