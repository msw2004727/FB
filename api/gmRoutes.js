// api/gmRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth');
const { getFriendlinessLevel, createNpcProfileInBackground } = require('./gameHelpers');
const { generateAndCacheLocation } = require('./worldEngine');
const { v4: uuidv4 } = require('uuid');

const db = admin.firestore();

// 所有GM路由都需要經過身份驗證
router.use(authMiddleware);

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
            existingNpcs.set(data.name || doc.id, {
                id: doc.id,
                name: data.name || doc.id,
                friendlinessValue: data.friendlinessValue || 0,
                romanceValue: data.romanceValue || 0,
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
        // 【核心修改】現在讀取全域的locations和玩家個人的location_states
        const locationsRef = db.collection('locations');
        const playerStatesRef = db.collection('users').doc(userId).collection('location_states');

        const [locationsSnapshot, playerStatesSnapshot] = await Promise.all([
            locationsRef.get(),
            playerStatesRef.get()
        ]);

        const allLocations = new Map();

        // 先加入所有已知的共享模板
        locationsSnapshot.forEach(doc => {
            const data = doc.data();
            allLocations.set(doc.id, {
                id: doc.id,
                name: data.locationName || doc.id,
                isGhost: false,
                hasState: false // 預設玩家沒有個人狀態
            });
        });
        
        // 更新有個人狀態的地點
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

        // 【核心修改】呼叫 generateAndCacheLocation 時，正確傳入 userId
        await generateAndCacheLocation(userId, locationName, '未知', worldSummary);
        
        res.json({ message: `已成功為「${locationName}」重建檔案。` });
    } catch (error) {
        console.error(`[GM工具] 重建地區「${locationName}」時出錯:`, error);
        res.status(500).json({ message: '重建地區檔案時發生內部錯誤。' });
    }
});

// --- 玩家屬性管理API ---

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
        let promises = [];

        if (money !== undefined && !isNaN(money)) {
            const moneyAmount = Number(money);
            const inventoryRef = userDocRef.collection('game_state').doc('inventory');
             await db.runTransaction(async transaction => {
                const doc = await transaction.get(inventoryRef);
                let inventory = doc.exists ? doc.data() : {};
                inventory['銀兩'] = {
                    ...(inventory['銀兩'] || {}),
                    quantity: moneyAmount,
                    itemType: '財寶',
                    rarity: '普通',
                    description: '流通的貨幣。'
                };
                transaction.set(inventoryRef, inventory);
            });
        }

        if (itemChange && itemChange.itemName && itemChange.action) {
            promises.push(updateInventory(userId, [itemChange]));
        }

        await Promise.all(promises);
        res.json({ message: '玩家資源已成功更新！' });

    } catch (error) {
        console.error(`[GM工具] 更新玩家資源時出錯:`, error);
        res.status(500).json({ message: '更新玩家資源失敗。' });
    }
});

module.exports = router;
