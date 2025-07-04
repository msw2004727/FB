// --- 基礎設定 ---
require('dotenv').config();
const express = require('express');
const cors = require('cors');

// --- Firebase 設定 ---
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
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

// --- CORS 設定 (最終明確版) ---
const corsOptions = {
  origin: 'https://msw2004727.github.io', // 只允許您的GitHub Pages來源的請求
  optionsSuccessStatus: 200 
};
app.use(cors(corsOptions));
// --- CORS 設定結束 ---

app.use(express.json());


// =================================================================
// ============== 三大核心 AI 函式 (小說家, 檔案管理員, 故事大師) ==============
// =================================================================

/**
 * AI 角色 1: 小說家 (將結構化數據轉為小說文字)
 */
async function getNarrative(roundData) {
    const prompt = `
    你是一位功力深厚的武俠小說家，風格近似金庸。你的任務是將以下提供的結構化遊戲數據，改寫成一段充滿意境、文筆流暢、富有細節的敘述性小說段落。請自然地將所有數據融入到段落中，不要生硬地條列。重點是創造沉浸感。

    【本回合數據】:
    ${JSON.stringify(roundData, null, 2)}

    現在，請將以上數據改寫成一段精彩的小說段落。
    `;
    try {
        const result = await aiModel.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("AI(小說家)生成段落時出錯:", error);
        return "在那一刻，時間的長河似乎出現了斷層，記憶的碎片未能拼湊成完整的畫面...";
    }
}

/**
 * AI 角色 2: 檔案管理員 (更新長期記憶摘要)
 */
async function getAISummary(oldSummary, newRoundData) {
    const prompt = `
    你是一位專業的「故事檔案管理員」。你的任務是將新發生的事件，精煉並整合進舊的故事摘要中，產出一個更新、更簡潔的摘要。

    規則：
    1. 你的回應必須是一個單一的JSON物件，格式為 {"summary": "更新後的摘要內容..."}。不要添加任何額外文字。
    2. 摘要的目的是記錄遊戲的核心進展，忽略不重要的細節。
    3. 重點關注以下資訊的變化：主角和重要NPC的關係、狀態變化；主要任務的關鍵進展或狀態改變；獲得或失去的關鍵物品或線索；對世界局勢有重大影響的事件。

    這是【舊的故事摘要】:
    ${oldSummary}

    這是【剛剛發生的新事件】的數據:
    ${JSON.stringify(newRoundData, null, 2)}

    現在，請根據以上資訊，產出更新後的JSON格式摘要。
    `;
    try {
        const result = await aiModel.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        const cleanJsonText = text.replace(/^```json\s*|```\s*$/g, '');
        const parsedJson = JSON.parse(cleanJsonText);
        return parsedJson.summary;
    } catch (error) {
        console.error("AI(檔案管理員)生成摘要時出錯:", error);
        return oldSummary; // 如果出錯，至少保留舊的摘要
    }
}

/**
 * AI 角色 3: 故事大師 (生成下一回合的遊戲內容)
 */
async function getAIStory(longTermSummary, recentHistory, playerAction) {
    const prompt = `
    你是一個名為「江湖百曉生」的AI，是這個世界的頂級故事大師。你的風格基於金庸武俠小說，沉穩、寫實且富有邏輯。

    ## 長期故事摘要 (世界核心記憶):
    ${longTermSummary}
    
    ## 核心世界觀：
    1.  **時代背景**: 這是一個類似明朝中葉，但架空的武俠世界。朝廷腐敗，江湖動盪，各大門派與地方勢力盤根錯節。
    2.  **主角設定**: 主角是一個從21世紀現代社會，靈魂穿越到這個世界的年輕人。他附身在一個不知名、約15歲的少年身上。這具身體骨骼清奇、經脈異於常人，是萬中無一的練武奇才，但因為不明原因，正處於重傷瀕死的狀態。
    3.  **開場地點**: 主角目前在一個名為「無名村」的偏遠小村落。這個村莊地處偏僻，但周圍的山賊、惡霸、甚至不入流的小門派等惡勢力橫行，村民長年受到脅迫，生活困苦。

    ## 你必須遵守的嚴格規則：
    1.  **絕對邏輯性**: 所有事件和物品的出現都必須有合理的因果關係。移動需要時間，不可能順移；物品不能憑空出現，必須是透過購買、尋找、製作、偷竊或他人贈與等合乎邏輯的方式獲得。天氣和時間會自然流動。
    2.  **NPC的靈魂**: 你創造的每位NPC，即使是路人，都必須有基本的個性、動機和背景故事。他們會記住玩家的關鍵行為並做出相應反應。
    3.  **寫實的成長**: 主角雖然是奇才，但成長需要過程。內力需要時間打坐修煉，武功招式需要練習才能純熟。
    4.  **JSON格式**: 你的所有回應都必須是一個完整的、不含任何註解的JSON物件，不要在前後添加任何額外的文字或 "\\\`\\\`\\\`json" 標記。
    5.  **字數限制**: 「story」欄位的敘述文字，請務必控制在150個字元以內，保持文字精煉簡潔。
    
    ## 最近發生的事件 (短期記憶):
    ${recentHistory}

    ## 這是玩家的最新行動:
    "${playerAction}"

    現在，請根據以上的長期摘要、世界觀、規則、最近發生的事件和玩家的最新行動，生成下一回合的JSON物件。
    `;

    try {
        const result = await aiModel.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        const cleanJsonText = text.replace(/^```json\s*|```\s*$/g, '');
        return JSON.parse(cleanJsonText);
    } catch (error) {
        console.error("AI(故事大師)生成故事時出錯:", error);
        return null;
    }
}


// =================================================================
// ========================== API 路由 ===========================
// =================================================================

// 核心互動路由
app.post('/interact', async (req, res) => {
    try {
        const playerAction = req.body.action;
        const currentRound = req.body.round;
        console.log(`接收到玩家行動 (R${currentRound}): ${playerAction}`);

        // 1. 讀取長期摘要
        const summaryDocRef = db.collection('game_state').doc('summary');
        const summaryDoc = await summaryDocRef.get();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始，一切都是未知的。";

        // 2. 讀取近期歷史 (滑動窗口)
        let recentHistoryRounds = [];
        const memoryDepth = 3; // 最近3回合的詳細歷史
        if (currentRound > 0) {
            const queries = [];
            for (let i = 0; i < memoryDepth; i++) {
                const roundToFetch = currentRound - i;
                if (roundToFetch > 0) {
                    queries.push(db.collection('game_saves').doc(`R${roundToFetch}`).get());
                }
            }
            const snapshots = await Promise.all(queries);
            snapshots.forEach(doc => {
                if (doc.exists) {
                    recentHistoryRounds.push(doc.data());
                }
            });
            recentHistoryRounds.sort((a, b) => a.R - b.R);
        }
        const recentHistoryJson = JSON.stringify(recentHistoryRounds, null, 2);

        // 3. 呼叫主AI，傳入長期摘要和近期歷史，生成新回合
        const aiResponse = await getAIStory(longTermSummary, recentHistoryJson, playerAction);

        if (!aiResponse) {
             throw new Error("主AI未能生成有效的回應。");
        }
        
        const newRoundNumber = currentRound + 1;
        aiResponse.roundData.R = newRoundNumber;

        // 4. 儲存新回合的詳細紀錄
        const newRoundDocId = `R${newRoundNumber}`;
        await db.collection('game_saves').doc(newRoundDocId).set(aiResponse.roundData);
        console.log(`回合 ${newRoundDocId} 已成功寫入Firebase!`);

        // 5. 呼叫摘要AI，傳入舊摘要和新回合數據，更新長期記憶
        const newSummary = await getAISummary(longTermSummary, aiResponse.roundData);
        
        // 6. 儲存更新後的摘要
        await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });
        console.log(`故事摘要已更新至第 ${newRoundNumber} 回合。`);

        // 7. 回傳結果給前端
        res.json(aiResponse);

    } catch (error) {
        console.error("處理請求時發生錯誤:", error);
        res.status(500).json({ 
            story: "[系統內部錯誤] 世界管理者的大腦出現了混亂，無法回應你的行動。請查看後端伺服器的日誌。",
            roundData: { R: req.body.round, EVT: "系統錯誤" } 
        });
    }
});

// 讀取最新進度路由 (給遊戲主頁用)
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

// 讀取完整小說路由 (給小說頁面用)
app.get('/get-novel', async (req, res) => {
    try {
        const snapshot = await db.collection('game_saves').orderBy('R', 'asc').get();
        if (snapshot.empty) {
            res.status(404).json({ novel: ["故事尚未開始..."] });
            return;
        }

        const narrativePromises = snapshot.docs.map(doc => getNarrative(doc.data()));
        const novelParagraphs = await Promise.all(narrativePromises);
        res.json({ novel: novelParagraphs });
    } catch (error) {
        console.error("生成完整小說時出錯:", error);
        res.status(500).json({ novel: ["讀取故事時發生錯誤。"] });
    }
});

// 根路由 (用於健康檢查)
app.get('/', (req, res) => {
    res.send('AI 小說伺服器已啟動，並已連接到Firebase和Google AI！');
});

// --- 啟動伺服器 ---
app.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});
