// scripts/dom.js

// 創建一個空物件，用來存放所有DOM元素的引用
export const dom = {};

// 導出一個初始化函式
// 這個函式只會在 main.js 中，當 DOM 完全載入後被呼叫一次
export function initializeDOM() {
    // 主要遊戲容器
    dom.gameContainer = document.querySelector('.game-container');
    dom.mainContent = document.getElementById('main-content');
    dom.storyPanel = document.getElementById('story-panel');
    dom.storyTextContainer = document.getElementById('story-text-wrapper');

    // 頂部狀態列
    dom.storyHeader = document.querySelector('.story-header');
    dom.headerToggleButton = document.getElementById('header-toggle-btn');
    
    // 底部輸入區
    dom.playerInput = document.getElementById('player-input');
    dom.submitButton = document.getElementById('submit-button');

    // 儀表板
    dom.menuToggle = document.getElementById('menu-toggle');
    dom.themeSwitcher = document.getElementById('theme-switcher');
    dom.logoutButton = document.getElementById('logout-btn');
    dom.suicideButton = document.getElementById('suicide-btn');
    dom.skillsBtn = document.getElementById('skills-btn');
    dom.bountiesBtn = document.getElementById('bounties-btn');
    dom.aiModelSelector = document.getElementById('ai-model-selector');
    
    // NPC 互動選單
    dom.npcInteractionMenu = document.getElementById('npc-interaction-menu');

    // 聊天視窗
    dom.chatInput = document.getElementById('chat-input');
    dom.chatActionBtn = document.getElementById('chat-action-btn');
    dom.closeChatBtn = document.getElementById('close-chat-btn');
    dom.endChatBtn = document.getElementById('end-chat-btn');

    // 贈予物品視窗
    dom.giveItemBtn = document.getElementById('give-item-btn');
    dom.cancelGiveBtn = document.getElementById('cancel-give-btn');

    // 技能視窗
    dom.closeSkillsBtn = document.getElementById('close-skills-btn');

    // GM 面板
    dom.gmPanel = document.getElementById('gm-panel');
    dom.gmCloseBtn = document.getElementById('gm-close-btn');
    dom.gmMenu = document.getElementById('gm-menu');
    dom.gmContent = document.getElementById('gm-content');
    
    // 讀取動畫
    dom.aiThinkingLoader = document.querySelector('.ai-thinking-loader');
}
