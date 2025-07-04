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
    if (!actionText) return;

    appendPlayerActionToStory(actionText);

    playerInput.value = '';
    submitButton.disabled = true;
    submitButton.textContent = '思考中...';

    // *** 核心：獲取AI的回應 (現在是從後端獲取) ***
    const aiResponse = await getRealAIResponse(actionText);

    // 我們不再需要前端的模擬延遲，因為網路請求本身就需要時間
    // await new Promise(resolve => setTimeout(resolve, 1000));

    if (aiResponse) {
        updateUI(aiResponse.story, aiResponse.roundData);
    }
    
    submitButton.disabled = false;
    submitButton.textContent = '送出行動';
    playerInput.focus();
}

function appendPlayerActionToStory(text) {
    const p = document.createElement('p');
    p.className = 'player-action-log';
    p.textContent = `> ${text}`;
    storyPanel.appendChild(p);
    storyPanel.scrollTop = storyPanel.scrollHeight;
}

function appendStoryText(text) {
    const p = document.createElement('p');
    p.className = 'story-text';
    p.textContent = text;
    storyPanel.appendChild(p);
    storyPanel.scrollTop = storyPanel.scrollHeight;
}

function updateUI(storyText, roundData) {
    appendStoryText(storyText);
    roundNumberDisplay.textContent = roundData.R;
    let infoText = '';
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
    const backendUrl = 'http://localhost:3001/interact';

    try {
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action: playerAction, round: currentRound })
        });

        if (!response.ok) {
            throw new Error(`伺服器錯誤: ${response.status}`);
        }

        const data = await response.json();
        
        currentRound++;
        data.roundData.R = currentRound;

        return data;

    } catch (error) {
        console.error('無法連接到後端伺服器:', error);
        return {
            story: `[系統錯誤] 無法連接到你的意識深處（後端伺服器）。請確認伺服器是否已啟動，或檢查網路連線。`,
            roundData: { R: currentRound, EVT: "連線中斷" }
        };
    }
}


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
