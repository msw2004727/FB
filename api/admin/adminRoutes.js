// api/admin/adminRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const adminAuth = require('./adminAuth');
const { getLogs, getPlayersWithLogs } = require('./logService');
const { getApiBalances } = require('./balanceService');

// --- 【核心修正】修正所有模組的相對路徑 ---
const { generateNpcTemplateData } = require('../../services/npcCreationService');
const { getOrGenerateItemTemplate, getOrGenerateSkillTemplate } = require('../playerStateHelpers');
const { generateAndCacheLocation } = require('../worldEngine');
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
        const logs = await getLogs(playerId || null, parseInt(limit));
        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});
router.get('/players', async (req, res) => {
    try {
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


// --- 【核心修改】將黑戶修復功能從自動改為手動，並加入存檔回寫邏輯 ---
const repairPlayerBlackHouseholds = (playerSubCollection, rootCollection, createTemplateFunc, isTaintedFunc = () => false) => async (req, res) => {
    const { playerId } = req.body;
    if (!playerId) {
        return res.status(400).json({ message: '必須提供玩家ID。' });
    }
    
    res.status(202).json({ message: `任務已接收！正在為玩家 ${playerId.substring(0,8)}... 在後台修復 ${rootCollection} 的黑戶與汙染模板。請查看Render後台日誌以獲取詳細進度。` });
    
    (async () => {
        console.log(`[模板修復系統 v4.0] 開始為玩家 ${playerId} 執行 ${rootCollection} 的修復任務...`);
        try {
            const userDocRef = db.collection('users').doc(playerId);
            const userDoc = await userDocRef.get();
            if (!userDoc.exists) {
                console.error(`[模板修復系統 v4.0] 錯誤：找不到玩家 ${playerId}。`);
                return;
            }
            const userData = userDoc.data();
            const username = userData.username;

            const allSavesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'asc').get();
            const allSavesDocs = allSavesSnapshot.docs;

            const mentionedIds = new Set();
            allSavesDocs.forEach(doc => {
                const roundData = doc.data();
                if (roundData.NPC && Array.isArray(roundData.NPC)) {
                    roundData.NPC.forEach(npc => { if (npc.name) mentionedIds.add(npc.name); });
                }
            });

            const householdsToRebuild = new Map(); // 使用Map來儲存黑戶名和初見回合
            for (const id of mentionedIds) {
                const templateDoc = await db.collection(rootCollection).doc(id).get();
                if (!templateDoc.exists || isTaintedFunc(templateDoc.data())) {
                    const firstMentionRound = allSavesDocs.map(d=>d.data()).find(round => round.NPC?.some(npc => npc.name === id));
                    if (firstMentionRound) {
                        householdsToRebuild.set(id, firstMentionRound);
                    }
                }
            }

            if (householdsToRebuild.size === 0) { console.log(`[模板修復系統 v4.0] 玩家 ${username} 的數據健康，未發現任何 ${rootCollection} 黑戶或汙染模板。`); return; }
            
            console.log(`[模板修復系統 v4.0] 發現 ${householdsToRebuild.size} 個黑戶或汙染 ${rootCollection} 模板，開始重建與回寫...`);
            
            let successCount = 0, failCount = 0;
            const batch = db.batch();

            for (const [genericName, firstMentionRound] of householdsToRebuild.entries()) {
                try {
                    const generationResult = await generateNpcTemplateData(username, { name: genericName }, firstMentionRound, userData);
                    if (generationResult && generationResult.canonicalName && generationResult.templateData) {
                        const { canonicalName, templateData } = generationResult;
                        
                        // 1. 創建新的、帶有唯一姓名的模板
                        await db.collection(rootCollection).doc(canonicalName).set(templateData, { merge: true });

                        // 2. 【關鍵】遍歷所有存檔，將舊的通用名替換為新的正式名
                        allSavesDocs.forEach(doc => {
                            const roundData = doc.data();
                            let updated = false;
                            if (roundData.NPC && Array.isArray(roundData.NPC)) {
                                roundData.NPC.forEach(npc => {
                                    if (npc.name === genericName) {
                                        npc.name = canonicalName;
                                        updated = true;
                                    }
                                });
                            }
                            if (updated) {
                                batch.update(doc.ref, { NPC: roundData.NPC });
                            }
                        });

                        successCount++;
                        console.log(`[模板修復系統 v4.0] 成功將「${genericName}」修復為「${canonicalName}」，並準備回寫存檔。`);
                    } else { throw new Error('AI生成NPC失敗'); }
                } catch (error) {
                    console.error(`[模板修復系統 v4.0] 重建模板 "${genericName}" 時失敗:`, error.message);
                    failCount++;
                }
            }
            
            await batch.commit();
            console.log(`[模板修復系統 v4.0] 任務完成！共發現 ${householdsToRebuild.size} 個待辦模板。成功重建 ${successCount} 個，失敗 ${failCount} 個。所有相關存檔已更新。`);

        } catch (error) {
            console.error(`[模板修復系統 v4.0] 執行 ${rootCollection} 修復任務時發生嚴重錯誤:`, error);
        }
    })().catch(err => console.error(`[模板修復系統 v4.0] 背景任務執行失敗:`, err));
};

// --- 【新】手動修復路由 ---
router.post('/rebuild-player-npcs', repairPlayerBlackHouseholds('npc_states', 'npcs', null, (data) => {
    if (!data) return true;
    const markers = ["生成中", "不詳"];
    return markers.some(m => (data.appearance || '').includes(m) || (data.background || '').includes(m));
}));


module.exports = router;
