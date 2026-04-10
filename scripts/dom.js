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
    dom.suicideButton = document.getElementById('suicide-btn');
    dom.aiModelSelector = document.getElementById('ai-model-selector');
    dom.gmPanel = document.getElementById('gm-panel');
    dom.gmCloseBtn = document.getElementById('gm-close-btn');
    dom.gmMenu = document.getElementById('gm-menu');
    dom.gmContent = document.getElementById('gm-content');

    // API Key 設定彈窗
    dom.apikeyModal = document.getElementById('apikey-modal');
    dom.apikeyModalTitle = document.getElementById('apikey-modal-title');
    dom.apikeyModalDesc = document.getElementById('apikey-modal-desc');
    dom.apikeyInput = document.getElementById('apikey-input');
    dom.apikeyToggleBtn = document.getElementById('apikey-toggle-visibility');
    dom.apikeySaveBtn = document.getElementById('apikey-save-btn');
    dom.apikeyCancelBtn = document.getElementById('apikey-cancel-btn');

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
