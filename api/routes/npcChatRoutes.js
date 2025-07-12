// /api/routes/npcChatRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIChatResponse, getAIGiveItemResponse, getAINarrativeForGive, getAIChatSummary, getAISuggestion, getAISummary, getAIPerNpcSummary } = require('../../services/aiService');
const { getMergedNpcProfile, getFriendlinessLevel, updateNpcMemoryAfterInteraction } = require('../npcHelpers');
const { getInventoryState } = require('../playerStateHelpers');
const { invalidateNovelCache, updateLibraryNovel } = require('../worldStateHelpers');
const { getKnownNpcNames } = require('../cacheManager');
const { processItemChanges } = require('../itemManager');

const db = admin.firestore();

/**
 * @route   POST /api/game/npc/chat
 * @desc    處理NPC聊天
 * @access  Private
 */
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
        
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : '無';
        const lastRoundData = lastSaveDoc.empty ? {} : lastSaveDoc.docs[0].data();
        const localLocationContext = lastRoundData.LOC ? { locationName: lastRoundData.LOC[0], description: lastRoundData.LOR } : null;

        const knownNpcs = getKnownNpcNames();
        const mentionedNpcNames = Array.from(knownNpcs).filter(name => playerMessage.includes(name) && name !== npcName);
        const mentionedNpcContext = mentionedNpcNames.length > 0 ? await getMergedNpcProfile(userId, mentionedNpcNames[0]) : null;
        
        const aiResponseString = await getAIChatResponse(model, npcProfile, chatHistory, playerMessage, longTermSummary, localLocationContext, mentionedNpcContext);
        
        let aiResponse;
        try {
            const cleanedJsonString = aiResponseString.replace(/^```json\s*|```\s*$/g, '');
            aiResponse = JSON.parse(cleanedJsonString);
        } catch(e) {
            console.error("解析密談AI回傳的JSON時失敗，將嘗試直接使用文字。", e);
            aiResponse = { response: aiResponseString, friendlinessChange: 0, romanceChange: 0, itemChanges: [] };
        }
        
        const batch = db.batch();
        const npcStateRef = db.collection('users').doc(userId).collection('npc_states').doc(npcName);

        if (aiResponse.friendlinessChange) {
            batch.set(npcStateRef, { friendlinessValue: admin.firestore.FieldValue.increment(aiResponse.friendlinessChange) }, { merge: true });
        }
        if (aiResponse.romanceChange) {
            batch.set(npcStateRef, { romanceValue: admin.firestore.FieldValue.increment(aiResponse.romanceChange) }, { merge: true });
        }

        if (aiResponse.itemChanges && aiResponse.itemChanges.length > 0) {
            console.log(`[密談系統] 偵測到 NPC「${npcName}」想要給予物品，啟動物品管理器...`);
            await processItemChanges(userId, aiResponse.itemChanges, batch, lastRoundData, npcName);
        }

        await batch.commit();
        
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


/**
 * @route   POST /api/game/npc/give-item
 * @desc    處理贈予物品
 * @access  Private
 */
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

        // 玩家給予NPC物品
        const itemKey = type === 'money' ? '銀兩' : itemName;
        const itemToRemove = { action: 'remove', itemName: itemKey, quantity: type === 'money' ? amount : (amount || 1) };
        await processItemChanges(userId, [itemToRemove], batch, lastRoundData, null); 
        batch.set(npcStateRef, { [`inventory.${itemKey}`]: admin.firestore.FieldValue.increment(itemToRemove.quantity) }, { merge: true });

        // 更新友好度
        if(friendlinessChange) {
             batch.set(npcStateRef, { friendlinessValue: admin.firestore.FieldValue.increment(friendlinessChange) }, { merge: true });
        }
        
        // NPC回禮
        if (npcItemGifts && npcItemGifts.length > 0) {
            await processItemChanges(userId, npcItemGifts, batch, lastRoundData, npcName);
        }
        
        await batch.commit();
        
        const newRoundNumber = lastRoundData.R + 1;
        const inventoryState = await getInventoryState(userId);
        
        let newRoundData = { ...lastRoundData, R: newRoundNumber, ITM: inventoryState.itemsString, money: inventoryState.money };
        newRoundData.PC = `${username}將${itemName || amount + '文錢'}贈予了${npcName}。`;
        newRoundData.EVT = `贈予${npcName}物品`;
        
        const updatedNpcProfile = await getMergedNpcProfile(userId, npcName);
        const npcIndex = newRoundData.NPC.findIndex(n => n.name === npcName);
        if (npcIndex > -1) {
            newRoundData.NPC[npcIndex].friendliness = getFriendlinessLevel(updatedNpcProfile.friendlinessValue);
            newRoundData.NPC[npcIndex].status = npc_response;
        } else {
            newRoundData.NPC.push({ name: npcName, status: npc_response, friendliness: getFriendlinessLevel(updatedNpcProfile.friendlinessValue) });
        }
        
        const baseNarrative = await getAINarrativeForGive(lastRoundData, username, npcName, itemName || `${amount}文錢`, npc_response);
        let giftNarrative = (npcItemGifts && npcItemGifts.length > 0) ? ` ${npcName}似乎對你的禮物十分滿意，並回贈了你「${npcItemGifts.map(g => g.itemName).join('、')}」。` : "";
        newRoundData.story = baseNarrative + giftNarrative;
        
        await updateNpcMemoryAfterInteraction(userId, npcName, `你贈予了我「${itemName || amount + '文錢'}」，我的反應是：「${npc_response}」。`);
        
        const [newSummary, suggestion] = await Promise.all([
            getAISummary(longTermSummary, newRoundData),
            getAISuggestion(newRoundData)
        ]);

        newRoundData.suggestion = suggestion;
        
        await db.collection('users').doc(userId).collection('game_saves').doc(`R${newRoundNumber}`).set(newRoundData);
        await db.collection('users').doc(userId).collection('game_state').doc('summary').set({ text: newSummary, lastUpdated: newRoundNumber });
        
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗:", err));

        res.json({ story: newRoundData.story, roundData: newRoundData, suggestion: newRoundData.suggestion });

    } catch (error) {
        console.error(`[贈予系統] 贈予NPC(${npcName})物品時出錯:`, error);
        res.status(500).json({ message: '贈予物品時發生內部錯誤。' });
    }
});


/**
 * @route   POST /api/game/npc/end-chat
 * @desc    處理結束對話
 * @access  Private
 */
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
