// --- 基礎設定 ---
require('dotenv').config();
const express = require('express');
const cors = require('cors');

// --- Firebase 設定 ---
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // 請確保這裡的URL是您自己的
  databaseURL: "https://md-server-main-default-rtdb.asia-southeast1.firebasedatabase.app"
});
const db = admin.firestore();

// --- Google AI 設定 ---
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});

// --- Express App 設定 ---
const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

// --- 核心：AI 互動函式 ---
async function getAIStory(history, playerAction) {
    // 這是我們給AI的「人設」和「指令」，是整個專案的靈魂！
    const prompt = `
    你是一個名為「江湖百曉生」的AI，是這個世界的頂級故事大師。你的風格基於金庸武俠小說，沉穩、寫實且富有邏輯。

    ## 核心世界觀：
    1.  **時代背景**: 這是一個類似明朝中葉，但架空的武俠世界。朝廷腐敗，江湖動盪，各大門派與地方勢力盤根錯節。
    2.  **主角設定**: 主角是一個從21世紀現代社會，靈魂穿越到這個世界的年輕人。他附身在一個不知名、約15歲的少年身上。這具身體骨骼清奇、經脈異於常人，是萬中無一的練武奇才，但因為不明原因，正處於重傷瀕死的狀態。
    3.  **開場地點**: 主角目前在一個名為「無名村」的偏遠小村落。這個村莊地處偏僻，但周圍的山賊、惡霸、甚至不入流的小門派等惡勢力橫行，村民長年受到脅迫，生活困苦。

    你必須嚴格遵守以下的規則：
    1. 你的所有回應都必須是一個完整的JSON物件，不要在前後添加任何額外的文字或 "\`\`\`json" 標記。
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
        const text = response.text();
        const cleanJsonText = text.replace(/^```json\s*|```\s*$/g, '');
        return JSON.parse(cleanJsonText);
    } catch (error) {
        console.error("AI生成或解析JSON時出錯:", error);
        return null;
    }
}


// --- API 路由 ---
app.post('/interact', async (req, res) => {
    try {
        const playerAction = req.body.action;
        const currentRound = req.body.round;

        console.log(`接收到玩家行動 (R${currentRound}): ${playerAction}`);

        let historyJson = "{}";
        if (currentRound > 0) {
            const historyDoc = await db.collection('game_saves').doc(`R${currentRound}`).get();
            if (historyDoc.exists) {
                historyJson = JSON.stringify(historyDoc.data(), null, 2);
            }
        }

        const aiResponse = await getAIStory(historyJson, playerAction);

        if (!aiResponse) {
             throw new Error("AI未能生成有效的回應。");
        }
        
        aiResponse.roundData.R = currentRound + 1;

        const docId = `R${aiResponse.roundData.R}`;
        await db.collection('game_saves').doc(docId).set(aiResponse.roundData);
        console.log(`回合 ${docId} 已成功寫入Firebase!`);

        res.json(aiResponse);

    } catch (error) {
        console.error("處理請求時發生錯誤:", error);
        res.status(500).json({ 
            story: "[系統內部錯誤] 世界管理者的大腦出現了混亂，無法回應你的行動。請查看後端伺服器的日誌。",
            roundData: { R: req.body.round, EVT: "系統錯誤" } 
        });
    }
});

app.get('/latest-game', async (req, res) => {
    try {
        const snapshot = await db.collection('game_saves').orderBy('R', 'desc').limit(1).get();

        if (snapshot.empty) {
            res.status(404).json({ message: 'No saved games found.' });
        } else {
            const latestGameData = snapshot.docs[0].data();
            res.json({
                story: `[進度已讀取] 你回到了 ${latestGameData.LOC[0]}，繼續你的冒險...`,
                roundData: latestGameData
            });
        }
    } catch (error) {
        console.error("讀取最新進度時發生錯誤:", error);
        res.status(500).json({ message: 'Failed to load game.' });
    }
});

// 根路由
app.get('/', (req, res) => {
    res.send('AI 小說伺服器已啟動，並已連接到Firebase和Google AI！');
});

// --- 啟動伺服器 ---
app.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});
