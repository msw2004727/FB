// routes/chatRoutes.js

const express = require('express');
const admin = require('firebase-admin');
const { getAIChatResponse, getAIChatSummary, getAISummary } = require('../services/aiService.js');
const authMiddleware = require('../middleware/auth.js'); // 【新增】導入驗證中間件

const router = express.Router();
const db = admin.firestore();

router.use(authMiddleware); // 【新增】在所有路由執行前，先進行身分驗證

// 獲取 NPC 公開資訊
router.get('/npc-profile/:npcName', async (req, res) => {
    const userId = req.user.id;
    const { npcName } = req.params;
    try {
        const npcDocRef = db.collection('users').doc(userId).collection('npcs').doc(npcName);
        const npcDoc = await npcDocRef.get();

        if (!npcDoc.exists) {
            return res.status(404).json({ message: '找不到該人物的檔案。' });
        }
        
        const npcData = npcDoc.data();
        
        const publicProfile = {
            name: npcData.name,
            appearance: npcData.appearance,
            friendliness: npcData.friendliness || 'neutral'
        };
        
        res.json(publicProfile);
    } catch (error) {
        console.error(`[密談系統] 獲取NPC(${npcName})檔案時出錯:`, error);
        res.status(500).json({ message: '讀取人物檔案時發生內部錯誤。' });
    }
});

// 處理即時對話
router.post('/npc-chat', async (req, res) => {
    const userId = req.user.id;
    const { npcName, chatHistory, playerMessage, model = 'gemini' } = req.body;

    try {
        const npcDocRef = db.collection('users').doc(userId).collection('npcs').doc(npcName);
        const npcDoc = await npcDocRef.get();
        if (!npcDoc.exists) {
            return res.status(404).json({ message: '對話目標不存在。' });
        }
        const npcProfile = npcDoc.data();
        
        const aiReply = await getAIChatResponse(model, npcProfile, chatHistory, playerMessage);
        
        if (aiReply) {
            res.json({ reply: aiReply });
        } else {
            res.status(500).json({ message: 'AI似乎在思考人生，沒有回應...' });
        }
    } catch (error) {
        console.error(`[密談系統] 與NPC(${npcName})對話時出錯:`, error);
        res.status(500).json({ message: '與人物交談時發生內部錯誤。' });
    }
});

// 結束對話並進行輕量級更新
router.post('/end-chat', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const { npcName, fullChatHistory } = req.body;

    if (!fullChatHistory || fullChatHistory.length < 2) {
        return res.json({ message: '你與對方點了點頭，沒有多說什麼。' });
    }

    try {
        const chatSummary = await getAIChatSummary('deepseek', username, npcName, fullChatHistory);
        if (!chatSummary) {
            throw new Error('AI未能成功總結對話內容。');
        }
        
        console.log(`[密談系統] 對話總結: "${chatSummary}"`);

        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        const summaryDoc = await summaryDocRef.get();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "";
        
        const summaryUpdateData = {
            EVT: `與 ${npcName} 的一番密談`,
            IMP: chatSummary,
            PC: '', NPC: [], ITM: '', QST: '', PSY: '', CLS: ''
        };
        const newSummary = await getAISummary('deepseek', longTermSummary, summaryUpdateData);
        await summaryDocRef.set({ text: newSummary });

        res.json({ message: `與 ${npcName} 的交談結束了。` });

    } catch (error) {
        console.error(`[密談系統] 結束與NPC(${npcName})的對話時出錯:`, error);
        res.status(500).json({ message: '結束對話時發生錯誤。' });
    }
});

module.exports = router;
