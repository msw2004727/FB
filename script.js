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

    // *** 核心：從後端獲取真實的回應 ***
    const aiResponse = await getRealAIResponse(actionText);

    // 如果成功獲取回應，就更新介面
    if (aiResponse) {
        updateUI(aiResponse.story, aiResponse.roundData);
    }
    
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
    storyPanel.scrollTop = storyPanel.scrollHeight; // 自動滾動到底部
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
    storyPanel.scrollTop = storyPanel.scrollHeight; // 自動滾動到底部
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
    roundNumberDisplay.textContent = roundData.R || currentRound;
    
    let infoText = '';
    // 使用我們設計的新格式來顯示，並檢查屬性是否存在
    if(roundData.ATM) infoText += `ATM: ${Array.isArray(roundData.ATM) ? roundData.ATM.join(', ') : roundData.ATM}\n`;
    if(roundData.EVT) infoText += `EVT: ${roundData.EVT}\n`;
    if(roundData.LOC) infoText += `LOC: ${Array.isArray(roundData.LOC) ? roundData.LOC.join(', ') : roundData.LOC}\n`;
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
 * 連接到後端伺服器，獲取AI的回應
 * @param {string} playerAction - 玩家的行動
 * @returns {Promise<object|null>} - 包含故事和回合資料的物件，或是在失敗時返回null
 */
async function getRealAIResponse(playerAction) {
    // *** 唯一的修改在這裡！我們將URL換成了您在Render上的公開網址 ***
    const backendUrl = 'https://md-server-main.onrender.com/interact';

    try {
        const response = await fetch(backendUrl, {
            method: 'POST', // 請求方法為 POST
            headers: {
                'Content-Type': 'application/json', // 告訴伺服器我們送的是JSON
            },
            // 將玩家的行動和當前回合數包裝成JSON格式
            body: JSON.stringify({ action: playerAction, round: currentRound })
        });

        // 檢查伺服器是否成功回應
        if (!response.ok) {
            throw new Error(`伺服器錯誤: ${response.status}`);
        }

        // 將伺服器回傳的JSON回應轉換為JavaScript物件
        const data = await response.json();
        
        // 使用後端回傳的新回合數，來更新前端的當前回合數
        currentRound = data.roundData.R;

        return data;

    } catch (error) {
        console.error('無法連接到後端伺服器:', error);
        // 當連線失敗時，也在UI上顯示錯誤訊息
        return {
            story: `[系統錯誤] 無法連接到你的意識深處（後端伺服器）。請確認伺服器是否已啟動，或檢查網路連線與API權限。`,
            roundData: { R: currentRound, EVT: "連線中斷" }
        };
    }
}

/**
 * 遊戲開始時的初始訊息
 */
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

// 執行遊戲初始化函式
initializeGame();
