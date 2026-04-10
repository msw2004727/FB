// /api/stateRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIEncyclopedia, getRelationGraph, getAIPrequel, getAISuggestion, getAIDeathCause, getAIForgetSkillStory } = require('../services/aiService');
const { getPlayerSkills, getRawInventory, calculateBulkScore } = require('./playerStateHelpers'); 
const { getMergedLocationData, invalidateNovelCache, updateLibraryNovel } = require('./worldStateHelpers');

const db = admin.firestore();

const RELATION_GRAPH_VERSION = 2;

const RELATION_TYPE_CONFIG = {
    family: { label: '親人', color: '#d97706', priority: 90 },
    romance: { label: '情感', color: '#db2777', priority: 85 },
    faction: { label: '門派', color: '#2563eb', priority: 75 },
    friend: { label: '朋友', color: '#16a34a', priority: 65 },
    enemy: { label: '敵對', color: '#dc2626', priority: 60 },
    acquaintance: { label: '熟識', color: '#0f766e', priority: 50 },
    unfamiliar: { label: '不熟', color: '#64748b', priority: 40 },
    other: { label: '其他', color: '#6d28d9', priority: 10 }
};

function toSafeString(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function normalizeName(value) {
    return toSafeString(value);
}

function hashString(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

function relationConfigKey(typeKey) {
    return RELATION_TYPE_CONFIG[typeKey] ? typeKey : 'other';
}

function classifyExplicitRelationType(rawLabel) {
    const label = toSafeString(rawLabel);
    if (!label) return 'other';

    const familyRegex = /(父|母|兄|弟|姐|姊|妹|子|女|兒|叔|伯|姑|姨|舅|祖|孫|親屬|家人|夫妻|夫君|娘子|娘親|爹|娘)/;
    const romanceRegex = /(戀人|情人|伴侶|心上人|愛慕|未婚)/;
    const factionRegex = /(門派|同門|師父|師傅|師徒|師兄|師弟|師姐|師妹|弟子|掌門|長老|宗主|宗門|幫主|幫眾|門主|堂主)/;
    const friendRegex = /(朋友|好友|知己|摯友|結拜|盟友|同伴|夥伴|伙伴|友人)/;
    const enemyRegex = /(仇|敵|宿敵|死對頭|冤家|追殺|通緝|仇人)/;
    const unfamiliarRegex = /(不熟|陌生|路人|萍水|點頭之交)/;

    if (familyRegex.test(label)) return 'family';
    if (romanceRegex.test(label)) return 'romance';
    if (factionRegex.test(label)) return 'faction';
    if (friendRegex.test(label)) return 'friend';
    if (enemyRegex.test(label)) return 'enemy';
    if (unfamiliarRegex.test(label)) return 'unfamiliar';
    return 'other';
}

function classifyPlayerRelationFromState(npcState = {}) {
    const romanceValue = Number(npcState.romanceValue) || 0;
    const friendlinessValue = Number(npcState.friendlinessValue) || 0;

    if (romanceValue >= 60) return 'romance';
    if (friendlinessValue >= 60) return 'friend';
    if (friendlinessValue <= -40) return 'enemy';
    if (Math.abs(friendlinessValue) <= 10) return 'unfamiliar';
    return 'acquaintance';
}

function normalizeRelationshipTargets(rawValue) {
    if (!rawValue) return [];

    if (typeof rawValue === 'string') {
        const name = normalizeName(rawValue);
        return name ? [{ name }] : [];
    }

    if (Array.isArray(rawValue)) {
        return rawValue.flatMap(item => normalizeRelationshipTargets(item));
    }

    if (typeof rawValue === 'object') {
        if (typeof rawValue.name === 'string' || typeof rawValue.targetName === 'string') {
            const name = normalizeName(rawValue.name || rawValue.targetName);
            if (!name) return [];
            return [{
                name,
                note: toSafeString(rawValue.note || rawValue.description || rawValue.remark)
            }];
        }
        return [];
    }

    return [];
}

function isPlayerAlias(name, username) {
    const n = normalizeName(name);
    if (!n) return false;
    if (n === normalizeName(username)) return true;
    return ['玩家', '主角', '你', '自己', '本人'].includes(n);
}

function makePlayerNode(username) {
    return {
        id: 'player',
        kind: 'player',
        name: username || '主角',
        label: username || '主角',
        statusTitle: '主角',
        allegiance: null,
        isDeceased: false,
        friendlinessValue: 0,
        romanceValue: 0,
        degree: 0
    };
}

function makeNpcNode(name, template = {}, state = {}) {
    const nodeName = normalizeName(template.name || state.name || name) || name;
    return {
        id: `npc:${nodeName}`,
        kind: 'npc',
        name: nodeName,
        label: nodeName,
        statusTitle: toSafeString(template.status_title || state.status_title) || '身份不明',
        allegiance: toSafeString(template.allegiance || state.allegiance) || null,
        currentLocation: Array.isArray(template.currentLocation)
            ? template.currentLocation.map(toSafeString).filter(Boolean)
            : (toSafeString(template.currentLocation) ? [toSafeString(template.currentLocation)] : []),
        isDeceased: Boolean(state.isDeceased || template.isDeceased),
        friendlinessValue: Number(state.friendlinessValue) || 0,
        romanceValue: Number(state.romanceValue) || 0,
        degree: 0
    };
}

function buildRelationTypeList(edges) {
    const usedTypes = new Set(edges.map(edge => relationConfigKey(edge.type)));
    return Object.entries(RELATION_TYPE_CONFIG)
        .filter(([key]) => usedTypes.has(key))
        .sort((a, b) => b[1].priority - a[1].priority)
        .map(([key, value]) => ({ key, label: value.label, color: value.color }));
}

function createRelationGraphPayload({ username, nodes, edges, meta = {} }) {
    const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id, 'zh-Hant'));
    const sortedEdges = [...edges].sort((a, b) => {
        const keyA = `${a.source}|${a.target}|${a.type}|${a.label || ''}`;
        const keyB = `${b.source}|${b.target}|${b.type}|${b.label || ''}`;
        return keyA.localeCompare(keyB, 'zh-Hant');
    });

    const relationTypes = buildRelationTypeList(sortedEdges);

    const digestSource = JSON.stringify({
        v: RELATION_GRAPH_VERSION,
        username: username || '',
        nodes: sortedNodes.map(n => ({
            id: n.id,
            name: n.name,
            statusTitle: n.statusTitle || '',
            allegiance: n.allegiance || '',
            isDeceased: !!n.isDeceased,
            friendlinessValue: Number(n.friendlinessValue) || 0,
            romanceValue: Number(n.romanceValue) || 0
        })),
        edges: sortedEdges.map(e => ({
            s: e.source,
            t: e.target,
            type: relationConfigKey(e.type),
            label: e.label || ''
        }))
    });

    const cacheKey = `rel-${RELATION_GRAPH_VERSION}-${hashString(digestSource)}`;
    const graph = {
        version: RELATION_GRAPH_VERSION,
        cacheKey,
        centerNodeId: 'player',
        generatedAt: new Date().toISOString(),
        relationTypes,
        nodes: sortedNodes,
        edges: sortedEdges,
        meta: {
            nodeCount: sortedNodes.length,
            edgeCount: sortedEdges.length,
            npcCount: sortedNodes.filter(node => node.kind === 'npc').length,
            ...meta
        }
    };

    return {
        graph,
        // Backward-compatible placeholder; relations page no longer relies on Mermaid.
        mermaidSyntax: null
    };
}

// ... (所有其他路由保持不變) ...

// ... (自廢武功、丟棄物品、獲取最新遊戲、庫存、技能、關係圖、百科等路由) ...
router.post('/forget-skill', async (req, res) => {
    const { skillName, skillType, model: playerModelChoice } = req.body;
    const { id: userId, username } = req.user;

    if (!skillName) {
        return res.status(400).json({ success: false, message: '未提供要廢除的武功名稱。' });
    }
    if (skillName === '現代搏擊') {
        return res.status(403).json({ success: false, message: '這是你穿越時帶來的唯一印記，無法被遺忘。' });
    }

    try {
        console.log(`[自廢武功] 玩家 ${username} (ID: ${userId}) 請求廢除武功: 「${skillName}」。`);

        const userRef = db.collection('users').doc(userId);
        const skillRef = userRef.collection('skills').doc(skillName);
        const skillDoc = await skillRef.get();

        if (!skillDoc.exists) {
            console.warn(`[自廢武功] 警告：玩家 ${username} 試圖廢除一個不存在的武學「${skillName}」。`);
            return res.status(404).json({ success: false, message: `你並未學會「${skillName}」。` });
        }
        
        const lastSaveSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const playerProfileSnapshot = await userRef.get();

        if (lastSaveSnapshot.empty || !playerProfileSnapshot.exists) {
            return res.status(404).json({ message: '找不到玩家存檔或資料。' });
        }
        
        let lastRoundData = lastSaveSnapshot.docs[0].data();
        let playerProfile = playerProfileSnapshot.data();

        const profileForPrompt = {
            ...playerProfile,
            username: username,
            currentLocation: lastRoundData.LOC,
            NPC: lastRoundData.NPC || [] 
        };

        const story = await getAIForgetSkillStory(playerModelChoice || playerProfile.preferredModel, profileForPrompt, skillName);

        const batch = db.batch();

        // 【核心修正】只刪除單一武學文件
        batch.delete(skillRef);
        console.log(`[自廢武功] 已將玩家 ${username} 的單一武學「${skillName}」加入刪除佇列。`);


        // 只有在 skillType 有效時才處理自創技能計數
        if (skillType && ['internal', 'external', 'lightness', 'none'].includes(skillType)) {
            const fieldToDecrement = `customSkillsCreated.${skillType}`;
            if (playerProfile.customSkillsCreated && typeof playerProfile.customSkillsCreated[skillType] === 'number' && playerProfile.customSkillsCreated[skillType] > 0) {
                batch.update(userRef, {
                    [fieldToDecrement]: admin.firestore.FieldValue.increment(-1)
                });
                console.log(`[自廢武功] 已將玩家 ${username} 的「${fieldToDecrement}」欄位計數減一。`);
            }
        }
        
        await batch.commit();
        console.log(`[自廢武功] 玩家 ${username} 的武學「${skillName}」已成功從資料庫中刪除。`);


        const newRoundNumber = lastRoundData.R + 1;
        
        const [fullInventory, updatedSkills, finalPlayerProfile] = await Promise.all([
            getRawInventory(userId),
            getPlayerSkills(userId),
            userRef.get().then(doc => doc.data()),
        ]);
        const bulkScore = calculateBulkScore(fullInventory);
        
        const newRoundData = {
            ...lastRoundData,
            R: newRoundNumber,
            story: story,
            PC: `你廢除了「${skillName}」，感覺體內一陣空虛，但也為新的可能性騰出了空間。`,
            EVT: `自廢武功「${skillName}」`,
            ...finalPlayerProfile,
            inventory: fullInventory,
            skills: updatedSkills,
            bulkScore: bulkScore,
        };
        
        const suggestion = await getAISuggestion(newRoundData, playerModelChoice);
        newRoundData.suggestion = suggestion;
        
        await db.collection('users').doc(userId).collection('game_saves').doc(`R${newRoundNumber}`).set(newRoundData);
        
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗(自廢武功):", err));
        
        res.json({
            success: true,
            message: `你已成功廢除「${skillName}」。`,
            story: newRoundData.story,
            roundData: newRoundData,
            suggestion: suggestion,
            locationData: await getMergedLocationData(userId, newRoundData.LOC)
        });

    } catch (error) {
        console.error(`[自廢武功API] 玩家 ${userId} 廢除武功 ${skillName} 時出錯:`, error);
        res.status(500).json({ success: false, message: '散功時發生未知錯誤，你的內力產生了混亂。' });
    }
});


// (其餘路由保持不變) ...

router.post('/drop-item', async (req, res) => {
    const { itemId } = req.body;
    const userId = req.user.id;

    if (!itemId) {
        return res.status(400).json({ success: false, message: '未提供要丟棄的物品ID。' });
    }

    try {
        const itemRef = db.collection('users').doc(userId).collection('inventory_items').doc(itemId);
        const itemDoc = await itemRef.get();

        if (!itemDoc.exists) {
            return res.status(404).json({ success: false, message: '在你的背包中找不到這個物品。' });
        }
        
        await itemRef.delete();
        
        const updatedInventory = await getRawInventory(userId);
        const newBulkScore = calculateBulkScore(updatedInventory);

        res.json({
            success: true,
            message: `已丟棄「${itemDoc.data().templateId || '物品'}」。`,
            inventory: updatedInventory,
            bulkScore: newBulkScore,
        });

    } catch (error) {
        console.error(`[丟棄物品API] 玩家 ${userId} 丟棄物品 ${itemId} 時出錯:`, error);
        res.status(500).json({ success: false, message: '丟棄物品時發生未知錯誤。' });
    }
});

router.get('/latest-game', async (req, res) => {
    const userId = req.user.id;
    try {
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        const userData = userDoc.data() || {};

        if (userData.isDeceased) {
            const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
            return res.json({ gameState: 'deceased', roundData: savesSnapshot.empty ? null : savesSnapshot.docs[0].data() });
        }
        
        const [snapshot, newBountiesSnapshot, fullInventory, skills] = await Promise.all([
            userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get(),
            userDocRef.collection('bounties').where('isRead', '==', false).limit(1).get(),
            getRawInventory(userId),
            getPlayerSkills(userId)
        ]);
        
        if (snapshot.empty) {
            return res.status(404).json({ message: '找不到存檔紀錄。' });
        }

        let latestGameData = snapshot.docs[0].data();
        
        const locationData = await getMergedLocationData(userId, latestGameData.LOC);
        const bulkScore = calculateBulkScore(fullInventory);

        const silverItem = fullInventory.find(item => item.templateId === '銀兩');
        const silverAmount = silverItem ? silverItem.quantity : 0;
        
        Object.assign(latestGameData, { 
            ...userData, 
            skills: skills,
            inventory: fullInventory,
            bulkScore: bulkScore,
            money: userData.money || 0,
            silver: silverAmount
        });

        // Initial page refresh should return immediately; skip AI prequel/suggestion generation here.
        const prequelText = null;
        const suggestion = typeof latestGameData.suggestion === 'string' ? latestGameData.suggestion : '';

        res.json({
            prequel: prequelText,
            story: latestGameData.story || "你靜靜地站在原地，思索著下一步。",
            roundData: latestGameData,
            suggestion: suggestion,
            locationData: locationData,
            hasNewBounties: !newBountiesSnapshot.empty
        });
    } catch (error) {
        console.error(`[讀取進度API] 替玩家 ${req.user.id} 讀取進度時出錯:`, error);
        res.status(500).json({ message: "讀取最新進度失敗。" });
    }
});


router.get('/inventory', async (req, res) => {
    try {
        const inventoryData = await getRawInventory(req.user.id);
        res.json(inventoryData);
    } catch (error) {
        res.status(500).json({ message: '讀取背包資料時發生內部錯誤。' });
    }
});

router.get('/skills', async (req, res) => {
    try {
        const skills = await getPlayerSkills(req.user.id);
        res.json(skills);
    } catch (error) {
        console.error(`[API /skills] 獲取玩家 ${req.user.id} 武學時出錯:`, error);
        res.status(500).json({ message: '獲取武學資料時發生內部錯誤。' });
    }
});

router.get('/get-relations', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const userRef = db.collection('users').doc(userId);
        const npcStatesRef = userRef.collection('npc_states');
        const latestSaveQuery = userRef.collection('game_saves').orderBy('R', 'desc').limit(1);

        const [npcsSnapshot, latestSaveSnapshot] = await Promise.all([
            npcStatesRef.get(),
            latestSaveQuery.get()
        ]);

        const latestRound = latestSaveSnapshot.empty ? null : (latestSaveSnapshot.docs[0].data()?.R ?? null);
        const currentSceneNpcNames = new Set(
            latestSaveSnapshot.empty
                ? []
                : ((latestSaveSnapshot.docs[0].data()?.NPC || [])
                    .map(npc => normalizeName(npc?.name))
                    .filter(Boolean))
        );

        const npcStateMap = new Map();
        for (const doc of npcsSnapshot.docs) {
            npcStateMap.set(doc.id, { ...(doc.data() || {}) });
        }

        const npcTemplateCache = new Map();
        const fetchNpcTemplate = async (npcName) => {
            const safeName = normalizeName(npcName);
            if (!safeName) return null;
            if (npcTemplateCache.has(safeName)) return npcTemplateCache.get(safeName);
            const templateDoc = await db.collection('npcs').doc(safeName).get();
            const template = templateDoc.exists ? (templateDoc.data() || {}) : null;
            npcTemplateCache.set(safeName, template);
            return template;
        };

        const knownNpcNames = new Set(npcStateMap.keys());
        await Promise.all([...knownNpcNames].map(fetchNpcTemplate));

        const relationshipReferencedNpcNames = new Set();
        for (const [npcName, npcState] of npcStateMap.entries()) {
            const template = npcTemplateCache.get(npcName) || null;
            const mergedRelationships = {
                ...(template?.relationships || {}),
                ...(npcState?.relationships || {})
            };
            for (const [, targetRaw] of Object.entries(mergedRelationships)) {
                const targets = normalizeRelationshipTargets(targetRaw);
                for (const target of targets) {
                    const targetName = normalizeName(target.name);
                    if (!targetName || isPlayerAlias(targetName, username)) continue;
                    relationshipReferencedNpcNames.add(targetName);
                }
            }
        }

        const extraNpcNames = [...relationshipReferencedNpcNames].filter(name => !knownNpcNames.has(name));
        if (extraNpcNames.length > 0) {
            await Promise.all(extraNpcNames.map(fetchNpcTemplate));
        }

        const allNpcNames = new Set([
            ...knownNpcNames,
            ...[...relationshipReferencedNpcNames].filter(name => npcTemplateCache.get(name))
        ]);

        const nodes = [];
        const nodeById = new Map();
        const npcNodeByName = new Map();
        const playerNode = makePlayerNode(username);
        nodes.push(playerNode);
        nodeById.set(playerNode.id, playerNode);

        for (const npcName of [...allNpcNames].sort((a, b) => a.localeCompare(b, 'zh-Hant'))) {
            const template = npcTemplateCache.get(npcName) || {};
            const npcState = npcStateMap.get(npcName) || {};
            const node = makeNpcNode(npcName, template, npcState);
            node.inCurrentScene = currentSceneNpcNames.has(node.name);
            nodes.push(node);
            nodeById.set(node.id, node);
            npcNodeByName.set(node.name, node);
        }

        const edges = [];
        const edgeDedup = new Set();
        const addEdge = ({ sourceId, targetId, type, label = '', directed = false, strength = null, sourceKind = 'derived' }) => {
            const safeType = relationConfigKey(type);
            if (!sourceId || !targetId || sourceId === targetId) return;

            const pair = directed ? [sourceId, targetId] : [sourceId, targetId].sort();
            const dedupKey = pair[0] + '|' + pair[1] + '|' + safeType + '|' + label + '|' + (directed ? 'd' : 'u');
            if (edgeDedup.has(dedupKey)) return;
            edgeDedup.add(dedupKey);

            const sourceNode = nodeById.get(sourceId);
            const targetNode = nodeById.get(targetId);
            if (!sourceNode || !targetNode) return;
            sourceNode.degree = (Number(sourceNode.degree) || 0) + 1;
            targetNode.degree = (Number(targetNode.degree) || 0) + 1;

            edges.push({
                id: 'edge:' + hashString(dedupKey),
                source: sourceId,
                target: targetId,
                type: safeType,
                label: toSafeString(label) || RELATION_TYPE_CONFIG[safeType]?.label || '??',
                directed: !!directed,
                strength: strength === null ? undefined : (Number(strength) || 0),
                sourceKind,
                color: RELATION_TYPE_CONFIG[safeType]?.color || RELATION_TYPE_CONFIG.other.color
            });
        };

        const playerExplicitRelationTypes = new Map();
        for (const node of nodes) {
            if (node.kind !== 'npc') continue;
            const npcName = node.name;
            const template = npcTemplateCache.get(npcName) || {};
            const state = npcStateMap.get(npcName) || {};
            const mergedRelationships = {
                ...(template.relationships || {}),
                ...(state.relationships || {})
            };

            for (const [relationLabel, targetRaw] of Object.entries(mergedRelationships)) {
                const relationType = classifyExplicitRelationType(relationLabel);
                const targets = normalizeRelationshipTargets(targetRaw);
                for (const target of targets) {
                    const targetName = normalizeName(target.name);
                    if (!targetName) continue;

                    if (isPlayerAlias(targetName, username)) {
                        if (!playerExplicitRelationTypes.has(node.id)) {
                            playerExplicitRelationTypes.set(node.id, new Set());
                        }
                        playerExplicitRelationTypes.get(node.id).add(relationType);
                        continue;
                    }

                    const targetNode = npcNodeByName.get(targetName);
                    if (!targetNode) continue;

                    addEdge({
                        sourceId: node.id,
                        targetId: targetNode.id,
                        type: relationType,
                        label: relationLabel,
                        directed: false,
                        sourceKind: 'explicit'
                    });
                }
            }
        }

        const playerPriority = ['family', 'romance', 'faction', 'friend', 'enemy', 'acquaintance', 'unfamiliar', 'other'];
        for (const node of nodes) {
            if (node.kind !== 'npc') continue;
            const npcState = npcStateMap.get(node.name) || {};
            let playerEdgeType = classifyPlayerRelationFromState(npcState);

            const explicitTypes = playerExplicitRelationTypes.get(node.id);
            if (explicitTypes && explicitTypes.size > 0) {
                for (const candidate of playerPriority) {
                    if (explicitTypes.has(candidate)) {
                        playerEdgeType = candidate;
                        break;
                    }
                }
            }

            const strength = Math.max(
                Math.abs(Number(npcState.friendlinessValue) || 0),
                Math.abs(Number(npcState.romanceValue) || 0)
            );

            addEdge({
                sourceId: 'player',
                targetId: node.id,
                type: playerEdgeType,
                label: RELATION_TYPE_CONFIG[playerEdgeType]?.label || '??',
                directed: false,
                strength,
                sourceKind: 'player'
            });
        }

        const payload = createRelationGraphPayload({
            username,
            nodes,
            edges,
            meta: {
                latestRound,
                sceneNpcCount: currentSceneNpcNames.size,
                cacheSourceNpcStateCount: npcsSnapshot.size,
                referencedNpcCount: relationshipReferencedNpcNames.size
            }
        });

        res.json(payload);
    } catch (error) {
        console.error('[???API] ?? ' + username + ' ?????????:', error);
        res.status(500).json({ message: '????????????????' });
    }
});

router.get('/get-encyclopedia', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const summaryDocRef = db.collection('users').doc(userId).collection('game_state').doc('summary');
        const npcsSnapshot = await db.collection('users').doc(userId).collection('npc_states').get();
        const summaryDoc = await summaryDocRef.get();

        if (!summaryDoc.exists || !summaryDoc.data().text) {
            return res.json({ encyclopediaHtml: '<p class="loading">你的江湖經歷尚淺，還沒有可供編撰的百科內容。</p>' });
        }

        const longTermSummary = summaryDoc.data().text;
        const npcDetails = {};
        npcsSnapshot.forEach(doc => {
            const data = doc.data();
            npcDetails[doc.id] = { romanceValue: data.romanceValue || 0 };
        });

        let encyclopediaHtml = await getAIEncyclopedia(longTermSummary, username, npcDetails);
        res.json({ encyclopediaHtml });
    } catch (error) {
        console.error(`[百科API] 替玩家 ${username} 生成百科時出錯:`, error);
        res.status(500).json({ message: "編撰百科時發生未知錯誤。" });
    }
});

/**
 * 【核心優化】獲取個人小說的路由
 * 此路由現在將從 library_novels 集合讀取分章節數據，而不是掃描全部的 game_saves。
 * 這將極大地提升讀取速度並降低資料庫讀取成本。
 */
router.get('/get-novel', async (req, res) => {
    const userId = req.user.id;
    try {
        const novelDocRef = db.collection('library_novels').doc(userId);
        const chaptersSnapshot = await novelDocRef.collection('chapters').orderBy('round', 'asc').get();

        if (chaptersSnapshot.empty) {
            // 如果在圖書館找不到，作為備用方案，可以嘗試從 game_saves 讀取一次（僅限此處）。
            // 這確保了即使圖書館更新失敗，玩家依然能看到自己的故事。
            const savesSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'asc').get();
            if (savesSnapshot.empty) {
                return res.json({ novelHTML: "" });
            }
            const storyChapters = savesSnapshot.docs.map(doc => {
                const data = doc.data();
                return `<div class="chapter"><h2>${data.EVT || `第 ${data.R} 回`}</h2><p>${(data.story || "").replace(/\n/g, '<br>')}</p></div>`;
            });
            return res.json({ novelHTML: storyChapters.join('') });
        }

        const storyChapters = chaptersSnapshot.docs.map(doc => {
            const chapter = doc.data();
            const title = chapter.title || `第 ${chapter.round} 回`;
            const content = chapter.content || "這段往事，已淹沒在時間的長河中。";
            return `<div class="chapter"><h2>${title}</h2><p>${content.replace(/\n/g, '<br>')}</p></div>`;
        });
        
        const fullStoryHTML = storyChapters.join('');
        res.json({ novelHTML: fullStoryHTML });

    } catch (error) {
        console.error(`[小說API v2.0] 替玩家 ${req.user.id} 生成小說時出錯:`, error);
        res.status(500).json({ message: "生成個人小說時發生未知錯誤。" });
    }
});


router.post('/restart', async (req, res) => {
    const userId = req.user.id;
    try {
        const userDocRef = db.collection('users').doc(userId);
        await updateLibraryNovel(userId, req.user.username);
        
        const collections = ['game_saves', 'npc_states', 'game_state', 'skills', 'location_states', 'bounties', 'inventory_items'];
        for (const col of collections) {
            try {
                const snapshot = await userDocRef.collection(col).get();
                if(!snapshot.empty){
                    const batch = db.batch();
                    snapshot.docs.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                }
            } catch (e) {
                console.warn(`清除集合 ${col} 失敗，可能該集合尚不存在。`, e.message);
            }
        }
        
        await userDocRef.set({
            internalPower: 5, externalPower: 5, lightness: 5, morality: 0,
            bulkScore: 0 
        }, { merge: true });

        await invalidateNovelCache(userId);
        res.status(200).json({ message: '新的輪迴已開啟。' });
    } catch (error) {
        console.error(`[重啟API] 替玩家 ${req.user.id} 開啟新輪迴時出錯:`, error);
        res.status(500).json({ message: '開啟新的輪迴時發生錯誤。' });
    }
});

router.post('/force-suicide', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const userDocRef = db.collection('users').doc(userId);
        const playerModelChoice = req.body.model;

        const lastSaveSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        if (lastSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到最後的存檔，無法決定死因。' });
        }
        const lastRoundData = lastSaveSnapshot.docs[0].data();

        const deathCause = await getAIDeathCause(playerModelChoice, username, lastRoundData);

        await userDocRef.update({ isDeceased: true });

        const finalRoundData = {
            ...lastRoundData,
            R: lastRoundData.R + 1,
            playerState: 'dead',
            story: deathCause,
            PC: deathCause,
            EVT: '天命已至',
            causeOfDeath: deathCause,
        };
        await userDocRef.collection('game_saves').doc(`R${finalRoundData.R}`).set(finalRoundData);

        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, username).catch(err => console.error("背景更新圖書館失敗(自殺):", err));

        res.json({
            story: finalRoundData.story,
            roundData: finalRoundData,
            suggestion: '你的江湖路已到盡頭...'
        });
    } catch (error) {
        console.error(`[了卻此生系統] 為玩家 ${username} 處理時發生錯誤:`, error);
        res.status(500).json({ message: '了此殘生時發生未知錯誤...' });
    }
});


module.exports = router;
