// --- 基礎設定 ---
require('dotenv').config(); // 在最頂部載入 .env 檔案的設定
const express = require('express');
const cors = require('cors');

// --- Firebase 設定 ---
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- Google AI 設定 ---
const { GoogleGenerativeAI } = require("@google/generative-ai");
// 從 .env 檔案讀取API金鑰並初始化模型
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash"}); // 使用最新的Flash模型，速度快且強大

// --- Express App 設定 ---
const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

// --- 核心：AI 互動函式 ---
async function getAIStory(history, playerAction) {
    // 這是我們給AI的「人設」和「指令」，是整個專案的靈魂！
    const prompt = `
    你是一個名為「世界管理者（World Master）」的AI，負責一款沉浸式文字互動小說。你的任務是根據玩家的歷史和當前行動，生成富有創意、符合邏輯且引人入勝的故事發展。

    你必須嚴格遵守以下的規則：
    1. 你的所有回應都必須是一個完整的JSON物件，不要在前後添加任何額外的文字或 "```json" 標記。
    2. JSON物件必須包含 "story" 和 "roundData" 兩個頂層鍵。
    3. "story" 鍵的值是一個字串，用來生動地描述故事發展。
    4. "roundData" 鍵的值是一個物件，必須包含以下所有欄位，即使沒有內容也要用空字串""表示：
        - R: (數字) 新的回合編號
        - ATM: (陣列) [氛圍, 感官細節]
        - EVT: (字串) 事件摘要
        - LOC: (陣列) [地點名稱, {地點狀態}]
        - PSY: (字串) 角色內心獨白或感受
        - PC: (字串) 玩家狀態變化
        - NPC: (字串) NPC狀態變化
        - ITM: (字串) 物品變化
        - QST: (字串) 任務變化
        - WRD: (字串) 世界/局勢變化
        - LOR: (字串) 獲得的背景知識
        - CLS: (字串) 關鍵線索
        - IMP: (字串) 行動造成的直接影響

    這是遊戲的歷史紀錄 (JSON格式):
    ${history}

    這是玩家的最新行動:
    "${playerAction}"

    現在，請根據歷史和玩家的行動，生成下一回合的JSON物件。
    `;

    try {
        const result = await aiModel.generateContent(prompt);
        const response = await result.response;
        // 我們直接取得AI生成的純文字，並嘗試解析它
        const text = response.text();
        // 清理AI可能多給的頭尾標記
        const cleanJsonText = text.replace(/^```json\s*|```\s*$/g, '');
        return JSON.parse(cleanJsonText); // 將純文字JSON解析成物件
    } catch (error) {
        console.error("AI生成或解析JSON時出錯:", error);
        return null; // 如果出錯就返回null
    }
}


// --- API 路由 ---
app.post('/interact', async (req, res) => {
    try {
        const playerAction = req.body.action;
        const currentRound = req.body.round;

        console.log(`接收到玩家行動 (R${currentRound}): ${playerAction}`);

        // 讀取上一回合的歷史紀錄作為AI的上下文
        let historyJson = "{}"; // 預設為空物件
        if (currentRound > 0) {
            const historyDoc = await db.collection('game_saves').doc(`R${currentRound}`).get();
            if (historyDoc.exists) {
                historyJson = JSON.stringify(historyDoc.data(), null, 2);
            }
        }

        // --- 呼叫AI生成故事 ---
        const aiResponse = await getAIStory(historyJson, playerAction);

        if (!aiResponse) {
             throw new Error("AI未能生成有效的回應。");
        }
        
        // 確保回合數正確
        aiResponse.roundData.R = currentRound + 1;

        // --- 將新回合資料寫入Firebase ---
        const docId = `R${aiResponse.roundData.R}`;
        await db.collection('game_saves').doc(docId).set(aiResponse.roundData);
        console.log(`回合 ${docId} 已成功寫入Firebase!`);

        // 將AI生成的回應完整回傳給前端
        res.json(aiResponse);

    } catch (error) {
        console.error("處理請求時發生錯誤:", error);
        res.status(500).json({ 
            story: "[系統內部錯誤] 世界管理者的大腦出現了混亂，無法回應你的行動。請查看後端伺服器的日誌。",
            roundData: { R: req.body.round, EVT: "系統錯誤" } 
        });
    }
});

// 根路由，用於測試伺服器是否正常
app.get('/', (req, res) => {
    res.send('AI 小說伺服器已啟動，並已連接到Firebase和Google AI！');
});

// --- 啟動伺服器 ---
app.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});
