// scripts/dom.js

export const dom = {};

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
    
    // 動態建立讀取動畫
    if (dom.mainContent && !dom.mainContent.querySelector('.ai-thinking-loader')) {
        const aiThinkingLoader = document.createElement('div');
        aiThinkingLoader.className = 'ai-thinking-loader';
        aiThinkingLoader.innerHTML = `
            <div class="loader-disclaimer">說書人掐指一算：此番推演約需二十至四十五息。若遇江湖新奇，則需額外十數息為其立傳建檔。</div>
            <div class="loader-text"></div>
            <div class="loader-dots"><span></span><span></span><span></span></div>
            <div class="loader-tip"></div>
        `;
        dom.mainContent.appendChild(aiThinkingLoader);
        dom.aiThinkingLoader = aiThinkingLoader; 
    } else {
        dom.aiThinkingLoader = dom.mainContent.querySelector('.ai-thinking-loader');
    }
}
