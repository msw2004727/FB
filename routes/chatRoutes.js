// routes/chatRoutes.js

import express from 'express';
import admin from 'firebase-admin';
import { getAIChatResponse, getAIChatSummary } from '../services/aiService.js';
import { handleInteraction } from './interactRoutes.js'; // 導入主互動邏輯

const router = express.Router();
const db = admin.firestore();

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

// 結束對話並更新主線
router.post('/end-chat', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const summaryModel = 'deepseek'; 
    const { npcName, fullChatHistory } = req.body;

    if (!fullChatHistory || fullChatHistory.length === 0) {
        return res.json({ message: '對話已結束，江湖故事繼續。' });
    }

    try {
        const chatSummary = await getAIChatSummary(summaryModel, username, npcName, fullChatHistory);
        if (!chatSummary) {
            throw new Error('AI未能成功總結對話內容。');
        }
        console.log(`[密談系統] 對話已結束，AI總結的玩家行動為: "${chatSummary}"`);

        const userDocRef = db.collection('users').doc(userId);
        const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const currentRound = savesSnapshot.docs.length > 0 ? savesSnapshot.docs[0].data().R : 0;
        
        const mainModel = (await userDocRef.get()).data()?.preferredModel || 'gemini';
        
        const mockedReq = {
            user: { id: userId, username: username },
            body: {
                action: chatSummary,
                round: currentRound,
                model: mainModel
            }
        };

        handleInteraction(mockedReq, res);

    } catch (error) {
        console.error(`[密談系統] 結束與NPC(${npcName})的對話時出錯:`, error);
        res.status(500).json({ message: '結束對話並更新世界時發生錯誤。' });
    }
});

export default router;
