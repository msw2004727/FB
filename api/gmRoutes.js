// api/gmRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth');
const { getFriendlinessLevel, createNpcProfileInBackground, updateInventory } = require('./gameHelpers');
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
                    if (npc.name) {
                        mentionedNpcNames.add(npc.name);
                    }
                });
            }
        });

        mentionedNpcNames.forEach(name => {
            if (!existingNpcs.has(name)) {
                existingNpcs.set(name, {
                    id: name,
                    name: name,
                    isGhost: true // 標記為黑戶
                });
            }
        });

        const npcList = Array.from(existingNpcs.values());
        res.json(npcList);

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

    if (!npcName) {
        return res.status(400).json({ message: '未提供NPC名稱。' });
    }

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
        res.json({ message: `已成功為「${npcName}」提交重建檔案請求。` });
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
        const userSavesRef = db.collection('users').doc(userId).collection('game_saves');

        const locationsSnapshot = await locationsRef.get();
        const existingLocations = new Map();
        locationsSnapshot.forEach(doc => {
            const data = doc.data();
            existingLocations.set(doc.id, {
                id: doc.id,
                name: data.locationName || doc.id,
                isGhost: false
            });
        });

        const savesSnapshot = await userSavesRef.get();
        const mentionedLocationNames = new Set();
        savesSnapshot.forEach(doc => {
            const roundData = doc.data();
            if (roundData.LOC && roundData.LOC[0]) {
                mentionedLocationNames.add(roundData.LOC[0]);
            }
        });
        
        mentionedLocationNames.forEach(name => {
            if (!existingLocations.has(name)) {
                existingLocations.set(name, { id: name, name: name, isGhost: true });
            }
        });

        res.json(Array.from(existingLocations.values()));
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

        await generateAndCacheLocation(locationName, '未知', worldSummary);
        res.json({ message: `已成功為「${locationName}」提交重建檔案請求。` });
    } catch (error) {
        console.error(`[GM工具] 重建地區「${locationName}」時出錯:`, error);
        res.status(500).json({ message: '重建地區檔案時發生內部錯誤。' });
    }
});

// --- 【核心新增】玩家屬性管理API ---

/**
 * @route   GET /api/gm/item-templates
 * @desc    獲取所有已存在的物品模板列表
 * @access  Private (GM)
 */
router.get('/item-templates', async (req, res) => {
    try {
        const itemsSnapshot = await db.collection('items').get();
        if (itemsSnapshot.empty) {
            return res.json([]);
        }
        const itemList = itemsSnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().itemName }));
        res.json(itemList);
    } catch (error) {
        console.error(`[GM工具] 獲取物品模板時出錯:`, error);
        res.status(500).json({ message: '獲取物品模板失敗。' });
    }
});

/**
 * @route   POST /api/gm/update-player-resources
 * @desc    更新玩家的金錢或物品
 * @access  Private (GM)
 */
router.post('/update-player-resources', async (req, res) => {
    const userId = req.user.id;
    const { money, itemChange } = req.body;

    try {
        const userDocRef = db.collection('users').doc(userId);
        let promises = [];

        // 1. 更新金錢
        if (money !== undefined && !isNaN(money)) {
            const moneyAmount = Number(money);
            const inventoryRef = userDocRef.collection('game_state').doc('inventory');
            
            // 為了處理新的物品系統，我們需要找到"銀兩"這個物品實例並更新它，或者創建一個新的。
            const inventorySnapshot = await inventoryRef.get();
            const inventoryData = inventorySnapshot.exists ? inventorySnapshot.get() : {};
            let moneyKey = Object.keys(inventoryData).find(key => inventoryData[key].templateId === '銀兩');
            
            if (!moneyKey) {
                moneyKey = uuidv4(); // 如果沒有銀兩，就創建一個新的實例ID
            }

            const moneyItem = {
                templateId: '銀兩',
                quantity: moneyAmount,
                history: { event: '創世神之力介入', time: new Date().toISOString() }
            };
            promises.push(inventoryRef.set({ [moneyKey]: moneyItem }, { merge: true }));
        }

        // 2. 更新物品
        if (itemChange && itemChange.itemName && itemChange.action) {
            const fakeRoundData = {
                EVT: '創世神之力介入',
                yearName: '混沌', year: 0, month: 0, day: 0
            };
            promises.push(updateInventory(userId, [itemChange], fakeRoundData));
        }

        await Promise.all(promises);
        res.json({ message: '玩家資源已成功更新！' });

    } catch (error) {
        console.error(`[GM工具] 更新玩家資源時出錯:`, error);
        res.status(500).json({ message: '更新玩家資源失敗。' });
    }
});

module.exports = router;
