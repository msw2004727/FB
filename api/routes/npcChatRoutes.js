// /api/routes/npcChatRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIChatResponse, getAIGiveItemResponse, getAINarrativeForGive, getAIChatSummary, getAISuggestion, getAISummary, getAIPerNpcSummary } = require('../../services/aiService');
const { getMergedNpcProfile, getFriendlinessLevel, updateNpcMemoryAfterInteraction } = require('../npcHelpers');
const { getRawInventory } = require('../playerStateHelpers'); // 【核心修正】移除不再存在的 getInventoryState
const { invalidateNovelCache, updateLibraryNovel } = require('../worldStateHelpers');
const { getKnownNpcNames } = require('../cacheManager');
const { processItemChanges } = require('../itemManager');
const { spendCurrency, addCurrency } = require('../economyManager');

const db = admin.firestore();

router.post('/chat', async (req, res) => {
    const userId = req.user.id;
    const { npcName, chatHistory, playerMessage, model = 'gemini' } = req.body;

    try {
        const [playerProfileDoc, npcProfile, summaryDoc, lastSaveDoc] = await Promise.all([
            db.collection('users').doc(userId).get(),
            getMergedNpcProfile(userId, npcName),
            db.collection('users').doc(userId).collection('game_state').doc('summary').get(),
            db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get()
        ]);
        
        if (!npcProfile) {
            console.error(`[NPC聊天系統] 嚴重錯誤：玩家 ${req.user.username} 試圖與一個不存在或無法讀取的NPC「${npcName}」聊天。`);
            return res.status(404).json({ message: `江湖中查無此人：「${npcName}」。` });
        }
        
        const playerProfile = playerProfileDoc.data();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : '無';
        const lastRoundData = lastSaveDoc.empty ? {} : lastSaveDoc.docs[0].data();
        const localLocationContext = lastRoundData.LOC ? { locationName: lastRoundData.LOC[0], description: lastRoundData.LOR } : null;

        const knownNpcs = getKnownNpcNames();
        const mentionedNpcNames = Array.from(knownNpcs).filter(name => playerMessage.includes(name) && name !== npcName);
        const mentionedNpcContext = mentionedNpcNames.length > 0 ? await getMergedNpcProfile(userId, mentionedNpcNames[0]) : null;
        
        const aiResponseString = await getAIChatResponse(model, npcProfile, chatHistory, playerMessage, longTermSummary, localLocationContext, mentionedNpcContext);
        
        let aiResponse;
        try {
            const cleanedJsonString = aiResponseString.trim().replace(/^```json\s*|```\s*$/g, '');
            aiResponse = JSON.parse(cleanedJsonString);
            if (typeof aiResponse.response !== 'string') {
                throw new Error("AI回傳的JSON中缺少 'response' 欄位。");
            }
        } catch (e) {
            console.warn(`[NPC 聊天系統] AI未能回傳有效的JSON，已將其作為純文字處理。原始回傳: "${aiResponseString}"`);
            aiResponse = { 
                response: aiResponseString,
                friendlinessChange: 0, 
                romanceChange: 0, 
                itemChanges: [] 
            };
        }
        
        const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);
        if (aiResponse.friendlinessChange || aiResponse.romanceChange) {
             await db.runTransaction(async (transaction) => {
                const npcStateDoc = await transaction.get(npcStateRef);
                if (!npcStateDoc.exists) { return; }
                const currentData = npcStateDoc.data();
                
                const updateData = {};
                
                if (aiResponse.friendlinessChange) {
                    const newFriendliness = (currentData.friendlinessValue || 0) + aiResponse.friendlinessChange;
                    updateData.friendlinessValue = Math.max(-100, Math.min(100, newFriendliness));
                }

                if (aiResponse.romanceChange) {
                    const newRomance = (currentData.romanceValue || 0) + aiResponse.romanceChange;
                    updateData.romanceValue = Math.min(100, newRomance);
                }
                
                transaction.set(npcStateRef, updateData, { merge: true });
            });
        }
        
        if (aiResponse.itemChanges && aiResponse.itemChanges.length > 0) {
            const batch = db.batch();
            await processItemChanges(userId, aiResponse.itemChanges, batch, lastRoundData, npcName);
            await batch.commit();
        }
        
        const finalResponse = {
            npcMessage: aiResponse.response,
            friendlinessChange: aiResponse.friendlinessChange || 0,
            romanceChange: aiResponse.romanceChange || 0,
            itemChanges: aiResponse.itemChanges || []
        };

        res.json(finalResponse);

    } catch (error) {
        console.error(`[NPC路由] /chat 錯誤:`, error);
        res.status(500).json({ message: '與對方交談時發生了意外。' });
    }
});


router.post('/give-item', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const { giveData, model = 'gemini' } = req.body;
    const { target: npcName, itemName, amount, type } = giveData;

    try {
        const [playerProfile, npcProfile, latestSaveSnapshot, summaryDoc] = await Promise.all([
            db.collection('users').doc(userId).get().then(doc => doc.data()),
            getMergedNpcProfile(userId, npcName),
            db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get(),
            db.collection('users').doc(userId).collection('game_state').doc('summary').get()
        ]);

        if (!playerProfile || !npcProfile || latestSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到玩家、NPC或遊戲存檔。' });
        }
        
        let lastRoundData = latestSaveSnapshot.docs[0].data();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";

        const aiResponse = await getAIGiveItemResponse(model, playerProfile, npcProfile, giveData);
        if (!aiResponse) throw new Error('AI未能生成有效的贈予反應。');
        
        const { npc_response, friendlinessChange, itemChanges: npcItemGifts } = aiResponse;
        
        const batch = db.batch();
        const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);
        
        // 處理玩家付出的物品/銀兩
        if (type === 'money') {
            await spendCurrency(userId, amount, batch);
        } else {
            // 對於普通物品，我們仍然使用 itemManager
            const itemToRemove = { action: 'remove', itemName: itemName, quantity: 1 };
            await processItemChanges(userId, [itemToRemove], batch, lastRoundData);
        }
        
        // 處理NPC收到的物品/銀兩 (這裡可以簡化，假設NPC總能收到)
        if (type === 'money') {
             batch.set(npcStateRef, { [`inventory.銀兩`]: admin.firestore.FieldValue.increment(amount) }, { merge: true });
        } else {
             batch.set(npcStateRef, { [`inventory.${itemName}`]: admin.firestore.FieldValue.increment(1) }, { merge: true });
        }
        
        if(friendlinessChange) {
            batch.set(npcStateRef, { friendlinessValue: admin.firestore.FieldValue.increment(friendlinessChange) }, { merge: true });
        }
        
        if (npcItemGifts && npcItemGifts.length > 0) {
            await processItemChanges(userId, npcItemGifts, batch, lastRoundData, npcName);
        }
        
        await batch.commit();
        
        const newRoundNumber = lastRoundData.R + 1;
        
        // 【核心修正】使用 getRawInventory 獲取最新的背包狀態來生成 ITM 字符串
        const updatedInventory = await getRawInventory(userId);
        const silverItem = updatedInventory.find(item => item.templateId === '銀兩');
        const silverAmount = silverItem ? silverItem.quantity : 0;
        const otherItems = updatedInventory
            .filter(item => item.templateId !== '銀兩')
            .map(item => `${item.itemName} x${item.quantity}`);
        const newItmString = otherItems.length > 0 ? otherItems.join('、') : '身無長物';

        let newRoundData = { 
            ...lastRoundData, 
            R: newRoundNumber, 
            ITM: newItmString,
            money: silverAmount // 雖然前端不用money了，但為了數據結構完整性，暫時保留
        };
        newRoundData.PC = `${username}將${itemName || amount + '兩銀子'}贈予了${npcName}。`;
        newRoundData.EVT = `贈予${npcName}物品`;
        
        const updatedNpcProfile = await getMergedNpcProfile(userId, npcName);
        const npcIndex = newRoundData.NPC.findIndex(n => n.name === npcName);
        if (npcIndex > -1) {
            newRoundData.NPC[npcIndex].friendliness = getFriendlinessLevel(updatedNpcProfile.friendlinessValue);
            newRoundData.NPC[npcIndex].status = npc_response;
        } else {
            newRoundData.NPC.push({ name: npcName, status: npc_response, friendliness: getFriendlinessLevel(updatedNpcProfile.friendlinessValue) });
        }
        
        const baseNarrative = await getAINarrativeForGive(lastRoundData, username, npcName, itemName || `${amount}兩銀子`, npc_response);
        let giftNarrative = (npcItemGifts && npcItemGifts.length > 0) ? ` ${npcName}似乎對你的禮物十分滿意，並回贈了你「${npcItemGifts.map(g => g.itemName).join('、')}」。` : "";
        newRoundData.story = baseNarrative + giftNarrative;
        
        await updateNpcMemoryAfterInteraction(userId, npcName, `你贈予了我「${itemName || amount + '兩銀子'}」，我的反應是：「${npc_response}」。`);
        
        const [newSummary, suggestion] = await Promise.all([
            getAISummary(longTermSummary, newRoundData),
            getAISuggestion(newRoundData)
        ]);

        newRoundData.suggestion = suggestion;
        
        await db.collection('users').doc(userId).collection('game_saves').doc(`R${newRoundNumber}`).set(newRoundData);
        await db.collection('users').doc(userId).collection('game_state').doc('summary').set({ text: newSummary, lastUpdated: newRoundNumber });
        
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗:", err));

        // 重新獲取一次完整的客戶端數據
        const finalInventory = await getRawInventory(userId);
        newRoundData.inventory = finalInventory;
        
        res.json({ story: newRoundData.story, roundData: newRoundData, suggestion: newRoundData.suggestion });

    } catch (error) {
        console.error(`[贈予系統] 贈予NPC(${npcName})物品時出錯:`, error);
        res.status(500).json({ message: '贈予物品時發生內部錯誤。' });
    }
});


router.post('/end-chat', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const { npcName, fullChatHistory, model: playerModelChoice } = req.body;

    if (!npcName || !fullChatHistory) {
        return res.status(400).json({ message: '缺少必要的對話數據。' });
    }

    try {
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        
        const [summaryDoc, lastSaveSnapshot] = await Promise.all([
            summaryDocRef.get(),
            db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get()
        ]);
        
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "對話發生在一個未知的時間點。";
        
        if (lastSaveSnapshot.empty) {
            return res.status(404).json({ message: "找不到玩家存檔。" });
        }
        let lastRoundData = lastSaveSnapshot.docs[0].data();
        
        const chatSummaryResult = await getAIChatSummary(playerModelChoice, username, npcName, fullChatHistory, longTermSummary);
        
        const formattedHistory = fullChatHistory.map(line => `${line.speaker}: "${line.message}"`).join('\n');
        await updateNpcMemoryAfterInteraction(userId, npcName, formattedHistory);

        const newRoundNumber = lastRoundData.R + 1;
        let newRoundData = { ...lastRoundData, R: newRoundNumber };

        newRoundData.story = chatSummaryResult.story || `你結束了與${npcName}的交談。`;
        newRoundData.EVT = chatSummaryResult.evt || `與${npcName}的一席話`;
        newRoundData.PC = `你與${npcName}深入交談了一番。`;

        const newOverallSummary = await getAISummary(longTermSummary, newRoundData);
        const suggestion = await getAISuggestion(newRoundData);
        newRoundData.suggestion = suggestion;
        
        const updatePromises = [
            db.collection('users').doc(userId).collection('game_saves').doc(`R${newRoundNumber}`).set(newRoundData),
            summaryDocRef.set({ text: newOverallSummary, lastUpdated: newRoundNumber }),
        ];
        
        await Promise.all(updatePromises);
        
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗(結束對話):", err));

        const finalInventory = await getRawInventory(userId);
        newRoundData.inventory = finalInventory;

        res.json({
            story: newRoundData.story,
            roundData: newRoundData,
            suggestion: newRoundData.suggestion,
        });

    } catch (error) {
        console.error(`[結束對話系統] 替玩家 ${username} 總結與 ${npcName} 的對話時出錯:`, error);
        res.status(500).json({ message: '總結對話時發生內部錯誤。' });
    }
});

module.exports = router;
