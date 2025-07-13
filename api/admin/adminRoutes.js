// api/admin/adminRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const adminAuth = require('./adminAuth');
const { getLogs, getPlayersWithLogs } = require('./logService'); // getPlayersWithLogs 仍用於日誌篩選
const { getApiBalances } = require('./balanceService');
const { generateNpcTemplateData } = require('../../services/npcCreationService');
const { getOrGenerateItemTemplate, getOrGenerateSkillTemplate } = require('../../playerStateHelpers');
const { generateAndCacheLocation } = require('../../worldEngine');
const { getRelationshipFixPrompt } = require('../../prompts/relationshipFixPrompt');
const { callAI, aiConfig } = require('../../services/aiService');

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
        // 為了日誌篩選，這裡仍然可以使用舊的函式
        const logs = await getLogs(playerId || null, parseInt(limit));
        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @route   GET /api/admin/players
 * @desc    獲取所有玩家列表
 * @access  Private (Admin)
 */
router.get('/players', async (req, res) => {
    try {
        // 【核心修正】直接從 /users 集合獲取所有玩家ID
        const usersSnapshot = await db.collection('users').get();
        if (usersSnapshot.empty) {
            return res.json([]);
        }
        const playerIds = usersSnapshot.docs.map(doc => doc.id);
        res.json(playerIds);
    } catch (error) {
        console.error('[Admin API] 獲取所有玩家列表時發生錯誤:', error);
        res.status(500).json({ message: '從資料庫獲取完整玩家列表時失敗。' });
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


// --- 關係鏈修復系統 ---
router.post('/repair-relationships', async (req, res) => {
    console.log('[關係修復系統] 任務啟動...');
    const { playerId } = req.body;
    if (!playerId) {
        return res.status(400).json({ message: '必須提供玩家ID。' });
    }
    res.status(202).json({ message: `任務已接收！正在為玩家 ${playerId.substring(0,8)}... 在後台修復關係鏈。請查看Render後台日誌以獲取詳細進度。` });
    (async () => {
        try {
            const playerDoc = await db.collection('users').doc(playerId).get();
            if (!playerDoc.exists) { console.error(`[關係修復系統] 錯誤：找不到玩家 ${playerId}。`); return; }
            const playerData = playerDoc.data();
            const playerName = playerData.username;
            const npcsSnapshot = await db.collection('npcs').get();
            const allNpcs = new Map(npcsSnapshot.docs.map(doc => [doc.id, doc.data()]));
            const connected = new Set([playerName]);
            let queue = [];
            const playerNpcStates = await db.collection('users').doc(playerId).collection('npc_states').get();
            playerNpcStates.forEach(doc => queue.push(doc.id));
            while (queue.length > 0) {
                const currentNpcName = queue.shift();
                if (!currentNpcName || connected.has(currentNpcName)) continue;
                connected.add(currentNpcName);
                const npcData = allNpcs.get(currentNpcName);
                if (npcData && npcData.relationships) {
                    for (const target of Object.values(npcData.relationships)) {
                        if (typeof target === 'string' && !connected.has(target)) {
                            queue.push(target);
                        } else if (Array.isArray(target)) {
                            target.forEach(t => { if(typeof t === 'string' && !connected.has(t)) queue.push(t); });
                        }
                    }
                }
            }
            const orphans = [];
            allNpcs.forEach((data, name) => { if (!connected.has(name)) { orphans.push(name); } });
            if (orphans.length === 0) { console.log('[關係修復系統] 關係網絡健康，沒有發現任何孤立的NPC。'); return; }
            console.log(`[關係修復系統] 發現 ${orphans.length} 個孤立NPC，開始AI修復...`);
            let repairedCount = 0;
            const summaryDocRef = db.collection('users').doc(playerId).collection('game_state').doc('summary');
            for (const orphanName of orphans) {
                try {
                    const orphanData = allNpcs.get(orphanName);
                    const prompt = getRelationshipFixPrompt(playerData, orphanData);
                    const resultJson = await callAI(aiConfig.relationGraph || 'openai', prompt, true);
                    const { story, relationship } = JSON.parse(resultJson);
                    const summarySnapshot = await summaryDocRef.get();
                    const oldSummary = summarySnapshot.exists ? summarySnapshot.data().text || '' : '';
                    const newSummary = oldSummary + `\n\n【補記】：${story}`;
                    await summaryDocRef.set({ text: newSummary }, { merge: true });
                    const playerNpcStateRef = db.collection('users').doc(playerId).collection('npc_states').doc(orphanName);
                    await playerNpcStateRef.set({ friendlinessValue: 10, interactionSummary: story, firstMet: { event: story, round: '補記' } }, { merge: true });
                    console.log(`[關係修復系統] 已為 ${playerName} 和 ${orphanName} 建立新的關係: ${relationship}`);
                    repairedCount++;
                } catch(e) { console.error(`修復 ${orphanName} 的關係時失敗:`, e.message); }
            }
            console.log(`[關係修復系統] 任務完成！共發現 ${orphans.length} 個孤立NPC，成功修復了 ${repairedCount} 個。`);
        } catch (error) { console.error('[關係修復系統] 背景執行時發生嚴重錯誤:', error); }
    })().catch(err => console.error('[關係修復系統] 背景任務未能正確啟動:', err));
});


// --- 黑戶與汙染模板一鍵回填功能 ---
const isNpcTainted = (data) => { if (!data) return true; const markers = ["生成中", "不詳"]; return markers.some(m => (data.appearance || '').includes(m) || (data.background || '').includes(m) || (Array.isArray(data.personality) && data.personality.some(p => (p || '').includes(m)))); };
const rebuildBlackHouseholds = (playerSubCollection, rootCollection, createTemplateFunc, isTaintedFunc = () => false) => async (req, res) => {
    res.status(202).json({ message: `任務已接收！${rootCollection} 的全局模板回填任務正在後台執行中。請查看Render後台日誌以獲取詳細進度。` });
    (async () => {
        console.log(`[模板回填系統 v3.0] 開始執行 ${rootCollection} 的全局模板回填任務...`);
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
                        allPlayerSubDocs.push({ userId: userDoc.id, username: userDoc.data().username, playerData: userDoc.data(), docId: id });
                    }
                });
            }
            const householdsToRebuild = new Set();
            const mentionedIdsArray = Array.from(allMentionedIds);
            const rootDocs = new Map();
            for (let i = 0; i < mentionedIdsArray.length; i += 30) {
                const chunk = mentionedIdsArray.slice(i, i + 30);
                if (chunk.length > 0) {
                    const rootSnapshot = await db.collection(rootCollection).where(admin.firestore.FieldPath.documentId(), 'in', chunk).get();
                    rootSnapshot.forEach(doc => rootDocs.set(doc.id, doc.data()));
                }
            }
            for (const id of allMentionedIds) {
                const templateData = rootDocs.get(id);
                if (!templateData || isTaintedFunc(templateData)) {
                    householdsToRebuild.add(id);
                }
            }
            if (householdsToRebuild.size === 0) { console.log(`[模板回填系統 v3.0] 數據庫健康，未發現任何 ${rootCollection} 黑戶或汙染模板。`); return; }
            console.log(`[模板回填系統 v3.0] 發現 ${householdsToRebuild.size} 個黑戶或汙染 ${rootCollection} 模板，開始重建...`);
            let successCount = 0, failCount = 0;
            for (const id of householdsToRebuild) {
                try {
                    const contextInfo = allPlayerSubDocs.find(p => p.docId === id);
                    if (contextInfo) {
                        await createTemplateFunc(contextInfo);
                        successCount++;
                         console.log(`[模板回填系統 v3.0] 成功重建 ${rootCollection} 模板: ${id}`);
                    } else {
                        if (['items', 'skills'].includes(rootCollection)) {
                            await createTemplateFunc({ docId: id });
                            successCount++;
                            console.log(`[模板回填系統 v3.0] 成功重建 ${rootCollection} 模板 (無上下文): ${id}`);
                        } else {
                            failCount++;
                            console.warn(`[模板回填系統 v3.0] 找不到 ${id} 的玩家上下文，跳過重建。`);
                        }
                    }
                } catch (error) {
                    console.error(`[模板回填系統 v3.0] 重建 ${rootCollection} 模板 "${id}" 時失敗:`, error.message);
                    failCount++;
                }
            }
            console.log(`[模板回填系統 v3.0] 任務完成！共發現 ${householdsToRebuild.size} 個待辦模板。成功重建 ${successCount} 個，失敗 ${failCount} 個。`);
        } catch (error) {
            console.error(`[模板回填系統 v3.0] 執行 ${rootCollection} 全局回填任務時發生嚴重錯誤:`, error);
        }
    })().catch(err => console.error(`[模板回填系統 v3.0] 背景任務執行失敗:`, err));
};
const createNpcTemplate = async ({ userId, username, playerData, docId }) => { const allSavesSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get(); const firstMentionRound = allSavesSnapshot.docs.map(d=>d.data()).find(round => round.NPC?.some(npc => npc.name === docId)); if (firstMentionRound) { const generationResult = await generateNpcTemplateData(username, { name: docId }, firstMentionRound, playerData); if (generationResult && generationResult.templateData) { await db.collection('npcs').doc(generationResult.canonicalName).set(generationResult.templateData); } else { throw new Error('AI生成NPC失敗'); } } else { throw new Error('找不到NPC初見情境'); } };
const createItemTemplate = async ({ docId }) => { await getOrGenerateItemTemplate(docId, {}); };
const createSkillTemplate = async ({ docId }) => { await getOrGenerateSkillTemplate(docId); };
const createLocationTemplate = async ({ userId, docId }) => { const summaryDoc = await db.collection('users').doc(userId).collection('game_state').doc('summary').get(); const worldSummary = summaryDoc.exists ? summaryDoc.data().text : '江湖軼事無可考。'; await generateAndCacheLocation(userId, docId, '未知', worldSummary); };

router.post('/rebuild-npc-templates', rebuildBlackHouseholds('npc_states', 'npcs', createNpcTemplate, isNpcTainted));
router.post('/rebuild-item-templates', rebuildBlackHouseholds('inventory_items', 'items', createItemTemplate));
router.post('/rebuild-skill-templates', rebuildBlackHouseholds('skills', 'skills', createSkillTemplate));
router.post('/rebuild-location-templates', rebuildBlackHouseholds('location_states', 'locations', createLocationTemplate));

module.exports = router;
