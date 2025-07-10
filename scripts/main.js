// scripts/main.js

import { loadInitialGame, handlePlayerAction } from './gameLoop.js';
import * as interaction from './interactionHandlers.js';
import * as modal from './modalManager.js';
import { initializeGmPanel } from './gmManager.js';
import { gameState } from './gameState.js'; 

// 將 gameLoop 中的函式傳遞給 interactionHandlers，建立連接
interaction.setGameLoop({
    setLoading: (isLoading, text) => getGameLoop().setLoading(isLoading, text),
    processNewRoundData: (data) => getGameLoop().processNewRoundData(data),
    handlePlayerDeath: () => getGameLoop().handlePlayerDeath()
});

// 讓 interactionHandlers 可以呼叫到 gameLoop
function getGameLoop() {
    return {
        setLoading: (isLoading, text) => setLoading(isLoading, text),
        processNewRoundData: (data) => processNewRoundData(data),
        handlePlayerDeath: () => handlePlayerDeath()
    };
}


document.addEventListener('DOMContentLoaded', () => {
    // --- 登入驗證 ---
    const token = localStorage.getItem('jwt_token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    // --- 獲取主要互動的 DOM 元素 ---
    const storyHeader = document.querySelector('.story-header');
    const headerToggleButton = document.getElementById('header-toggle-btn');
    const playerInput = document.getElementById('player-input');
    const submitButton = document.getElementById('submit-button');
    const menuToggle = document.getElementById('menu-toggle');
    const gameContainer = document.querySelector('.game-container');
    const themeSwitcher = document.getElementById('theme-switcher');
    const logoutButton = document.getElementById('logout-btn');
    const suicideButton = document.getElementById('suicide-btn');
    const skillsBtn = document.getElementById('skills-btn');
    const bountiesBtn = document.getElementById('bounties-btn');
    const storyPanel = document.getElementById('story-panel');
    const chatInput = document.getElementById('chat-input');
    const chatActionBtn = document.getElementById('chat-action-btn');
    const closeChatBtn = document.getElementById('close-chat-btn');
    const endChatBtn = document.getElementById('end-chat-btn');
    const giveItemBtn = document.getElementById('give-item-btn');
    const cancelGiveBtn = document.getElementById('cancel-give-btn');
    const closeSkillsBtn = document.getElementById('close-skills-btn');
    const gmPanel = document.getElementById('gm-panel');
    const gmCloseBtn = document.getElementById('gm-close-btn');
    const gmMenu = document.getElementById('gm-menu');
    const gmContent = document.getElementById('gm-content');

    // --- 初始化與事件綁定 ---

    function setGameContainerHeight() {
        if (gameContainer) {
            gameContainer.style.height = `${window.innerHeight}px`;
        }
    }

    function initialize() {
        // 主題切換
        let currentTheme = localStorage.getItem('game_theme') || 'light';
        const themeIcon = themeSwitcher.querySelector('i');
        document.body.className = `${currentTheme}-theme`;
        themeIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        themeSwitcher.addEventListener('click', () => {
            currentTheme = (document.body.classList.contains('light-theme')) ? 'dark' : 'light';
            localStorage.setItem('game_theme', currentTheme);
            document.body.className = `${currentTheme}-theme`;
            themeIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        });

        // 摺疊/展開儀表板
        headerToggleButton.addEventListener('click', () => {
            storyHeader.classList.toggle('collapsed');
            headerToggleButton.querySelector('i').classList.toggle('fa-chevron-up');
            headerToggleButton.querySelector('i').classList.toggle('fa-chevron-down');
        });

        // 手機側邊欄
        menuToggle.addEventListener('click', () => gameContainer.classList.toggle('sidebar-open'));
        
        // 登出
        logoutButton.addEventListener('click', () => {
            localStorage.removeItem('jwt_token');
            localStorage.removeItem('username');
            window.location.href = 'login.html';
        });
        
        // 了卻此生
        suicideButton.addEventListener('click', async () => {
            interaction.hideNpcInteractionMenu();
            if (gameState.isRequesting) return;
            if (window.confirm("你確定要了卻此生，讓名號永載史冊嗎？")) { 
                getGameLoop().setLoading(true, '英雄末路，傳奇落幕...');
                try {
                    const data = await api.forceSuicide({ model: document.getElementById('ai-model-selector').value });
                    updateUI(data.story, data.roundData, null, data.locationData);
                    getGameLoop().handlePlayerDeath();
                } catch (error) {
                    handleApiError(error);
                    getGameLoop().setLoading(false);
                }
            }
        });

        // 武學總覽
        if (skillsBtn) {
            skillsBtn.addEventListener('click', async () => {
                interaction.hideNpcInteractionMenu();
                if (gameState.isRequesting) return;
                getGameLoop().setLoading(true, '獲取武學資料...');
                try {
                    const skills = await api.getSkills();
                    modal.openSkillsModal(skills);
                } catch (error) {
                    handleApiError(error);
                } finally {
                    getGameLoop().setLoading(false);
                }
            });
        }
        
        // 懸賞按鈕
        if (bountiesBtn) {
            bountiesBtn.addEventListener('click', () => {
                interaction.hideNpcInteractionMenu();
                updateBountyButton(false);
            });
        }
        
        // GM 面板
        initializeGmPanel(gmPanel, gmCloseBtn, gmMenu, gmContent);

        // 主要動作提交
        submitButton.addEventListener('click', handlePlayerAction);
        playerInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); handlePlayerAction(); } });
        
        // 戰鬥確認
        document.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'combat-confirm-btn') {
                interaction.handleConfirmCombatAction();
            }
        });

        // NPC 互動
        storyPanel.addEventListener('click', interaction.handleNpcClick);

        // 聊天互動
        chatActionBtn.addEventListener('click', interaction.sendChatMessage);
        chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); interaction.sendChatMessage(); } });
        closeChatBtn.addEventListener('click', () => {
             gameState.isInChat = false;
             gameState.currentChatNpc = null;
             gameState.chatHistory = [];
             modal.closeChatModal();
             getGameLoop().setLoading(false); 
        });
        endChatBtn.addEventListener('click', interaction.endChatSession);

        // 贈予物品
        giveItemBtn.addEventListener('click', () => {
            if (gameState.isInChat && gameState.currentChatNpc) {
                modal.openGiveItemModal(gameState.currentChatNpc, interaction.handleGiveItem);
            }
        });

        // 關閉彈窗
        cancelGiveBtn.addEventListener('click', modal.closeGiveItemModal);
        closeSkillsBtn.addEventListener('click', modal.closeSkillsModal);

        // 設定視窗高度
        setGameContainerHeight();
        window.addEventListener('resize', setGameContainerHeight);

        // 載入遊戲
        loadInitialGame();
    }

    initialize();
});
