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

// --- 基礎API (餘額、日誌) ---
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

// --- 【核心修改】所有修復相關的API (關係鏈、黑戶等) 已被移除 ---

module.exports = router;
