// scripts/gameState.js

// 定義並匯出一個全域的遊戲狀態物件
export const gameState = {
    currentRound: 0,
    isRequesting: false,
    isInCombat: false,
    isInChat: false,
    currentChatNpc: null,
    chatHistory: [],
    roundData: null,
    combat: {
        state: null,
        selectedStrategy: null,
        selectedSkill: null,
        selectedTarget: null,
    },
    deceasedNpcs: [] // 新增：死亡NPC名單
};
