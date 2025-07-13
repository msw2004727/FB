// api/admin/adminRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const adminAuth = require('./adminAuth');
const { getLogs, getPlayersWithLogs } = require('./logService');
const { getApiBalances } = require('./balanceService');

// 引入重建模板所需的服務
const { generateNpcTemplateData } = require('../services/npcCreationService');
const { getOrGenerateItemTemplate, getOrGenerateSkillTemplate } = require('../playerStateHelpers');
const { generateAndCacheLocation } = require('../worldEngine');


const db = admin.firestore();

// 所有後台 API 都需要通過 adminAuth 中間件的驗證
router.use(adminAuth);

// --- 既有API (餘額、日誌) ---
router.get('/balances', async (req, res) => {
    try {
        const balances = await getApiBalances();
        res.json(balances);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});
router.get('/logs', async (req, res) => {
    try {
        const { playerId, limit = 150 } = req.query;
        const logs = await getLogs(playerId || null, parseInt(limit));
        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});
router.get('/players', async (req, res) => {
    try {
        const players = await getPlayersWithLogs();
        res.json(players);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// --- 【修改】模板管理通用函式 ---
const getTemplates = (collectionName) => async (req, res) => {
    try {
        const snapshot = await db.collection(collectionName).orderBy(admin.firestore.FieldPath.documentId()).get();
        const templates = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
        res.json(templates);
    } catch (error) {
        res.status(500).json({ message: `獲取 ${collectionName} 模板失敗：${error.message}` });
    }
};
const getTemplateById = (collectionName) => async (req, res) => {
    try {
        const { id } = req.params;
        const doc = await db.collection(collectionName).doc(id).get();
        if (!doc.exists) return res.status(404).json({ message: `找不到ID為 ${id} 的 ${collectionName} 模板。`});
        res.json(doc.data());
    } catch (error) {
        res.status(500).json({ message: `獲取 ${collectionName} 模板失敗：${error.message}` });
    }
};
const updateTemplateById = (collectionName) => async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        // 使用 set 並搭配 { merge: true } 來確保能更新巢狀欄位而不會覆蓋整個文件
        await db.collection(collectionName).doc(id).set(data, { merge: true });
        res.json({ message: `${collectionName} 模板更新成功。`});
    } catch (error) {
        res.status(500).json({ message: `更新 ${collectionName} 模板失敗：${error.message}` });
    }
};

// --- NPC 模板管理路由 ---
router.get('/npc-templates', getTemplates('npcs'));
router.get('/npc-templates/:id', getTemplateById('npcs'));
router.put('/npc-templates/:id', updateTemplateById('npcs'));

// --- 物品模板管理路由 ---
router.get('/item-templates', getTemplates('items'));
router.get('/item-templates/:id', getTemplateById('items'));
router.put('/item-templates/:id', updateTemplateById('items'));

// --- 地點模板管理路由 ---
router.get('/location-templates', getTemplates('locations'));
router.get('/location-templates/:id', getTemplateById('locations'));
router.put('/location-templates/:id', updateTemplateById('locations'));

// --- 【全新】技能模板管理路由 ---
router.get('/skill-templates', getTemplates('skills'));
router.get('/skill-templates/:id', getTemplateById('skills'));
router.put('/skill-templates/:id', updateTemplateById('skills'));


// --- 【全新】黑戶模板一鍵回填功能 ---

/**
 * 通用的黑戶回填邏輯
 * @param {string} playerSubCollection - 玩家子集合的名稱 (e.g., 'npc_states')
 * @param {string} rootCollection - 根模板集合的名稱 (e.g., 'npcs')
 * @param {Function} createTemplateFunc - 用於創建單一模板的非同步函式
 */
const rebuildBlackHouseholds = (playerSubCollection, rootCollection, createTemplateFunc) => async (req, res) => {
    console.log(`[黑戶回填] 開始執行 ${rootCollection} 的全局模板回填任務...`);
    try {
        const usersSnapshot = await db.collection('users').get();
        const blackHouseholds = new Set();
        const allPlayerSubDocs = [];

        // 1. 收集所有玩家子集合中的所有文件ID
        for (const userDoc of usersSnapshot.docs) {
            const subSnapshot = await userDoc.ref.collection(playerSubCollection).get();
            subSnapshot.forEach(subDoc => {
                const id = rootCollection === 'items' ? subDoc.data().templateId : subDoc.id;
                if(id) {
                    blackHouseholds.add(id);
                    allPlayerSubDocs.push({
                        userId: userDoc.id,
                        username: userDoc.data().username,
                        playerData: userDoc.data(),
                        docId: id
                    });
                }
            });
        }
        
        // 2. 獲取所有已存在的根模板ID
        const rootSnapshot = await db.collection(rootCollection).get();
        const existingRootIds = new Set(rootSnapshot.docs.map(doc => doc.id));

        // 3. 找出差異，即為所有黑戶
        const householdsToRebuild = new Set([...blackHouseholds].filter(id => !existingRootIds.has(id)));
        
        if (householdsToRebuild.size === 0) {
            return res.json({ message: '數據庫健康，未發現任何黑戶模板，無需重建。' });
        }

        console.log(`[黑戶回填] 發現 ${householdsToRebuild.size} 個黑戶 ${rootCollection} 模板，開始重建...`);
        let successCount = 0;
        let failCount = 0;

        // 4. 遍歷黑戶並重建
        for (const id of householdsToRebuild) {
            try {
                // 找到第一個提及這個黑戶的玩家資訊，作為AI生成的上下文
                const contextInfo = allPlayerSubDocs.find(p => (p.docId === id));
                if (contextInfo) {
                    await createTemplateFunc(contextInfo);
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (error) {
                console.error(`[黑戶回填] 重建 ${rootCollection} 模板 "${id}" 時失敗:`, error.message);
                failCount++;
            }
        }

        const summary = `任務完成！共發現 ${householdsToRebuild.size} 個黑戶模板。成功重建 ${successCount} 個，失敗 ${failCount} 個。`;
        console.log(`[黑戶回填] ${summary}`);
        res.json({ message: summary });

    } catch (error) {
        console.error(`[黑戶回填] 執行 ${rootCollection} 全局回填任務時發生嚴重錯誤:`, error);
        res.status(500).json({ message: `執行 ${rootCollection} 全局回填任務時發生嚴重錯誤: ${error.message}` });
    }
};


// NPC 黑戶回填的創建函式
const createNpcTemplate = async ({ userId, username, playerData, docId }) => {
    const allSavesSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
    const firstMentionRound = allSavesSnapshot.docs.map(d=>d.data()).find(round => round.NPC?.some(npc => npc.name === docId));
    if (firstMentionRound) {
        const generationResult = await generateNpcTemplateData(username, { name: docId }, firstMentionRound, playerData);
        if (generationResult && generationResult.templateData) {
            await db.collection('npcs').doc(generationResult.canonicalName).set(generationResult.templateData);
        } else { throw new Error('AI生成失敗'); }
    } else { throw new Error('找不到初見情境'); }
};

// 物品黑戶回填的創建函式
const createItemTemplate = async ({ docId }) => {
    // 物品生成不需要太多上下文
    await getOrGenerateItemTemplate(docId);
};

// 技能黑戶回填的創建函式
const createSkillTemplate = async ({ docId }) => {
    await getOrGenerateSkillTemplate(docId);
};

// 地點黑戶回填的創建函式
const createLocationTemplate = async ({ userId, docId }) => {
    // 地點生成需要一個摘要作為上下文
    const summaryDoc = await db.collection('users').doc(userId).collection('game_state').doc('summary').get();
    const worldSummary = summaryDoc.exists ? summaryDoc.data().text : '江湖軼事無可考。';
    await generateAndCacheLocation(userId, docId, '未知', worldSummary);
};

// 綁定路由
router.post('/rebuild-npc-templates', rebuildBlackHouseholds('npc_states', 'npcs', createNpcTemplate));
router.post('/rebuild-item-templates', rebuildBlackHouseholds('inventory_items', 'items', createItemTemplate));
router.post('/rebuild-skill-templates', rebuildBlackHouseholds('skills', 'skills', createSkillTemplate));
router.post('/rebuild-location-templates', rebuildBlackHouseholds('location_states', 'locations', createLocationTemplate));


module.exports = router;
