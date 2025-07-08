// /api/npcRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIChatResponse, getAIGiveItemResponse, getAINarrativeForGive, getAISummary, getAISuggestion } = require('../services/aiService');
const { getFriendlinessLevel, getInventoryState, updateInventory, invalidateNovelCache, updateLibraryNovel } = require('./gameHelpers');

const db = admin.firestore();

router.get('/npc-profile/:npcName', async (req, res) => {
    const userId = req.user.id;
    const { npcName } = req.params;
    try {
        const userDocRef = db.collection('users').doc(userId);
        const npcDocRef = userDocRef.collection('npcs').doc(npcName);

        const [latestSaveSnapshot, npcDoc] = await Promise.all([
            userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get(),
            npcDocRef.get()
        ]);

        if (!npcDoc.exists) {
            return res.status(404).json({ message: '找不到該人物的檔案。' });
        }

        const npcData = npcDoc.data();
        
        if (latestSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到玩家位置資訊。' });
        }
        const playerLocation = latestSaveSnapshot.docs[0].data().LOC[0];

        if (playerLocation !== npcData.currentLocation) {
            return res.status(403).json({ message: `你環顧四周，並未見到 ${npcName} 的身影。` });
        }

        const publicProfile = {
            name: npcData.name,
            appearance: npcData.appearance,
            friendliness: npcData.friendliness || 'neutral',
            romanceValue: npcData.romanceValue || 0,
            friendlinessValue: npcData.friendlinessValue || 0
        };

        res.json(publicProfile);

    } catch (error) {
        res.status(500).json({ message: '讀取人物檔案時發生內部錯誤。' });
    }
});

router.post('/npc-chat', async (req, res) => {
    const userId = req.user.id;
    const { npcName, chatHistory, playerMessage, model = 'gemini' } = req.body;
    try {
        const userDocRef = db.collection('users').doc(userId);
        const npcDocRef = userDocRef.collection('npcs').doc(npcName);
        const summaryDocRef = userDocRef.collection('game_state').doc('summary');

        const [npcDoc, summaryDoc] = await Promise.all([
            npcDocRef.get(),
            summaryDocRef.get()
        ]);

        if (!npcDoc.exists) {
            return res.status(404).json({ message: '對話目標不存在。' });
        }
        const npcProfile = npcDoc.data();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : '江湖事，無人知。';

        // 【核心修改】獲取NPC所在地的詳細情報
        let locationContext = null;
        if (npcProfile.currentLocation) {
            const locationDoc = await db.collection('locations').doc(npcProfile.currentLocation).get();
            if (locationDoc.exists) {
                locationContext = locationDoc.data();
            }
        }

        // 【核心修改】將地點情報傳遞給AI
        const aiReply = await getAIChatResponse(model, npcProfile, chatHistory, playerMessage, longTermSummary, locationContext);
        res.json({ reply: aiReply });
    } catch (error) {
        res.status(500).json({ message: '與人物交談時發生內部錯誤。' });
    }
});

router.post('/give-item', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const { giveData, model = 'gemini' } = req.body;
    const { target: npcName, itemName, amount, type } = giveData;

    try {
        const userDocRef = db.collection('users').doc(userId);
        const npcDocRef = userDocRef.collection('npcs').doc(npcName);
        const summaryDocRef = userDocRef.collection('game_state').doc('summary');


        const [userDoc, npcDoc, latestSaveSnapshot, summaryDoc] = await Promise.all([
            userDocRef.get(),
            npcDocRef.get(),
            userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get(),
            summaryDocRef.get()
        ]);

        if (!userDoc.exists || !npcDoc.exists || latestSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到玩家、NPC或遊戲存檔。' });
        }
        
        const playerProfile = userDoc.data();
        const npcProfile = npcDoc.data();
        let lastRoundData = latestSaveSnapshot.docs[0].data();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";


        const aiResponse = await getAIGiveItemResponse(model, playerProfile, npcProfile, giveData);
        if (!aiResponse) throw new Error('AI未能生成有效的贈予反應。');
        
        const { npc_response, friendlinessChange } = aiResponse;
        const newFriendlinessValue = (npcProfile.friendlinessValue || 0) + friendlinessChange;
        
        await npcDocRef.update({ 
            friendlinessValue: newFriendlinessValue,
            friendliness: getFriendlinessLevel(newFriendlinessValue)
        });

        const itemNameToRemove = type === 'money' ? '銀兩' : itemName;
        const quantityToRemove = type === 'money' ? amount : (amount || 1);
        await updateInventory(userId, [{ action: 'remove', itemName: itemNameToRemove, quantity: quantityToRemove }]);
        
        const newRoundNumber = lastRoundData.R + 1;
        const inventoryState = await getInventoryState(userId);
        
        let newRoundData = { ...lastRoundData };
        newRoundData.R = newRoundNumber;
        newRoundData.ITM = inventoryState.itemsString;
        newRoundData.money = inventoryState.money;
        newRoundData.PC = `${username}將${itemName || amount + '文錢'}贈予了${npcName}。`;
        newRoundData.EVT = `贈予${npcName}物品`;
        
        const npcIndex = newRoundData.NPC.findIndex(n => n.name === npcName);
        if (npcIndex > -1) {
            newRoundData.NPC[npcIndex].friendliness = getFriendlinessLevel(newFriendlinessValue);
            newRoundData.NPC[npcIndex].status = npc_response;
        } else {
            newRoundData.NPC.push({ name: npcName, status: npc_response, friendliness: getFriendlinessLevel(newFriendlinessValue) });
        }
        
        newRoundData.story = await getAINarrativeForGive(model, lastRoundData, username, npcName, itemName || `${amount}文錢`, npc_response);
        
        const [newSummary, suggestion] = await Promise.all([
            getAISummary(model, longTermSummary, newRoundData),
            getAISuggestion(model, newRoundData)
        ]);

        newRoundData.suggestion = suggestion;
        
        await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(newRoundData);
        await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });
        
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗:", err));

        res.json({
            story: newRoundData.story,
            roundData: newRoundData,
            suggestion: newRoundData.suggestion
        });

    } catch (error) {
        console.error(`[贈予系統] 贈予NPC(${npcName})物品時出錯:`, error);
        res.status(500).json({ message: '贈予物品時發生內部錯誤。' });
    }
});


module.exports = router;
