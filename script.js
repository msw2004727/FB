// --- DOM 元素 ---
const storyPanel = document.getElementById('story-panel');
const roundInfoPanel = document.getElementById('round-info');
const roundNumberDisplay = document.getElementById('round-number');
const playerInput = document.getElementById('player-input');
const submitButton = document.getElementById('submit-button');

// --- 遊戲狀態 ---
let currentRound = 0;
const backendBaseUrl = 'https://ai-novel-final.onrender.com'; // 您的雲端後端網址

// --- 事件監聽 ---
submitButton.addEventListener('click', handlePlayerAction);
playerInput.addEventListener('keypress', function(event) {
    if (event.key === 'Enter') {
        handlePlayerAction();
    }
});

// --- 函式 ---

async function handlePlayerAction() {
    const actionText = playerInput.value.trim();
    if (!actionText) return;

    appendPlayerActionToStory(actionText);

    playerInput.value = '';
    submitButton.disabled = true;
    submitButton.textContent = '思考中...';

    const aiResponse = await getRealAIResponse(actionText);

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
    roundNumberDisplay.textContent = roundData.R || currentRound;
    
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

async function getRealAIResponse(playerAction) {
    const interactUrl = `${backendBaseUrl}/interact`;
    try {
        const response = await fetch(interactUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: playerAction, round: currentRound })
        });

        if (!response.ok) throw new Error(`伺服器錯誤: ${response.status}`);
        
        const data = await response.json();
        currentRound = data.roundData.R;
        return data;
    } catch (error) {
        console.error('與後端互動時出錯:', error);
        return {
            story: `[系統錯誤] 你的行動無法傳達到意識深處。請檢查後端伺服器狀態或網路連線。`,
            roundData: { R: currentRound, EVT: "連線中斷" }
        };
    }
}

async function initializeGame() {
    const loadGameUrl = `${backendBaseUrl}/latest-game`;
    try {
        const response = await fetch(loadGameUrl);
        if (response.ok) {
            const savedGame = await response.json();
            currentRound = savedGame.roundData.R;
            updateUI(savedGame.story, savedGame.roundData);
            console.log(`成功讀取進度，目前在第 ${currentRound} 回合。`);
        } else {
            console.log("未找到存檔，開始新遊戲。");
            document.querySelector('.system-message').textContent = "未找到過去的記憶，你的故事將從此刻開始...";
            const initialInfo = `ATM: [未知, {萬籟俱寂}]\nEVT: 故事開始\nLOC: [未知的荒野, {黃昏}]\nPSY: [頭腦昏沉，不知身在何處]\nQST: [我是誰？, 開始]`;
            roundInfoPanel.textContent = initialInfo;
        }
    } catch (error) {
        console.error("初始化遊戲時發生錯誤:", error);
        appendStoryText("[系統錯誤] 無法連接到後端伺服器來讀取進度。請檢查連線。");
    } finally {
        playerInput.focus();
    }
}

initializeGame();
