// TODO: 將這裡換成您自己的 Firebase 設定
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 初始化 Firebase
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// DOM 元素
const storyDisplay = document.getElementById('story-display');
const roundInfoDisplay = document.getElementById('round-info');
const playerActionInput = document.getElementById('player-action');
const submitActionButton = document.getElementById('submit-action');

// --- 遊戲核心邏輯 (此處為前端模擬，實際應由後端AI處理) ---

// 假設的遊戲狀態
let currentRound = 0;

// 當按下送出按鈕
submitActionButton.addEventListener('click', async () => {
    const action = playerActionInput.value;
    if (!action) {
        alert('請輸入你的行動！');
        return;
    }

    // 禁用輸入，防止重複提交
    playerActionInput.disabled = true;
    submitActionButton.disabled = true;
    storyDisplay.innerHTML += `<p><em>> ${action}</em></p>`; // 顯示玩家行動

    // --- 在這裡呼叫您的後端AI ---
    // 為了演示，我們將使用一個模擬的AI回應函式
    const aiResponse = await getMockAIResponse(action);

    // 更新前端介面
    updateUI(aiResponse.story, aiResponse.roundData);

    // 將回合紀錄儲存到 Firestore
    await saveRoundToFirebase(aiResponse.roundData);

    // 清空輸入框並重新啟用
    playerActionInput.value = '';
    playerActionInput.disabled = false;
    submitActionButton.disabled = false;
    playerActionInput.focus();
});

/**
 * 更新前端介面
 * @param {string} storyText - 新的故事文本
 * @param {object} roundData - 回合資料物件
 */
function updateUI(storyText, roundData) {
    // 更新故事顯示
    storyDisplay.innerHTML += `<p>${storyText}</p>`;
    storyDisplay.scrollTop = storyDisplay.scrollHeight; // 自動滾動到底部

    // 格式化並顯示回合資訊
    let infoText = `R${roundData.R}\n`;
    infoText += `EVT:${roundData.EVT}\n`;
    infoText += `LOC:${roundData.LOC}\n`;
    if (roundData.PC) infoText += `PC:${roundData.PC}\n`;
    if (roundData.NPC) infoText += `NPC:${roundData.NPC}\n`;
    if (roundData.ITM) infoText += `ITM:${roundData.ITM}\n`;
    if (roundData.QST) infoText += `QST:${roundData.QST}\n`;
    if (roundData.WRD) infoText += `WRD:${roundData.WRD}\n`;
    if (roundData.CLS) infoText += `CLS:${roundData.CLS}\n`;
    
    roundInfoDisplay.textContent = infoText;
}

/**
 * 將回合紀錄儲存到 Firebase
 * @param {object} roundData - 該回合的完整資料
 */
async function saveRoundToFirebase(roundData) {
    try {
        const roundId = `R${roundData.R}`;
        // 使用 set() 並指定文件ID為回合編號
        await db.collection("game_saves").doc(roundId).set(roundData);
        console.log(`回合 ${roundId} 已成功儲存至 Firebase!`);
    } catch (error) {
        console.error("儲存至 Firebase 失敗: ", error);
        storyDisplay.innerHTML += `<p style="color:red;">錯誤：無法儲存遊戲進度！</p>`;
    }
}

/**
 * 模擬 AI 回應 (在實際專案中，這部分應由後端執行)
 * @param {string} playerAction - 玩家的行動
 * @returns {Promise<object>} - 包含故事和回合資料的物件
 */
async function getMockAIResponse(playerAction) {
    currentRound++; // 回合數增加

    // 這是模擬的AI回應，您需要將其替換為真實的後端API呼叫
    const mockData = {
        story: `你決定「${playerAction}」。一陣夜風吹過，你感覺到山寨裡的氣氛更加緊張了。一名巡邏的嘍囉似乎發現了你的蹤跡，正朝你這個方向走來！`,
        roundData: {
            R: currentRound,
            EVT: "潛入山寨被發現",
            LOC: "山寨外圍草叢",
            PC: "心態-5,緊張",
            NPC: "嘍囉,友好-10,警戒",
            ITM: "", // 本回合無物品變化
            QST: "救人,進行中,1/4",
            WRD: "風變大",
            CLS: "發現巡邏路線"
        }
    };
    
    // 模擬網路延遲
    return new Promise(resolve => setTimeout(() => resolve(mockData), 1000));
}

// 遊戲開始時，可以嘗試讀取最後一筆紀錄
window.onload = async () => {
    const query = db.collection("game_saves").orderBy("R", "desc").limit(1);
    const snapshot = await query.get();

    if (!snapshot.empty) {
        const lastRound = snapshot.docs[0].data();
        currentRound = lastRound.R;
        storyDisplay.innerHTML = `<p>讀取到上次的進度...</p>`;
        updateUI(`你從 ${lastRound.LOC} 繼續你的冒險。`, lastRound);
    } else {
        storyDisplay.innerHTML = `<p>新的冒險開始了！你發現自己身處在一座不知名的森林裡，遠方似乎有火光。請在下方輸入你的第一個行動。</p>`;
        // 初始回合範例
        const initialRoundData = {
            R: 0,
            EVT: "遊戲開始",
            LOC: "未知森林",
        };
        roundInfoDisplay.textContent = `R0\nEVT:遊戲開始\nLOC:未知森林`;
    }
};
