// scripts/dom.js

// 創建一個空物件，用來存放所有DOM元素的引用
export const dom = {};

// 導出一個初始化函式
export function initializeDOM() {
    dom.gameContainer = document.querySelector('.game-container');
    dom.mainContent = document.getElementById('main-content');
    dom.storyPanel = document.getElementById('story-panel');
    dom.storyTextContainer = document.getElementById('story-text-wrapper');
    dom.storyHeader = document.querySelector('.story-header');
    dom.headerToggleButton = document.getElementById('header-toggle-btn');
    dom.playerInput = document.getElementById('player-input');
    dom.submitButton = document.getElementById('submit-button');
    dom.menuToggle = document.getElementById('menu-toggle');
    dom.themeSwitcher = document.getElementById('theme-switcher');
    dom.logoutButton = document.getElementById('logout-btn');
    dom.suicideButton = document.getElementById('suicide-btn');
    dom.skillsBtn = document.getElementById('skills-btn');
    dom.bountiesBtn = document.getElementById('bounties-btn');
    dom.aiModelSelector = document.getElementById('ai-model-selector');
    dom.npcInteractionMenu = document.getElementById('npc-interaction-menu');

    dom.chatModal = document.getElementById('chat-modal'); 
    dom.chatInput = document.getElementById('chat-input');
    dom.chatActionBtn = document.getElementById('chat-action-btn');
    dom.closeChatBtn = document.getElementById('close-chat-btn');
    dom.endChatBtn = document.getElementById('end-chat-btn');
    dom.giveItemBtn = document.getElementById('give-item-btn');
    dom.cancelGiveBtn = document.getElementById('cancel-give-btn');
    dom.closeSkillsBtn = document.getElementById('close-skills-btn');
    dom.gmPanel = document.getElementById('gm-panel');
    dom.gmCloseBtn = document.getElementById('gm-close-btn');
    dom.gmMenu = document.getElementById('gm-menu');
    dom.gmContent = document.getElementById('gm-content');

    // 【核心新增】地點詳情彈窗的DOM元素
    dom.locationDetailsModal = document.getElementById('location-details-modal');
    dom.locationModalTitle = document.getElementById('location-modal-title');
    dom.locationModalBody = document.getElementById('location-modal-body');
    dom.closeLocationDetailsBtn = document.getElementById('close-location-details-btn');

    if (dom.mainContent && !dom.mainContent.querySelector('.ai-thinking-loader')) {
        const aiThinkingLoader = document.createElement('div');
        aiThinkingLoader.className = 'ai-thinking-loader';
        aiThinkingLoader.innerHTML = `
            <div class="loader-disclaimer"></div>
            <div class="loader-text"></div>
            <div class="loader-dots"><span></span><span></span><span></span></div>
            <div class="loader-tip"></div>
        `;
        dom.mainContent.appendChild(aiThinkingLoader);
        dom.aiThinkingLoader = aiThinkingLoader; 
    } else if (dom.mainContent) {
        dom.aiThinkingLoader = dom.mainContent.querySelector('.ai-thinking-loader');
    }
}
