// api/gmRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth');
const { getFriendlinessLevel, createNpcProfileInBackground, updateInventory, getInventoryState } = require('./gameHelpers');
const { generateAndCacheLocation } = require('./worldEngine');
const { v4: uuidv4 } = require('uuid');

const db = admin.firestore();

// 所有GM路由都需要經過身份驗證
router.use(authMiddleware);

// --- 【核心新增】獲取所有可設定關係的角色列表 (玩家+所有NPC) ---
router.get('/characters', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const npcsSnapshot = await db.collection('users').doc(userId).collection('npcs').get();
        const characterList = [{ id: userId, name: username }]; // 將玩家自己加入列表

        npcsSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.name) {
                characterList.push({
                    id: doc.id,
                    name: data.name
                });
            }
        });
        res.json(characterList);
    } catch (error) {
        console.error(`[GM工具] 獲取角色列表時出錯:`, error);
        res.status(500).json({ message: '獲取角色列表失敗。' });
    }
});


// --- NPC管理相關API ---

router.get('/npcs', async (req, res) => {
    const userId = req.user.id;
    try {
        const userNpcsRef = db.collection('users').doc(userId).collection('npcs');
        const userSavesRef = db.collection('users').doc(userId).collection('game_saves');

        const npcsSnapshot = await userNpcsRef.get();
        const existingNpcs = new Map();
        npcsSnapshot.forEach(doc => {
            const data = doc.data();
            // 【核心修改】同時讀取關係數據
            existingNpcs.set(data.name || doc.id, {
                id: doc.id,
                name: data.name || doc.id,
                friendlinessValue: data.friendlinessValue || 0,
                romanceValue: data.romanceValue || 0,
                relationships: data.relationships || {}, // 讀取關係
                isGhost: false
            });
        });

        const savesSnapshot = await userSavesRef.get();
        const mentionedNpcNames = new Set();
        savesSnapshot.forEach(doc => {
            const roundData = doc.data();
            if (roundData.NPC && Array.isArray(roundData.NPC)) {
                roundData.NPC.forEach(npc => {
                    if (npc.name) mentionedNpcNames.add(npc.name);
                });
            }
        });

        mentionedNpcNames.forEach(name => {
            if (!existingNpcs.has(name)) {
                existingNpcs.set(name, { id: name, name: name, isGhost: true });
            }
        });

        res.json(Array.from(existingNpcs.values()));
    } catch (error) {
        console.error(`[GM工具] 獲取NPC列表時出錯:`, error);
        res.status(500).json({ message: '獲取NPC列表失敗。' });
    }
});

router.post('/update-npc', async (req, res) => {
    const userId = req.user.id;
    const { npcId, friendlinessValue, romanceValue } = req.body;
    if (!npcId) {
        return res.status(400).json({ message: '未提供NPC ID。' });
    }
    try {
        const npcRef = db.collection('users').doc(userId).collection('npcs').doc(npcId);
        const updates = {};
        if (friendlinessValue !== undefined) {
            updates.friendlinessValue = Number(friendlinessValue);
            updates.friendliness = getFriendlinessLevel(Number(friendlinessValue));
        }
        if (romanceValue !== undefined) {
            updates.romanceValue = Number(romanceValue);
        }
        if (Object.keys(updates).length > 0) {
            await npcRef.set(updates, { merge: true });
        }
        res.json({ message: `NPC「${npcId}」的數據已成功更新。` });
    } catch (error) {
        console.error(`[GM工具] 更新NPC「${npcId}」時出錯:`, error);
        res.status(500).json({ message: '更新NPC數據時發生內部錯誤。' });
    }
});

// --- 【核心新增】更新NPC關係的API ---
router.post('/update-npc-relationship', async (req, res) => {
    const userId = req.user.id;
    const { npcId, relationshipType, targetName } = req.body;

    if (!npcId || !relationshipType) {
        return res.status(400).json({ message: '缺少必要的參數(NPC ID或關係類型)。' });
    }

    try {
        const npcRef = db.collection('users').doc(userId).collection('npcs').doc(npcId);
        // 使用點標記法來更新巢狀物件中的特定欄位
        const fieldToUpdate = `relationships.${relationshipType}`;
        
        const updatePayload = {};
        // 如果 targetName 是空的，代表要刪除這個關係
        updatePayload[fieldToUpdate] = targetName ? targetName : admin.firestore.FieldValue.delete();

        await npcRef.set({
            relationships: {
                [relationshipType]: targetName || admin.firestore.FieldValue.delete()
            }
        }, { merge: true });
        
        res.json({ message: `NPC「${npcId}」的關係已更新。` });

    } catch (error) {
         console.error(`[GM工具] 更新NPC「${npcId}」的關係時出錯:`, error);
        res.status(500).json({ message: '更新NPC關係時發生內部錯誤。' });
    }
});

router.post('/rebuild-npc', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    const { npcName } = req.body;
    if (!npcName) return res.status(400).json({ message: '未提供NPC名稱。' });

    try {
        const savesSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
        let firstMentionRound = null;
        for (const doc of savesSnapshot.docs) {
            const roundData = doc.data();
            if (roundData.NPC?.some(npc => npc.name === npcName)) {
                firstMentionRound = roundData;
                break;
            }
        }

        if (!firstMentionRound) {
            return res.status(404).json({ message: `在存檔中找不到NPC「${npcName}」的初見情境。` });
        }

        await createNpcProfileInBackground(userId, username, { name: npcName, isNew: true }, firstMentionRound);
        
        res.json({ message: `已成功為「${npcName}」重建檔案。` });
    } catch (error) {
        console.error(`[GM工具] 重建NPC「${npcName}」時出錯:`, error);
        res.status(500).json({ message: '重建NPC檔案時發生內部錯誤。' });
    }
});

// --- 地區管理相關API ---
router.get('/locations', async (req, res) => {
    const userId = req.user.id;
    try {
        const locationsRef = db.collection('locations');
        const playerStatesRef = db.collection('users').doc(userId).collection('location_states');

        const [locationsSnapshot, playerStatesSnapshot] = await Promise.all([
            locationsRef.get(),
            playerStatesRef.get()
        ]);

        const allLocations = new Map();

        locationsSnapshot.forEach(doc => {
            const data = doc.data();
            allLocations.set(doc.id, {
                id: doc.id,
                name: data.locationName || doc.id,
                isGhost: false,
                hasState: false
            });
        });
        
        playerStatesSnapshot.forEach(doc => {
            if (allLocations.has(doc.id)) {
                allLocations.get(doc.id).hasState = true;
            }
        });

        res.json(Array.from(allLocations.values()));
    } catch (error) {
        console.error(`[GM工具] 獲取地區列表時出錯:`, error);
        res.status(500).json({ message: '獲取地區列表失敗。' });
    }
});

router.post('/rebuild-location', async (req, res) => {
    const userId = req.user.id;
    const { locationName } = req.body;
    if (!locationName) {
        return res.status(400).json({ message: '未提供地區名稱。' });
    }
    
    try {
        const summaryDoc = await db.collection('users').doc(userId).collection('game_state').doc('summary').get();
        const worldSummary = summaryDoc.exists ? summaryDoc.data().text : '江湖軼事無可考。';

        await generateAndCacheLocation(userId, locationName, '未知', worldSummary);
        
        res.json({ message: `已成功為「${locationName}」重建檔案。` });
    } catch (error) {
        console.error(`[GM工具] 重建地區「${locationName}」時出錯:`, error);
        res.status(500).json({ message: '重建地區檔案時發生內部錯誤。' });
    }
});

// --- 玩家屬性管理API ---
router.get('/player-state', async (req, res) => {
    const userId = req.user.id;
    try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: '找不到玩家檔案。' });
        }
        const userData = userDoc.data();
        const inventoryState = await getInventoryState(userId);

        res.json({
            internalPower: userData.internalPower || 0,
            externalPower: userData.externalPower || 0,
            lightness: userData.lightness || 0,
            morality: userData.morality || 0,
            money: inventoryState.money || 0,
        });
    } catch (error) {
        console.error(`[GM工具] 獲取玩家狀態時出錯:`, error);
        res.status(500).json({ message: '獲取玩家狀態失敗。' });
    }
});

router.post('/player-state', async (req, res) => {
    const userId = req.user.id;
    const { internalPower, externalPower, lightness, morality } = req.body;

    try {
        const userDocRef = db.collection('users').doc(userId);
        const updates = {};
        if (internalPower !== undefined) updates.internalPower = Number(internalPower);
        if (externalPower !== undefined) updates.externalPower = Number(externalPower);
        if (lightness !== undefined) updates.lightness = Number(lightness);
        if (morality !== undefined) updates.morality = Number(morality);
        
        if (Object.keys(updates).length > 0) {
            await userDocRef.update(updates);
        }
        res.json({ message: '玩家狀態已成功更新！' });
    } catch (error) {
        console.error(`[GM工具] 更新玩家狀態時出錯:`, error);
        res.status(500).json({ message: '更新玩家狀態失敗。' });
    }
});


router.get('/item-templates', async (req, res) => {
    try {
        const itemsSnapshot = await db.collection('items').get();
        if (itemsSnapshot.empty) {
            return res.json([]);
        }
        const itemList = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(itemList);
    } catch (error) {
        console.error(`[GM工具] 獲取物品模板時出錯:`, error);
        res.status(500).json({ message: '獲取物品模板失敗。' });
    }
});

router.post('/update-player-resources', async (req, res) => {
    const userId = req.user.id;
    const { money, itemChange } = req.body;

    try {
        const userDocRef = db.collection('users').doc(userId);
        
        if (money !== undefined && !isNaN(money)) {
            const moneyAmount = Number(money);
            const moneyRef = userDocRef.collection('inventory_items').doc('銀兩');
            await moneyRef.set({
                 itemName: '銀兩',
                 itemType: '財寶',
                 rarity: '普通',
                 quantity: moneyAmount,
                 description: '流通的貨幣。'
            }, { merge: true });
        }

        if (itemChange && itemChange.itemName && itemChange.action) {
            await updateInventory(userId, [itemChange]);
        }
        
        res.json({ message: '玩家資源已成功更新！' });

    } catch (error) {
        console.error(`[GM工具] 更新玩家資源時出錯:`, error);
        res.status(500).json({ message: '更新玩家資源失敗。' });
    }
});

router.post('/teleport', async (req, res) => {
    const userId = req.user.id;
    const { locationName } = req.body;

    if (!locationName) {
        return res.status(400).json({ message: '未提供目標地點。' });
    }

    try {
        const userDocRef = db.collection('users').doc(userId);
        const savesRef = userDocRef.collection('game_saves');

        const lastSaveSnapshot = await savesRef.orderBy('R', 'desc').limit(1).get();
        if (lastSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到任何存檔，無法執行瞬移。' });
        }
        
        const lastRoundData = lastSaveSnapshot.docs[0].data();
        const newRoundNumber = lastRoundData.R + 1;

        const teleportRoundData = {
            ...lastRoundData,
            R: newRoundNumber,
            EVT: '乾坤挪移',
            PC: `你感到一陣時空扭曲，下一刻已身處「${locationName}」。`,
            story: `一股無形的力量包裹住你的身體，周遭景物瞬間模糊、拉長、扭曲成絢爛的光帶。你感到一陣輕微的失重，彷彿靈魂被從軀體中抽離，穿梭於時間的洪流之中。這感覺稍縱即逝，當你再次睜開雙眼時，先前的景象已蕩然無存，取而代之的是一片全新的天地。你，已然抵達了「${locationName}」。`,
            IMP: `透過一股神秘的力量，你瞬間移動到了「${locationName}」。`,
            LOC: [locationName, { description: '一個全新的未知之地' }],
            NPC: [],
            CLS: '',
            QST: '探索這個新地方。'
        };

        await savesRef.doc(`R${newRoundNumber}`).set(teleportRoundData);
        
        await generateAndCacheLocation(userId, locationName);

        res.json({ message: `成功瞬移至「${locationName}」！請重新載入遊戲以更新畫面。` });

    } catch (error) {
        console.error(`[GM工具] 瞬移至「${locationName}」時出錯:`, error);
        res.status(500).json({ message: '執行乾坤挪移時發生未知錯誤。' });
    }
});

module.exports = router;
