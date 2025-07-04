// --- 基礎設定 ---
require('dotenv').config();
const express = require('express');
const cors = require('cors');

// --- Firebase 設定 ---
const admin = require('firebase-admin');
try {
  // 【安全實踐】: 從環境變數讀取完整的 Firebase 服務帳戶金鑰JSON字串
  const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountString) {
    throw new Error('Firebase 服務帳戶金鑰 (FIREBASE_SERVICE_ACCOUNT) 未在環境變數中設定！');
  }
  const serviceAccount = JSON.parse(serviceAccountString);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://md-server-main-default-rtdb.asia-southeast1.firebasedatabase.app" // 請確認這是您正確的 databaseURL
  });
} catch (error) {
  console.error("Firebase 初始化失敗:", error.message);
  // 如果Firebase無法初始化，程式將無法繼續運行
  process.exit(1);
}
const db = admin.firestore();

// --- AI SDK 初始化 (三核心) ---
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { OpenAI } = require("openai");

// 1. Google Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});

// 2. OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// 3. DeepSeek (使用OpenAI相容的API格式)
const deepseek = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com/v1",
});


// --- Express App 設定 ---
const app = express();
const PORT = process.env.PORT || 3001;
// 【部署設定】: 限制僅允許您的 GitHub Pages 前端來源訪問
const corsOptions = {
  origin: 'https://msw2004727.github.io',
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());


// =================================================================
// ============== 統一的AI調度中心 (Central AI Dispatcher) ==============
// =================================================================
async function callAI(modelName, prompt) {
    console.log(`[AI 調度中心] 正在使用模型: ${modelName}`);
    try {
        let textResponse = "";
        switch (modelName) {
            case 'openai':
                const openaiResult = await openai.chat.completions.create({
                    model: "gpt-4o", // 您可以根據需求更換為 "gpt-3.5-turbo" 等
                    messages: [{ role: "user", content: prompt }],
                });
                textResponse = openaiResult.choices[0].message.content;
                break;
            case 'deepseek':
                const deepseekResult = await deepseek.chat.completions.create({
                    model: "deepseek-chat",
                    messages: [{ role: "user", content: prompt }],
                });
                textResponse = deepseekResult.choices[0].message.content;
                break;
            case 'gemini':
            default: // 若無指定或前端傳來無法識別的名稱，一律使用Gemini作為預設
                const geminiResult = await geminiModel.generateContent(prompt);
                textResponse = (await geminiResult.response).text();
        }
        return textResponse;
    } catch (error) {
        console.error(`[AI 調度中心] 使用模型 ${modelName} 時出錯:`, error);
        throw new Error(`AI模型 ${modelName} 呼叫失敗，請檢查API金鑰與服務狀態。`);
    }
}


// =================================================================
// ============== 三大核心 AI 任務 (透過調度中心執行) ==============
// =================================================================

// 任務一：將結構化數據轉化為小說旁白
async function getNarrative(modelName, roundData) {
    const prompt = `
    你是一位功力深厚的武俠小說家，風格近似金庸。你的任務是將以下提供的結構化遊戲數據，改寫成一段充滿意境、文筆流暢、富有細節的敘述性小說段落。請自然地將所有數據融入到段落中，不要生硬地條列。重點是創造沉浸感。

    【本回合數據】:
    ${JSON.stringify(roundData, null, 2)}

    現在，請將以上數據改寫成一段精彩的小說段落。
    `;
    try {
        return await callAI(modelName, prompt);
    } catch (error) {
        console.error("[AI 任務失敗] 小說家任務:", error);
        return "在那一刻，時間的長河似乎出現了斷層，記憶的碎片未能拼湊成完整的畫面..."; // 提供優雅的錯誤訊息
    }
}

// 任務二：更新長期故事摘要
async function getAISummary(modelName, oldSummary, newRoundData) {
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
        const text = await callAI(modelName, prompt);
        // 確保能正確解析可能被程式碼標記包覆的JSON
        const cleanJsonText = text.replace(/^```json\s*|```\s*$/g, '');
        const parsedJson = JSON.parse(cleanJsonText);
        return parsedJson.summary;
    } catch (error) {
        console.error("[AI 任務失敗] 檔案管理員任務:", error);
        return oldSummary; // 如果更新失敗，返回舊摘要以維持遊戲狀態
    }
}

// 任務三：生成主要故事進展
async function getAIStory(modelName, longTermSummary, recentHistory, playerAction) {
    const prompt = `
    你是一個名為「江湖百曉生」的AI，是這個世界的頂級故事大師。你的風格基於金庸武俠小說，沉穩、寫實且富有邏輯。

    ## 長期故事摘要 (世界核心記憶):
    ${longTermSummary}

    ## 核心世界觀：
    1.  **時代背景**: 這是一個類似明朝中葉，但架空的武俠世界。朝廷腐敗，江湖動盪，各大門派與地方勢力盤根錯節。
    2.  **主角設定**: 主角是一個從21世紀現代社會，靈魂穿越到這個世界的年輕人。他附身在一個不知名、約15歲的少年身上。這具身體骨骼清奇、經脈異於常人，是萬中無一的練武奇才，但因為不明原因，正處於重傷瀕死的狀態。
    3.  **開場地點**: 主角目前在一個名為「無名村」的偏遠小村落。這個村莊地處偏僻，但周圍的山賊、惡霸、甚至不入流的小門派等惡勢力橫行，村民長年受到脅迫，生活困苦。

    ## 你必須嚴格遵守以下的規則：
    1. 你的所有回應都必須是一個完整的JSON物件，不要在前後添加任何額外的文字或 "\\\`\\\`\\\`json" 標記。
    2. JSON物件必須包含 "story" 和 "roundData" 兩個頂層鍵。
    3. "story" 鍵的值是一個字串，用來生動地描述故事發展，回覆必須用繁體中文，且字數控制在150字以內。
    4. "roundData" 鍵的值是一個物件，必須包含以下所有欄位，即使沒有內容也要用空字串""或空陣列[]表示：
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
    5. **絕對邏輯性**: 所有事件和物品的出現都必須有合理的因果關係。移動需要時間，不可能順移；物品不能憑空出現，必須是透過購買、尋找、製作、偷竊或他人贈與等合乎邏輯的方式獲得。
    6. **NPC的靈魂**: 你創造的每位NPC，都必須有基本的個性、動機和背景故事。他們會記住玩家的關鍵行為並做出相應反應。
    7. **寫實的成長**: 主角雖然是奇才，但成長需要過程。內力需要時間打坐修煉，武功招式需要練習才能純熟。

    ## 最近發生的事件 (短期記憶):
    ${recentHistory}

    ## 這是玩家的最新行動:
    "${playerAction}"

    現在，請根據以上的長期摘要、世界觀、規則、最近發生的事件和玩家的最新行動，生成下一回合的JSON物件。
    `;

    try {
        const text = await callAI(modelName, prompt);
        // 確保能正確解析可能被程式碼標記包覆的JSON
        const cleanJsonText = text.replace(/^```json\s*|```\s*$/g, '');
        return JSON.parse(cleanJsonText);
    } catch (error) {
        console.error("[AI 任務失敗] 故事大師任務:", error);
        return null; // 返回 null，讓主邏輯知道生成失敗
    }
}


// =================================================================
// ========================== API 路由 ===========================
// =================================================================

// 核心互動路由
app.post('/interact', async (req, res) => {
    try {
        // 從前端接收玩家行動、當前回合數，以及選擇的AI模型
        const { action: playerAction, round: currentRound, model: modelName = 'gemini' } = req.body;
        console.log(`[API /interact] 接收到玩家行動 (R${currentRound}), 請求模型: ${modelName}`);

        // 讀取遊戲的長期摘要
        const summaryDocRef = db.collection('game_state').doc('summary');
        const summaryDoc = await summaryDocRef.get();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始，一切都是未知的。";

        // 讀取最近的歷史紀錄作為短期記憶
        let recentHistoryRounds = [];
        const memoryDepth = 3; // AI能記住的最近回合數
        if (currentRound > 0) {
            const queries = [];
            for (let i = 0; i < memoryDepth; i++) {
                const roundToFetch = currentRound - i;
                if (roundToFetch > 0) {
                    queries.push(db.collection('game_saves').doc(`R${roundToFetch}`).get());
                }
            }
            const snapshots = await Promise.all(queries);
            snapshots.forEach(doc => { if (doc.exists) { recentHistoryRounds.push(doc.data()); } });
            recentHistoryRounds.sort((a, b) => a.R - b.R); // 確保歷史順序正確
        }
        const recentHistoryJson = JSON.stringify(recentHistoryRounds, null, 2);

        // 呼叫AI故事大師生成下一回合內容
        const aiResponse = await getAIStory(modelName, longTermSummary, recentHistoryJson, playerAction);

        if (!aiResponse || !aiResponse.roundData || !aiResponse.story) {
            throw new Error("主AI未能生成有效的JSON回應。");
        }

        const newRoundNumber = currentRound + 1;
        aiResponse.roundData.R = newRoundNumber;

        // 將新回合的結構化數據存檔
        const newRoundDocId = `R${newRoundNumber}`;
        await db.collection('game_saves').doc(newRoundDocId).set(aiResponse.roundData);
        console.log(`[Firebase] 回合 ${newRoundDocId} 已成功寫入!`);

        // 呼叫AI檔案管理員更新長期摘要
        const newSummary = await getAISummary(modelName, longTermSummary, aiResponse.roundData);

        // 將更新後的摘要寫回資料庫
        await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });
        console.log(`[Firebase] 故事摘要已更新至第 ${newRoundNumber} 回合。`);

        // 將生成的內容返回給前端
        res.json(aiResponse);

    } catch (error) {
        console.error("[API /interact] 處理請求時發生嚴重錯誤:", error);
        res.status(500).json({
            story: `[系統內部錯誤] ${error.message || '世界管理者的大腦出現了混亂，無法回應你的行動。請查看後端伺服器的日誌。'}`,
            roundData: { R: req.body.round, EVT: "系統錯誤" }
        });
    }
});

// 讀取最新進度路由
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
        console.error("[API /latest-game] 讀取最新進度時發生錯誤:", error);
        res.status(500).json({ message: 'Failed to load game.' });
    }
});

// 生成完整小說路由
app.get('/get-novel', async (req, res) => {
    try {
        const snapshot = await db.collection('game_saves').orderBy('R', 'asc').get();
        if (snapshot.empty) {
            res.status(404).json({ novel: ["故事尚未開始..."] });
            return;
        }
        // 為了節省API費用和提高速度，生成小說統一使用速度較快的 Gemini
        const narrativePromises = snapshot.docs.map(doc => getNarrative('gemini', doc.data()));
        const novelParagraphs = await Promise.all(narrativePromises);
        res.json({ novel: novelParagraphs });
    } catch (error) {
        console.error("[API /get-novel] 生成完整小說時出錯:", error);
        res.status(500).json({ novel: ["讀取故事時發生錯誤。"] });
    }
});

// 根目錄健康檢查路由
app.get('/', (req, res) => {
    res.send('AI 武俠世界伺服器已啟動，並已連接到Firebase和三大AI核心！');
});

// --- 啟動伺服器 ---
app.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});
