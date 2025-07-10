// scripts/gameState.js

// 定義並匯出一個全域的遊戲狀態物件
// 這使得多個模組可以共享和修改同一個狀態，而不會產生衝突。
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
    }
};
