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

// --- 模板管理通用函式 ---
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
        await db.collection(collectionName).doc(id).set(data, { merge: true });
        res.json({ message: `${collectionName} 模板更新成功。`});
    } catch (error) {
        res.status(500).json({ message: `更新 ${collectionName} 模板失敗：${error.message}` });
    }
};

// --- 各類模板管理路由 ---
router.get('/npc-templates', getTemplates('npcs'));
router.get('/npc-templates/:id', getTemplateById('npcs'));
router.put('/npc-templates/:id', updateTemplateById('npcs'));

router.get('/item-templates', getTemplates('items'));
router.get('/item-templates/:id', getTemplateById('items'));
router.put('/item-templates/:id', updateTemplateById('items'));

router.get('/location-templates', getTemplates('locations'));
router.get('/location-templates/:id', getTemplateById('locations'));
router.put('/location-templates/:id', updateTemplateById('locations'));

router.get('/skill-templates', getTemplates('skills'));
router.get('/skill-templates/:id', getTemplateById('skills'));
router.put('/skill-templates/:id', updateTemplateById('skills'));

// --- 【核心升級】黑戶與汙染模板一鍵回填功能 ---

/**
 * 檢查NPC模板是否為汙染模板
 * @param {object} data - NPC模板的數據
 * @returns {boolean} - 如果是汙染模板則返回true
 */
const isNpcTainted = (data) => {
    if (!data) return true; // 如果沒有數據，視為汙染
    const taintedMarkers = ["生成中", "不詳"];
    return taintedMarkers.some(marker => 
        (data.appearance || '').includes(marker) ||
        (data.background || '').includes(marker) ||
        (Array.isArray(data.personality) && data.personality.some(p => (p || '').includes(marker)))
    );
};

const rebuildBlackHouseholds = (playerSubCollection, rootCollection, createTemplateFunc, isTaintedFunc = () => false) => async (req, res) => {
    console.log(`[模板回填系統 v2.0] 開始執行 ${rootCollection} 的全局模板回填任務...`);
    try {
        const usersSnapshot = await db.collection('users').get();
        const allMentionedIds = new Set();
        const allPlayerSubDocs = [];

        for (const userDoc of usersSnapshot.docs) {
            const subSnapshot = await userDoc.ref.collection(playerSubCollection).get();
            subSnapshot.forEach(subDoc => {
                const id = rootCollection === 'items' ? subDoc.data().templateId : subDoc.id;
                if(id) {
                    allMentionedIds.add(id);
                    allPlayerSubDocs.push({
                        userId: userDoc.id,
                        username: userDoc.data().username,
                        playerData: userDoc.data(),
                        docId: id
                    });
                }
            });
        }
        
        const householdsToRebuild = new Set();
        
        // 分塊查詢所有被提及的根模板
        const mentionedIdsArray = Array.from(allMentionedIds);
        const rootDocs = new Map();
        for (let i = 0; i < mentionedIdsArray.length; i += 30) {
            const chunk = mentionedIdsArray.slice(i, i + 30);
            if (chunk.length > 0) {
                const rootSnapshot = await db.collection(rootCollection).where(admin.firestore.FieldPath.documentId(), 'in', chunk).get();
                rootSnapshot.forEach(doc => rootDocs.set(doc.id, doc.data()));
            }
        }

        // 判斷哪些需要重建
        for (const id of allMentionedIds) {
            const templateData = rootDocs.get(id);
            if (!templateData || isTaintedFunc(templateData)) {
                householdsToRebuild.add(id);
            }
        }
        
        if (householdsToRebuild.size === 0) {
            return res.json({ message: '數據庫健康，未發現任何黑戶或汙染模板，無需重建。' });
        }

        console.log(`[模板回填系統 v2.0] 發現 ${householdsToRebuild.size} 個黑戶或汙染模板，開始重建...`);
        let successCount = 0;
        let failCount = 0;
        let lastError = '';

        for (const id of householdsToRebuild) {
            try {
                const contextInfo = allPlayerSubDocs.find(p => p.docId === id);
                if (contextInfo) {
                    await createTemplateFunc(contextInfo);
                    successCount++;
                } else {
                    // 對於沒有上下文的物品或技能，直接生成
                    if (rootCollection === 'items' || rootCollection === 'skills') {
                         await createTemplateFunc({ docId: id });
                         successCount++;
                    } else {
                        failCount++;
                        lastError = `找不到 ${id} 的玩家上下文。`;
                    }
                }
            } catch (error) {
                console.error(`[模板回填系統 v2.0] 重建 ${rootCollection} 模板 "${id}" 時失敗:`, error.message);
                failCount++;
                lastError = error.message;
            }
        }

        const summary = `任務完成！共發現 ${householdsToRebuild.size} 個待辦模板。\n成功重建 ${successCount} 個，失敗 ${failCount} 個。` + (failCount > 0 ? `\n最後一個錯誤訊息: ${lastError}` : '');
        console.log(`[模板回填系統 v2.0] ${summary}`);
        res.json({ message: summary });

    } catch (error) {
        console.error(`[模板回填系統 v2.0] 執行 ${rootCollection} 全局回填任務時發生嚴重錯誤:`, error);
        res.status(500).json({ message: `執行 ${rootCollection} 全局回填任務時發生嚴重錯誤: ${error.message}` });
    }
};

// --- 各類模板的創建與回填邏輯 ---
const createNpcTemplate = async ({ userId, username, playerData, docId }) => {
    const allSavesSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
    const firstMentionRound = allSavesSnapshot.docs.map(d=>d.data()).find(round => round.NPC?.some(npc => npc.name === docId));
    if (firstMentionRound) {
        const generationResult = await generateNpcTemplateData(username, { name: docId }, firstMentionRound, playerData);
        if (generationResult && generationResult.templateData) {
            // 使用 set 覆蓋掉可能存在的汙染模板
            await db.collection('npcs').doc(generationResult.canonicalName).set(generationResult.templateData);
        } else { throw new Error('AI生成NPC失敗'); }
    } else { throw new Error('找不到NPC初見情境'); }
};

const createItemTemplate = async ({ docId }) => {
    await getOrGenerateItemTemplate(docId, {}); // 傳入空的回合數據
};

const createSkillTemplate = async ({ docId }) => {
    await getOrGenerateSkillTemplate(docId);
};

const createLocationTemplate = async ({ userId, docId }) => {
    const summaryDoc = await db.collection('users').doc(userId).collection('game_state').doc('summary').get();
    const worldSummary = summaryDoc.exists ? summaryDoc.data().text : '江湖軼事無可考。';
    await generateAndCacheLocation(userId, docId, '未知', worldSummary);
};

// 綁定路由
router.post('/rebuild-npc-templates', rebuildBlackHouseholds('npc_states', 'npcs', createNpcTemplate, isNpcTainted));
router.post('/rebuild-item-templates', rebuildBlackHouseholds('inventory_items', 'items', createItemTemplate));
router.post('/rebuild-skill-templates', rebuildBlackHouseholds('skills', 'skills', createSkillTemplate));
router.post('/rebuild-location-templates', rebuildBlackHouseholds('location_states', 'locations', createLocationTemplate));


module.exports = router;
