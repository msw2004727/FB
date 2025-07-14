// api/utils/tutorialHelper.js

const HINTS = [
    "不知所措時，可點擊儀表板的「關係圖」或「百科」圖示，梳理人際關係與江湖傳聞，或可覓得一線生機。",
    "江湖險惡，能力乃立身之本。透過「修練」或完成「懸賞任務」，可快速提升內、外、輕三種功體，以應對未來的挑戰。",
    "與人交往，貴在交心。點擊故事中的NPC姓名，即可開啓「密談」，贈送他們喜愛的禮物，或能博得好感，探聽出意想不到的秘密。",
    "精力乃行動之源，一旦耗盡便會昏迷。可透過「睡覺」、「歇息」或進食來恢復，切莫大意。",
    "行囊空間有限，當負重過高時，行動將會變得遲緩。可以將暫時用不到的物品存放在安全地點，或出售給商人。",
    "想快速賺錢？除了完成懸賞，也可以留意城鎮中的商機，低買高賣，積累財富。",
    "戰鬥中的策略克制至關重要：攻擊克迴避，迴避克防禦，防禦克攻擊。預判對手的行動是取勝的關鍵。",
    "當你對一位NPC的好感度或心動值達到一定程度時，他們可能會主動找你互動，甚至贈予你意想不到的禮物。",
    "除了打打殺殺，你也可以嘗試學習如「採藥」、「釣魚」、「鍛造」等生活技能，體驗不一樣的江湖人生。",
    "遊戲中的時間會根據你的行動自動流逝。注意儀表板上的時辰變化，許多事件只會在特定的時間發生。"
];

/**
 * 為錯誤訊息附加一條隨機的教學提示
 * @param {string} errorMessage - 原始的錯誤訊息
 * @returns {string} - 包含原始錯誤訊息和教學提示的新字串
 */
function appendTutorialHint(errorMessage) {
    const randomHint = HINTS[Math.floor(Math.random() * HINTS.length)];
    const formattedHint = `\n\n【江湖指引】${randomHint}`;
    
    // 確保最終訊息長度約在250字以內
    const combinedMessage = `${errorMessage}${formattedHint}`;
    return combinedMessage.slice(0, 280); // 稍微放寬長度限制以容納完整句子
}

module.exports = {
    appendTutorialHint
};
