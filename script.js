// --- DOM 元素 ---
const storyPanel = document.getElementById('story-panel');
const roundInfoPanel = document.getElementById('round-info');
const roundNumberDisplay = document.getElementById('round-number');
const playerInput = document.getElementById('player-input');
const submitButton = document.getElementById('submit-button');

// --- 遊戲狀態 ---
let currentRound = 0;

// --- 事件監聽 ---
submitButton.addEventListener('click', handlePlayerAction);
playerInput.addEventListener('keypress', function(event) {
    if (event.key === 'Enter') {
        handlePlayerAction();
    }
});

// --- 函式 ---

/**
 * 處理玩家的行動
 */
async function handlePlayerAction() {
    const actionText = playerInput.value.trim();
    if (!actionText) return; // 如果沒輸入東西就返回

    // 顯示玩家的行動
    appendPlayerActionToStory(actionText);

    // 清空輸入框並暫時禁用按鈕
    playerInput.value = '';
    submitButton.disabled = true;
    submitButton.textContent = '思考中...';

    // *** 核心：獲取AI的回應 (目前是假的) ***
    const aiResponse = await getMockAIResponse(actionText);

    // 模擬延遲，讓感覺更真實
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 更新介面
    updateUI(aiResponse.story, aiResponse.roundData);

    // 重新啟用按鈕
    submitButton.disabled = false;
    submitButton.textContent = '送出行動';
    playerInput.focus();
}

/**
 * 將玩家的行動顯示在故事面板上
 * @param {string} text - 玩家輸入的文字
 */
function appendPlayerActionToStory(text) {
    const p = document.createElement('p');
    p.className = 'player-action-log';
    p.textContent = `> ${text}`;
    storyPanel.appendChild(p);
    storyPanel.scrollTop = storyPanel.scrollHeight;
}

/**
 * 將AI生成的故事顯示在故事面板上
 * @param {string} text - AI生成的故事文字
 */
function appendStoryText(text) {
    const p = document.createElement('p');
    p.className = 'story-text';
    p.textContent = text;
    storyPanel.appendChild(p);
    storyPanel.scrollTop = storyPanel.scrollHeight;
}

/**
 * 更新整個UI介面
 * @param {string} storyText - 新的故事文本
 * @param {object} roundData - 回合資料物件
 */
function updateUI(storyText, roundData) {
    // 1. 更新故事面板
    appendStoryText(storyText);

    // 2. 更新回合資訊
    roundNumberDisplay.textContent = roundData.R;
    let infoText = '';
    // 使用我們設計的新格式來顯示
    if(roundData.ATM) infoText += `ATM: ${roundData.ATM.join(', ')}\n`;
    if(roundData.EVT) infoText += `EVT: ${roundData.EVT}\n`;
    if(roundData.LOC) infoText += `LOC: ${roundData.LOC.join(', ')}\n`;
    if(roundData.PSY) infoText += `PSY: ${roundData.PSY}\n`;
    if(roundData.PC) infoText += `PC: ${roundData.PC}\n`;
    if(roundData.NPC) infoText += `NPC: ${roundData.NPC}\n`;
    if(roundData.ITM) infoText += `ITM: ${roundData.ITM}\n`;
    if(roundData.QST) infoText += `QST: ${roundData.QST}\n`;
    if(roundData.WRD) infoText += `WRD: ${roundData.WRD}\n`;
    if(roundData.LOR) infoText += `LOR: ${roundData.LOR}\n`;
    if(roundData.CLS) infoText += `CLS: ${roundData.CLS}\n`;
    if(roundData.IMP) infoText += `IMP: ${roundData.IMP}\n`;
    
    roundInfoPanel.textContent = infoText;
}

/**
 * (*** 核心 ***)
 * 模擬AI的回應 - 這部分未來將被真實的後端API取代
 * @param {string} playerAction - 玩家的行動
 * @returns {Promise<object>} - 包含故事和回合資料的物件
 */
async function getMockAIResponse(playerAction) {
    currentRound++;
    
    // 這是一個假的AI回應，用來測試介面
    const mockData = {
        story: `你決定「${playerAction}」。夜色更深了，一陣冷風吹過，遠處的森林裡傳來一聲狼嚎，似乎有什麼東西被你的動靜驚擾了。你感覺到一絲不安，握緊了手中的武器。`,
        roundData: {
            R: currentRound,
            ATM: ["緊張", "月黑風高, 狼嚎四起"],
            EVT: "在黑森林邊緣探索",
            LOC: ["黑森林外圍", "{深夜, 起霧}"],
            PSY: "感到一絲不安，但好奇心驅使著繼續前進",
            PC: "心境-5(環境影響)",
            NPC: "", // 本回合無NPC互動
            ITM: "", // 本回合無物品變化
            QST: "探索森林, 進行中, 1/10",
            WRD: "霧氣變濃",
            LOR: "",
            CLS: "遠處似乎有微弱的光芒",
            IMP: "發出的聲響 -> 可能吸引了未知生物的注意"
        }
    };
    
    return mockData;
}

// 遊戲開始時的初始訊息
function initializeGame() {
    const initialInfo = `
ATM: [未知, {萬籟俱寂}]
EVT: 故事開始
LOC: [未知的荒野, {黃昏}]
PSY: [頭腦昏沉，不知身在何處]
QST: [我是誰？, 開始]
    `;
    roundInfoPanel.textContent = initialInfo.trim();
    playerInput.focus();
}

initializeGame();
