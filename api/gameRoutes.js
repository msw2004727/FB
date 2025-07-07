const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth');

const {
    getAIStory,
    getAISummary,
    getAIPrequel,
    getAISuggestion,
    getAIEncyclopedia,
    getAIRandomEvent,
    getAICombatAction,
    getAINpcProfile,
    getAIChatResponse,
    getAIChatSummary,
    getAIGiveItemResponse,
    getAINarrativeForGive,
    getRelationGraph,
    getAIRomanceEvent
} = require('../services/aiService');

const db = admin.firestore();

// --- Helper Functions ---
async function updateLibraryNovel(userId, username) {
    try {
        console.log(`[圖書館系統] 開始為玩家 ${username} (ID: ${userId}) 更新連載小說...`);
        const userSavesRef = db.collection('users').doc(userId).collection('game_saves');
        const snapshot = await userSavesRef.orderBy('R', 'asc').get();

        if (snapshot.empty) {
            console.log(`[圖書館系統] 玩家 ${username} 尚無任何遊戲存檔，取消更新。`);
            return;
        }

        const storyChapters = snapshot.docs.map(doc => {
            const roundData = doc.data();
            const title = roundData.EVT || `第 ${roundData.R} 回`;
            const content = roundData.story || "這段往事，已淹沒在時間的長河中。";
            return `<div class="chapter"><h2>${title}</h2><p>${content.replace(/\n/g, '<br>')}</p></div>`;
        });
        const fullStoryHTML = storyChapters.join('');

        const lastRoundData = snapshot.docs[snapshot.docs.length - 1].data();
        const isDeceased = lastRoundData.playerState === 'dead';

        const libraryDocRef = db.collection('library_novels').doc(userId);
        const libraryData = {
            playerName: username,
            novelTitle: `${username}的江湖路`,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            storyHTML: fullStoryHTML,
            isDeceased: isDeceased,
            lastChapterTitle: lastRoundData.EVT || `第 ${lastRoundData.R} 回`
        };

        await libraryDocRef.set(libraryData, { merge: true });
        console.log(`[圖書館系統] 成功更新 ${username} 的小說至圖書館！`);

    } catch (error) {
        console.error(`[圖書館系統] 為玩家 ${username} (ID: ${userId}) 更新小說時發生嚴重錯誤:`, error);
    }
}

const getFriendlinessLevel = (value) => {
    if (value >= 100) return 'devoted';
    if (value >= 70) return 'trusted';
    if (value >= 30) return 'friendly';
    if (value <= -100) return 'sworn_enemy';
    if (value <= -50) return 'hostile';
    if (value <= -10) return 'wary';
    return 'neutral';
};

const createNpcProfileInBackground = async (userId, username, npcData, roundData) => {
    const npcName = npcData.name;
    console.log(`[NPC系統] UserId: ${userId}。偵測到新NPC: "${npcName}"，已啟動背景建檔程序。`);

    try {
        const npcDocRef = db.collection('users').doc(userId).collection('npcs').doc(npcName);
        const npcDoc = await npcDocRef.get();
        if (npcDoc.exists) {
            console.log(`[NPC系統] "${npcName}" 的檔案已存在，取消建立。`);
            return;
        }

        const npcProfile = await getAINpcProfile('deepseek', username, npcName, roundData);

        if (npcProfile) {
            npcProfile.currentLocation = roundData.LOC[0];
            npcProfile.friendlinessValue = npcData.friendlinessValue || 0;
            npcProfile.friendliness = getFriendlinessLevel(npcProfile.friendlinessValue);
            await npcDocRef.set(npcProfile);
            console.log(`[NPC系統] 成功為 "${npcName}" 建立並儲存了詳細檔案。`);
        } else {
            console.log(`[NPC系統] AI 未能為 "${npcName}" 生成有效的檔案。`);
        }
    } catch (error) {
        console.error(`[NPC系統] 為 "${npcName}" 進行背景建檔時發生錯誤:`, error);
    }
};

async function updateInventory(userId, itemChanges) {
    if (!itemChanges || itemChanges.length === 0) {
        return;
    }
    const inventoryRef = db.collection('users').doc(userId).collection('game_state').doc('inventory');
    await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(inventoryRef);
        let inventory = doc.exists ? doc.data() : {};
        for (const change of itemChanges) {
            const { action, itemName, quantity = 1, itemType, rarity, description } = change;
            if (action === 'add') {
                if (inventory[itemName]) {
                    inventory[itemName].quantity += quantity;
                } else {
                    inventory[itemName] = { quantity, itemType: itemType || '其他', rarity: rarity || '普通', description: description || '一個神秘的物品。', addedAt: admin.firestore.FieldValue.serverTimestamp() };
                }
                console.log(`[物品系統] 新增物品: ${itemName} x${quantity}`);
            } else if (action === 'remove') {
                if (inventory[itemName] && inventory[itemName].quantity >= quantity) {
                    inventory[itemName].quantity -= quantity;
                    if (inventory[itemName].quantity <= 0) {
                        delete inventory[itemName];
                    }
                    console.log(`[物品系統] 移除物品: ${itemName} x${quantity}`);
                } else {
                    throw new Error(`物品移除失敗：試圖移除不存在或數量不足的物品'${itemName}'。`);
                }
            }
        }
        transaction.set(inventoryRef, inventory);
    });
}

async function updateRomanceValues(userId, romanceChanges) {
    if (!romanceChanges || romanceChanges.length === 0) {
        return;
    }

    console.log(`[戀愛系統] 偵測到心動值變化，開始更新...`, romanceChanges);
    const userNpcsRef = db.collection('users').doc(userId).collection('npcs');

    const romanceUpdatePromises = romanceChanges.map(async (change) => {
        const { npcName, valueChange } = change;
        if (!npcName || typeof valueChange !== 'number' || valueChange === 0) {
            return;
        }

        const npcDocRef = userNpcsRef.doc(npcName);
        try {
            await npcDocRef.update({
                romanceValue: admin.firestore.FieldValue.increment(valueChange)
            });
            console.log(`[戀愛系統] 成功更新NPC "${npcName}" 的心動值，變化: ${valueChange > 0 ? '+' : ''}${valueChange}`);
        } catch (error) {
            if (error.code === 5) {
                console.warn(`[戀愛系統] NPC "${npcName}" 的檔案或 romanceValue 欄位不存在。將嘗試創建欄位...`);
                await npcDocRef.set({ romanceValue: valueChange }, { merge: true });
                 console.log(`[戀愛系統] 成功為NPC "${npcName}" 創建並設定心動值: ${valueChange}`);
            } else {
                console.error(`[戀愛系統] 更新NPC "${npcName}" 心動值時出錯:`, error);
            }
        }
    });

    await Promise.all(romanceUpdatePromises);
}

async function checkAndTriggerRomanceEvent(userId, username, romanceChanges, roundData, model) {
    let triggeredEventNarrative = "";
    if (!romanceChanges || romanceChanges.length === 0) {
        return triggeredEventNarrative;
    }
    
    const userNpcsRef = db.collection('users').doc(userId).collection('npcs');

    for (const change of romanceChanges) {
        const { npcName } = change;
        const npcDocRef = userNpcsRef.doc(npcName);
        const npcDoc = await npcDocRef.get();

        if (!npcDoc.exists) continue;

        const npcProfile = npcDoc.data();
        const currentRomanceValue = npcProfile.romanceValue || 0;
        const triggeredEvents = npcProfile.triggeredRomanceEvents || [];

        if (currentRomanceValue >= 50 && !triggeredEvents.includes('level_1')) {
            console.log(`[戀愛系統] ${npcName} 的心動值 (${currentRomanceValue}) 已達到 Level 1 門檻，觸發特殊事件！`);
            
            const playerProfileForEvent = {
                username: username,
                location: roundData.LOC[0]
            };
            
            const eventNarrative = await getAIRomanceEvent(model, playerProfileForEvent, npcProfile, 'level_1');
            
            if (eventNarrative) {
                triggeredEventNarrative += `<div class="random-event-message romance-event">${eventNarrative}</div>`;
                
                await npcDocRef.update({
                    triggeredRomanceEvents: admin.firestore.FieldValue.arrayUnion('level_1')
                });
                console.log(`[戀愛系統] 已為 ${npcName} 標記 level_1 戀愛事件已觸發。`);
            }
        }
    }
    return triggeredEventNarrative;
}


async function getInventoryState(userId) {
    const inventoryRef = db.collection('users').doc(userId).collection('game_state').doc('inventory');
    const doc = await inventoryRef.get();
    if (!doc.exists) {
        return { money: 0, itemsString: '行囊空空' };
    }

    const inventory = doc.data();
    let money = 0;
    const otherItems = [];

    for (const [name, data] of Object.entries(inventory)) {
        if (name === '銀兩') {
            money = data.quantity || 0;
        } else {
            otherItems.push(`${name} x${data.quantity}`);
        }
    }

    return {
        money: money,
        itemsString: otherItems.length > 0 ? otherItems.join('、') : '身無長物'
    };
}

const TIME_SEQUENCE = ['清晨', '上午', '中午', '下午', '黃昏', '夜晚', '深夜'];
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function advanceDate(currentDate) {
    let { year, month, day, yearName } = currentDate;
    day++;
    if (day > DAYS_IN_MONTH[month]) {
        day = 1;
        month++;
        if (month > 12) { month = 1; year++; }
    }
    return { year, month, day, yearName };
}

// --- Middleware ---
router.use(authMiddleware);

// --- Routes ---

router.get('/inventory', async (req, res) => {
    const userId = req.user.id;
    try {
        const inventoryRef = db.collection('users').doc(userId).collection('game_state').doc('inventory');
        const doc = await inventoryRef.get();
        const inventoryData = doc.exists ? doc.data() : {};
        res.json(inventoryData);
    } catch (error) {
        console.error(`[庫存系統] 獲取背包資料時出錯:`, error);
        res.status(500).json({ message: '讀取背包資料時發生內部錯誤。' });
    }
});

router.get('/get-relations', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        const npcsSnapshot = await db.collection('users').doc(userId).collection('npcs').get();
        
        const summaryDoc = await summaryDocRef.get();

        if (!summaryDoc.exists || !summaryDoc.data().text) {
            return res.status(404).json({ message: '尚無足夠的故事摘要來生成關係圖。' });
        }

        const longTermSummary = summaryDoc.data().text;

        const npcDetails = {};
        npcsSnapshot.forEach(doc => {
            const data = doc.data();
            npcDetails[data.name] = {
                romanceValue: data.romanceValue || 0
            };
        });
        
        const mermaidSyntax = await getRelationGraph('deepseek', longTermSummary, username, npcDetails);
        
        res.json({ mermaidSyntax });

    } catch (error) {
        console.error(`[關係圖系統] 生成關係圖時出錯:`, error);
        res.status(500).json({ message: '梳理人物脈絡時發生未知錯誤。' });
    }
});


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
        const npcLocation = npcData.currentLocation;

        if (!npcLocation) {
             console.log(`[NPC系統] NPC ${npcName} 沒有位置資訊，為保持相容性，允許對話。`);
        } else {
             if (latestSaveSnapshot.empty) {
                return res.status(404).json({ message: '找不到玩家位置資訊。' });
            }
            const playerLocation = latestSaveSnapshot.docs[0].data().LOC[0];

            if (playerLocation !== npcLocation) {
                console.log(`[NPC系統] 互動失敗。玩家在「${playerLocation}」，NPC ${npcName} 在「${npcLocation}」。`);
                return res.status(403).json({ message: `你環顧四周，並未見到 ${npcName} 的身影。` });
            }
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
        console.error(`[密談系統] 獲取NPC(${npcName})檔案時出錯:`, error);
        res.status(500).json({ message: '讀取人物檔案時發生內部錯誤。' });
    }
});

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
        const userDoc = await userDocRef.get();
        const userProfile = userDoc.exists ? userDoc.data() : {};
        const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const currentRound = savesSnapshot.docs.length > 0 ? savesSnapshot.docs[0].data().R : 0;

        const mainModel = userProfile.preferredModel || 'gemini';

        const mockedReq = {
            user: { id: userId, username: username },
            body: {
                action: chatSummary,
                round: currentRound,
                model: mainModel
            }
        };

        interactRouteHandler(mockedReq, res);

    } catch (error) {
        console.error(`[密談系統] 結束與NPC(${npcName})的對話時出錯:`, error);
        res.status(500).json({ message: '結束對話並更新世界時發生錯誤。' });
    }
});

router.post('/give-item', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const { giveData, model = 'gemini' } = req.body;
    const { target: npcName, itemName, amount } = giveData;

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

        const itemChanges = [{ action: 'remove', itemName, quantity: amount || 1 }];
        await updateInventory(userId, itemChanges);
        
        const newRoundNumber = lastRoundData.R + 1;
        const inventoryState = await getInventoryState(userId);
        
        const newRoundData = { ...lastRoundData };
        newRoundData.R = newRoundNumber;
        newRoundData.ITM = inventoryState.itemsString;
        newRoundData.money = inventoryState.money;
        newRoundData.PC = `${username}將${itemName}贈予了${npcName}。`;
        newRoundData.EVT = `贈予${npcName}物品`;
        
        const npcIndex = newRoundData.NPC.findIndex(n => n.name === npcName);
        if (npcIndex !== -1) {
            newRoundData.NPC[npcIndex].friendliness = getFriendlinessLevel(newFriendlinessValue);
            newRoundData.NPC[npcIndex].status = npc_response;
        } else {
            newRoundData.NPC.push({ name: npcName, status: npc_response, friendliness: getFriendlinessLevel(newFriendlinessValue) });
        }
        
        const narrativeText = await getAINarrativeForGive(model, lastRoundData, username, npcName, itemName || `${amount}文錢`, npc_response);
        
        newRoundData.story = narrativeText; 
        
        const [newSummary, suggestion] = await Promise.all([
            getAISummary(model, longTermSummary, newRoundData),
            getAISuggestion(model, newRoundData)
        ]);
        
        await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(newRoundData);
        await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });

        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗:", err));

        res.json({
            story: narrativeText,
            roundData: newRoundData,
            suggestion: suggestion
        });

    } catch (error) {
        console.error(`[贈予系統] 贈予NPC(${npcName})物品時出錯:`, error);
        res.status(500).json({ message: '贈予物品時發生內部錯誤。' });
    }
});


const interactRouteHandler = async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;

    try {
        const { action: playerAction, round: currentRound, model: modelName = 'gemini' } = req.body;
        const userDocRef = db.collection('users').doc(userId);
        
        const userDoc = await userDocRef.get();
        const userProfile = userDoc.exists ? userDoc.data() : {};
        if (userProfile.isDeceased) {
            return res.status(403).json({ message: '逝者已矣，無法再有任何動作。' });
        }
        
        const summaryDocRef = userDocRef.collection('game_state').doc('summary');
        const [summaryDoc, savesSnapshot] = await Promise.all([
            summaryDocRef.get(),
            userDocRef.collection('game_saves').orderBy('R', 'desc').limit(3).get()
        ]);
        
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";
        let recentHistoryRounds = [];
        if (currentRound > 0) {
            savesSnapshot.forEach(doc => recentHistoryRounds.push(doc.data()));
            recentHistoryRounds.sort((a, b) => a.R - b.R);
        }
        
        const playerPower = { internal: userProfile.internalPower || 5, external: userProfile.externalPower || 5, lightness: userProfile.lightness || 5 };
        const playerMorality = userProfile.morality === undefined ? 0 : userProfile.morality;
        let currentDate = { yearName: userProfile.yearName || '元祐', year: userProfile.year || 1, month: userProfile.month || 1, day: userProfile.day || 1 };
        const currentTimeOfDay = userProfile.timeOfDay || '上午';

        const aiResponse = await getAIStory(modelName, longTermSummary, JSON.stringify(recentHistoryRounds), playerAction, { ...userProfile, ...currentDate }, username, currentTimeOfDay, playerPower, playerMorality);
        if (!aiResponse || !aiResponse.roundData) throw new Error("主AI未能生成有效回應。");

        const newRoundNumber = (currentRound || 0) + 1;
        aiResponse.roundData.R = newRoundNumber;
        
        aiResponse.story = aiResponse.story || "江湖靜悄悄，似乎什麼也沒發生。";
        
        await updateInventory(userId, aiResponse.roundData.itemChanges);
        await updateRomanceValues(userId, aiResponse.roundData.romanceChanges);
        
        const romanceEventNarrative = await checkAndTriggerRomanceEvent(userId, username, aiResponse.roundData.romanceChanges, aiResponse.roundData, modelName);

        if (romanceEventNarrative) {
            aiResponse.story = romanceEventNarrative + aiResponse.story;
        }
        aiResponse.roundData.story = aiResponse.story;


        const [newSummary, suggestion] = await Promise.all([
            getAISummary(modelName, longTermSummary, aiResponse.roundData).catch(err => {
                console.error("[優化流程] 摘要生成失敗，將沿用舊摘要:", err.message);
                return longTermSummary;
            }),
            getAISuggestion(modelName, aiResponse.roundData).catch(err => {
                console.error("[優化流程] 建議生成失敗:", err.message);
                return "先靜觀其變吧。";
            })
        ]);
        
        aiResponse.suggestion = suggestion;
        
        const inventoryState = await getInventoryState(userId);
        aiResponse.roundData.ITM = inventoryState.itemsString;
        aiResponse.roundData.money = inventoryState.money;
        
        if (aiResponse.roundData.NPC && Array.isArray(aiResponse.roundData.NPC)) {
            const npcUpdatePromises = aiResponse.roundData.NPC.map(npc => {
                const npcDocRef = userDocRef.collection('npcs').doc(npc.name);
                if (npc.isNew) {
                    delete npc.isNew; // isNew is a temporary flag, not to be saved in the NPC object itself.
                    return createNpcProfileInBackground(userId, username, npc, aiResponse.roundData);
                } else {
                    // 【***核心修改***】
                    // For any existing NPC present in the scene, update their location.
                    // This ensures NPCs who follow the player have their location updated correctly.
                    const newSceneLocation = aiResponse.roundData.LOC[0];
                    if (newSceneLocation) {
                        return npcDocRef.set({ currentLocation: newSceneLocation }, { merge: true });
                    }
                }
                return Promise.resolve();
            });
            await Promise.all(npcUpdatePromises);
        }

        let turnsSinceEvent = userProfile.turnsSinceEvent || 0;
        if (aiResponse.roundData.enterCombat) {
            const initialLog = aiResponse.roundData.combatIntro || '戰鬥開始了！';
            const combatState = { turn: 1, player: { username: username }, enemies: aiResponse.roundData.combatants, log: [initialLog] };
            await userDocRef.collection('game_state').doc('current_combat').set(combatState);
            aiResponse.combatInfo = { status: 'COMBAT_START', initialState: combatState };
            turnsSinceEvent = 0;
        } else {
            turnsSinceEvent++;
            if (turnsSinceEvent >= 5) {
                // ...
                turnsSinceEvent = 0;
            }
        }
        
        const { powerChange = {}, moralityChange = 0, timeOfDay: nextTimeOfDay, daysToAdvance } = aiResponse.roundData;
        
        if (daysToAdvance && typeof daysToAdvance === 'number' && daysToAdvance > 0) {
            for (let i = 0; i < daysToAdvance; i++) { currentDate = advanceDate(currentDate); }
        } else {
            const oldTimeIndex = TIME_SEQUENCE.indexOf(currentTimeOfDay);
            const newTimeIndex = TIME_SEQUENCE.indexOf(nextTimeOfDay || currentTimeOfDay);
            if (newTimeIndex < oldTimeIndex) { currentDate = advanceDate(currentDate); }
        }

        const newInternalPower = Math.max(0, Math.min(999, playerPower.internal + (powerChange.internal || 0)));
        const newExternalPower = Math.max(0, Math.min(999, playerPower.external + (powerChange.external || 0)));
        const newLightness = Math.max(0, Math.min(999, playerPower.lightness + (powerChange.lightness || 0)));
        let newMorality = playerMorality + moralityChange;
        newMorality = Math.max(-100, Math.min(100, newMorality));
        
        Object.assign(aiResponse.roundData, {
             internalPower: newInternalPower, externalPower: newExternalPower, lightness: newLightness, morality: newMorality, timeOfDay: nextTimeOfDay, ...currentDate 
        });

        await Promise.all([
             userDocRef.update({ 
                timeOfDay: nextTimeOfDay || currentTimeOfDay, 
                internalPower: newInternalPower, 
                externalPower: newExternalPower, 
                lightness: newLightness,
                morality: newMorality, 
                turnsSinceEvent: turnsSinceEvent, 
                preferredModel: modelName, 
                ...currentDate 
            }),
            summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber }),
            userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData)
        ]);

        if (aiResponse.roundData.playerState === 'dead') {
             await userDocRef.update({ isDeceased: true });
        }
        
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗:", err));

        res.json(aiResponse);

    } catch (error) {
        console.error(`[UserID: ${userId}] /interact 錯誤:`, error);
        if (!res.headersSent) {
            res.status(500).json({ message: error.message || "互動時發生未知錯誤" });
        }
    }
}
router.post('/interact', interactRouteHandler);


router.get('/get-encyclopedia', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        const npcsSnapshot = await db.collection('users').doc(userId).collection('npcs').get();

        const summaryDoc = await summaryDocRef.get();

        if (!summaryDoc.exists || !summaryDoc.data().text) {
            return res.json({ encyclopediaHtml: '<p class="loading">你的江湖經歷尚淺，還沒有可供編撰的百科內容。</p>' });
        }

        const longTermSummary = summaryDoc.data().text;

        const npcDetails = {};
        npcsSnapshot.forEach(doc => {
            const data = doc.data();
            npcDetails[data.name] = {
                romanceValue: data.romanceValue || 0
            };
        });

        let encyclopediaHtml = await getAIEncyclopedia('deepseek', longTermSummary, username, npcDetails);
        
        const style = `
        <style>
            .romance-meter { margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed #e0d8cd; }
            .romance-label { font-weight: bold; color: #a6324a; }
            .romance-meter .fas.fa-heart { color: #e54865; margin: 0 1px; }
            .romance-meter .far.fa-heart { color: #e0d8cd; margin: 0 1px; }
        </style>`;
        encyclopediaHtml = style + encyclopediaHtml;

        res.json({ encyclopediaHtml });

    } catch (error) {
        console.error(`[UserID: ${userId}] /get-encyclopedia 錯誤:`, error);
        res.status(500).json({ message: "編撰百科時發生未知錯誤。" });
    }
});


router.post('/combat-action', async (req, res) => {
    const userId = req.user.id;
    const { action, model } = req.body;
    const modelName = model || 'deepseek';

    try {
        const userDocRef = db.collection('users').doc(userId);
        const combatDocRef = userDocRef.collection('game_state').doc('current_combat');

        const combatDoc = await combatDocRef.get();
        if (!combatDoc.exists) {
            return res.status(404).json({ message: "戰鬥不存在或已結束。" });
        }

        let combatState = combatDoc.data();
        combatState.log.push(`> ${action}`);

        const userDoc = await userDocRef.get();
        let playerProfile = userDoc.exists ? userDoc.data() : {};

        const combatResult = await getAICombatAction(modelName, playerProfile, combatState, action);

        if (!combatResult) throw new Error("戰鬥裁判AI未能生成有效回應。");

        combatState.log.push(combatResult.narrative);
        combatState.turn++;

        if (combatResult.combatOver) {
            console.log(`[戰鬥系統] 玩家 ${playerProfile.username} 的戰鬥已結束。`);
            await combatDocRef.delete();

            const outcome = combatResult.outcome || {};
            const changes = outcome.playerChanges || {};
            const powerChange = changes.powerChange || {};
            const pcChange = changes.PC || "";
            const moralityChange = changes.moralityChange || 0;
            const internalPowerChange = powerChange.internal || 0;
            const externalPowerChange = powerChange.external || 0;
            const lightnessPowerChange = powerChange.lightness || 0;

            const updatedProfile = {
                internalPower: (playerProfile.internalPower || 0) + internalPowerChange,
                externalPower: (playerProfile.externalPower || 0) + externalPowerChange,
                lightness: (playerProfile.lightness || 0) + lightnessPowerChange,
                morality: (playerProfile.morality || 0) + moralityChange
            };
            playerProfile = { ...playerProfile, ...updatedProfile };

            const lastRoundSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
            const lastRound = lastRoundSnapshot.empty ? { R: 0 } : lastRoundSnapshot.docs[0].data();

            const summaryDocRef = userDocRef.collection('game_state').doc('summary');
            const summaryDoc = await summaryDocRef.get();
            const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...";

            const recentHistorySnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(2).get();
            const recentHistoryRounds = recentHistorySnapshot.docs.map(doc => doc.data()).reverse();

            const postCombatAction = `戰鬥剛剛結束。結局：${outcome.summary || '戰鬥結束'}。我的狀態變化：${pcChange || '無'}。`;
            const aiResponse = await getAIStory(modelName, longTermSummary, JSON.stringify(recentHistoryRounds), postCombatAction, playerProfile, playerProfile.username, playerProfile.timeOfDay, updatedProfile, updatedProfile.morality);

            if (!aiResponse) throw new Error("戰鬥後AI未能生成有效回應。");

            const newRoundNumber = (lastRound.R || 0) + 1;
            aiResponse.roundData.R = newRoundNumber;
            
            aiResponse.story = aiResponse.story || combatResult.narrative;
            aiResponse.roundData.story = aiResponse.story;

            const inventoryState = await getInventoryState(userId);
            aiResponse.roundData.ITM = inventoryState.itemsString;
            aiResponse.roundData.money = inventoryState.money;
            
            const finalInternalPower = Math.max(0, Math.min(999, updatedProfile.internalPower + (aiResponse.roundData.powerChange?.internal || 0)));
            const finalExternalPower = Math.max(0, Math.min(999, updatedProfile.externalPower + (aiResponse.roundData.powerChange?.external || 0)));
            const finalLightness = Math.max(0, Math.min(999, updatedProfile.lightness + (aiResponse.roundData.powerChange?.lightness || 0)));
            const finalMorality = Math.max(-100, Math.min(100, updatedProfile.morality + (aiResponse.roundData.moralityChange || 0)));

            Object.assign(aiResponse.roundData, {
                internalPower: finalInternalPower,
                externalPower: finalExternalPower,
                lightness: finalLightness,
                morality: finalMorality
            });

            await userDocRef.update({
                internalPower: finalInternalPower,
                externalPower: finalExternalPower,
                lightness: finalLightness,
                morality: finalMorality,
                timeOfDay: aiResponse.roundData.timeOfDay || playerProfile.timeOfDay,
            });

            const newSummary = await getAISummary(modelName, longTermSummary, aiResponse.roundData);
            await summaryDocRef.set({ text: newSummary, lastUpdated: newRoundNumber });
            
            const suggestion = await getAISuggestion(modelName, aiResponse.roundData);
            await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData);
            
            updateLibraryNovel(userId, playerProfile.username).catch(err => console.error("背景更新圖書館失敗:", err));

            res.json({
                status: 'COMBAT_END',
                newRound: {
                    story: aiResponse.story,
                    roundData: aiResponse.roundData,
                    suggestion: suggestion
                }
            });

        } else {
            await combatDocRef.set(combatState);
            res.json({
                status: 'COMBAT_ONGOING',
                narrative: combatResult.narrative
            });
        }

    } catch (error) {
        console.error(`[UserID: ${userId}] /combat-action 錯誤:`, error);
        res.status(500).json({ message: error.message || "戰鬥中發生未知錯誤" });
    }
});

router.get('/latest-game', async (req, res) => {
    const userId = req.user.id;
    try {
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        const userData = userDoc.data() || {};

        if (userData && userData.isDeceased) {
            return res.json({ gameState: 'deceased' });
        }

        const snapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        if (snapshot.empty) {
            return res.status(404).json({ message: '找不到存檔紀錄。' });
        }

        let latestGameData = snapshot.docs[0].data();

        const inventoryState = await getInventoryState(userId);
        latestGameData.ITM = inventoryState.itemsString;
        latestGameData.money = inventoryState.money;
        
        Object.assign(latestGameData, {
            internalPower: userData.internalPower || 5,
            externalPower: userData.externalPower || 5,
            lightness: userData.lightness || 5,
            morality: userData.morality === undefined ? 0 : userData.morality,
            preferredModel: userData.preferredModel,
        });

        const modelToUse = userData.preferredModel || 'openai';

        const [prequelText, suggestion] = await Promise.all([
            getAIPrequel(modelToUse, [latestGameData]),
            getAISuggestion(modelToUse, latestGameData)
        ]);

        const narrativeText = latestGameData.story || "你靜靜地站在原地，思索著下一步。";

        res.json({
            prequel: prequelText,
            story: narrativeText,
            roundData: latestGameData,
            suggestion: suggestion
        });

    } catch (error) {
        console.error(`[UserID: ${userId}] /latest-game 錯誤:`, error);
        res.status(500).json({ message: "讀取最新進度失敗。" });
    }
});

router.get('/get-novel', async (req, res) => {
    const userId = req.user.id;
    try {
        const novelCacheRef = db.collection('users').doc(userId).collection('game_state').doc('novel_cache');
        const novelCacheDoc = await novelCacheRef.get();

        if (novelCacheDoc.exists && novelCacheDoc.data().paragraphs) {
            console.log(`[小說系統] 從快取中讀取小說...`);
            return res.json({ novel: novelCacheDoc.data().paragraphs });
        }

        console.log(`[小說系統] 快取不存在，開始即時生成小說...`);
        const snapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
        if (snapshot.empty) {
            return res.json({ novel: [] });
        }

        const narrativePromises = snapshot.docs.map(doc => {
            const roundData = doc.data();
            const narrativeText = roundData.story || "這段往事，已淹沒在時間的長河中。";
            return Promise.resolve({
                text: narrativeText,
                npcs: roundData.NPC || []
            });
        });

        const novelParagraphs = await Promise.all(narrativePromises);

        await novelCacheRef.set({ paragraphs: novelParagraphs });
        console.log(`[小說系統] 小說生成完畢並已存入快取。`);

        res.json({ novel: novelParagraphs });

    } catch (error) {
        console.error(`[UserID: ${userId}] /get-novel 錯誤:`, error);
        res.status(500).json({ message: "生成小說時出錯。" });
    }
});

router.post('/restart', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const userDocRef = db.collection('users').doc(userId);

        await updateLibraryNovel(userId, username).catch(err => console.error("輪迴前更新圖書館失敗:", err));
        
        const collections = ['game_saves', 'npcs', 'game_state'];
        for (const col of collections) {
            const snapshot = await userDocRef.collection(col).get();
            const batch = db.batch();
            snapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
            });
            await batch.commit();
        }

        await userDocRef.update({
            isDeceased: admin.firestore.FieldValue.delete(),
            timeOfDay: admin.firestore.FieldValue.delete(),
            internalPower: admin.firestore.FieldValue.delete(),
            externalPower: admin.firestore.FieldValue.delete(),
            lightness: admin.firestore.FieldValue.delete(),
            morality: admin.firestore.FieldValue.delete(),
            year: admin.firestore.FieldValue.delete(),
            month: admin.firestore.FieldValue.delete(),
            day: admin.firestore.FieldValue.delete(),
            yearName: admin.firestore.FieldValue.delete(),
            turnsSinceEvent: admin.firestore.FieldValue.delete(),
            preferredModel: admin.firestore.FieldValue.delete()
        });

        res.status(200).json({ message: '新的輪迴已開啟，願你這次走得更遠。' });

    } catch (error) {
        console.error(`[UserID: ${userId}] /restart 錯誤:`, error);
        res.status(500).json({ message: '開啟新的輪迴時發生錯誤。' });
    }
});

router.post('/force-suicide', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        const userProfile = userDoc.exists ? userDoc.data() : {};

        await userDocRef.update({ isDeceased: true });

        const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const lastRound = savesSnapshot.empty ? { R: 0 } : savesSnapshot.docs[0].data();

        const newRoundNumber = (lastRound.R || 0) + 1;

        const finalRoundData = {
            R: newRoundNumber,
            playerState: 'dead',
            timeOfDay: userProfile.timeOfDay || '上午',
            internalPower: userProfile.internalPower || 5,
            externalPower: userProfile.externalPower || 5,
            lightness: userProfile.lightness || 5,
            morality: userProfile.morality === undefined ? 0 : userProfile.morality,
            yearName: userProfile.yearName || '元祐',
            year: userProfile.year || 1,
            month: userProfile.month || 1,
            day: userProfile.day || 1,
            ATM: ['決絕', '悲壯'],
            EVT: '英雄末路',
            LOC: ['原地', {}],
            PSY: '江湖路遠，就此終焉。',
            PC: `${username}引動內力，逆轉經脈，在一陣刺目的光芒中...化為塵土。`,
            NPC: [],
            itemChanges: [],
            QST: '所有恩怨情仇，煙消雲散。',
            WRD: '一聲巨響傳遍數里，驚動了遠方的勢力。',
            LOR: '',
            CLS: '',
            IMP: '你選擇了以最壯烈的方式結束這段江湖行。'
        };
        
        finalRoundData.story = finalRoundData.PC;

        await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(finalRoundData);
        
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗:", err));

        res.json({
            story: finalRoundData.PC,
            roundData: finalRoundData,
            suggestion: '你的江湖路已到盡頭...'
        });

    } catch (error) {
        console.error(`[UserID: ${userId}] /force-suicide 錯誤:`, error);
        res.status(500).json({ message: '了此殘生時發生未知錯誤...' });
    }
});


module.exports = router;
