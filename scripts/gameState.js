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
    currentLocationData: null, // 【核心新增】儲存當前地區的詳細資料
    combat: {
        state: null,
        selectedStrategy: null,
        selectedSkill: null,
        selectedTarget: null,
    },
    deceasedNpcs: [] 
};
