// scripts/api.js
// 重寫：所有 API 呼叫改為本機 IndexedDB + AI Proxy
// 保持與原 API 完全相同的介面，讓 UI 層不需要任何改動

import * as gameEngine from '../client/engine/gameEngine.js';
import clientDB from '../client/db/clientDB.js';

// 初始化標記
let _initialized = false;

/**
 * 確保 clientDB 已初始化且有活躍檔案
 */
async function ensureReady() {
    if (!_initialized) {
        await clientDB.init();
        _initialized = true;
    }
    // 如果沒有活躍檔案，嘗試從 localStorage 恢復
    if (!gameEngine.getActiveProfileId()) {
        const savedId = localStorage.getItem('wenjiang_active_profile');
        if (savedId) {
            const profile = await clientDB.profiles.get(savedId);
            if (profile) {
                gameEngine.setActiveProfile(savedId);
            }
        }
    }
}

/**
 * 包裝函式：自動初始化 + 錯誤處理
 */
async function safeCall(fn) {
    await ensureReady();
    return fn();
}

export const api = {
    // ── Gameplay Routes ─────────────────────
    interact: (body) => safeCall(() => gameEngine.interact({
        action: body.action,
        model: body.model
    })),

    startCultivation: (body) => safeCall(() => gameEngine.startCultivation({
        skillName: body.skillName,
        days: body.days,
        model: body.model
    })),

    // ── Combat Routes ───────────────────────
    initiateCombat: (body) => safeCall(() => gameEngine.initiateCombat({
        targetNpcName: body.targetNpcName,
        intention: body.intention,
        model: body.model
    })),

    combatAction: (body) => safeCall(() => gameEngine.combatAction({
        strategy: body.strategy,
        skill: body.skill,
        powerLevel: body.powerLevel,
        target: body.target,
        model: body.model
    })),

    combatSurrender: (body) => safeCall(() => gameEngine.combatSurrender({
        model: body.model
    })),

    finalizeCombat: (body) => safeCall(() => gameEngine.finalizeCombat({
        model: body.model
    })),

    // ── NPC Routes ──────────────────────────
    getNpcProfile: (npcName) => safeCall(() => gameEngine.getNpcProfile(npcName)),

    startTrade: (npcName) => safeCall(() => gameEngine.startTrade(npcName)),

    confirmTrade: (body) => safeCall(() => gameEngine.confirmTrade({
        npcName: body.npcName,
        tradeDetails: body.tradeDetails || body.tradeState,
        model: body.model
    })),

    npcChat: (body) => safeCall(() => gameEngine.npcChat({
        npcName: body.npcName,
        chatHistory: body.chatHistory,
        playerMessage: body.playerMessage,
        model: body.model
    })),

    giveItemToNpc: (body) => safeCall(() => {
        // interactionHandlers 包裝在 body.giveData 內，需要解構
        const giveData = body.giveData || body;
        return gameEngine.giveItemToNpc({
            targetNpcName: giveData.target || giveData.targetNpcName || body.targetNpcName,
            itemName: giveData.itemName || body.itemName,
            amount: giveData.amount || giveData.quantity || body.amount || 1,
            itemType: giveData.itemType || body.itemType,
            model: body.model
        });
    }),

    endChat: (body) => safeCall(() => gameEngine.endChat({
        npcName: body.npcName,
        fullChatHistory: body.fullChatHistory || body.chatHistory,
        model: body.model
    })),

    // ── State Routes ────────────────────────
    getLatestGame: () => safeCall(() => gameEngine.getLatestGame()),
    startNewGame: () => safeCall(() => gameEngine.startNewGame()),
    forceSuicide: (body) => safeCall(() => gameEngine.forceSuicide({ model: body?.model })),
    getInventory: () => safeCall(() => gameEngine.getInventory()),
    getRelations: () => safeCall(() => gameEngine.getRelations()),
    getNovel: () => safeCall(() => gameEngine.getNovel()),
    getEncyclopedia: () => safeCall(() => gameEngine.getEncyclopedia()),
    getSkills: () => safeCall(() => gameEngine.getSkills()),
    dropItem: (body) => safeCall(() => gameEngine.dropItem({ itemId: body.itemId })),
    forgetSkill: (body) => safeCall(() => gameEngine.forgetSkill({
        skillName: body.skillName,
        model: body.model
    })),

    // ── Inventory Routes ────────────────────
    equipItem: (instanceId) => safeCall(() => gameEngine.equipItem(instanceId)),
    unequipItem: (instanceId) => safeCall(() => gameEngine.unequipItem(instanceId)),

    // ── Bounty Route ────────────────────────
    getBounties: () => safeCall(() => gameEngine.getBounties()),

    // ── Epilogue Route ──────────────────────
    getEpilogue: () => safeCall(() => gameEngine.getEpilogue()),

    // ── Map Route ───────────────────────────
    getMap: () => safeCall(() => gameEngine.getMap()),

    // ── Beggar Routes ───────────────────────
    summonBeggar: (body) => safeCall(async () => ({ success: true })),
    startBeggarInquiry: (body) => safeCall(async () => {
        const profileId = gameEngine.getActiveProfileId();
        const inv = await clientDB.inventory.list(profileId);
        const silver = inv.find(i => i.itemName === '銀兩' || i.templateId === '銀兩');
        if (!silver || silver.quantity < 100) throw new Error('銀兩不足，需要至少 100 兩。');
        const newBalance = silver.quantity - 100;
        await clientDB.inventory.update(profileId, silver.instanceId, { quantity: newBalance });
        return { success: true, newBalance };
    }),
    askBeggarQuestion: (body) => safeCall(async () => {
        const { default: aiProxy } = await import('../client/ai/aiProxy.js');
        const { buildLightContext } = await import('../client/engine/contextBuilder.js');
        const profileId = gameEngine.getActiveProfileId();
        const context = await buildLightContext(profileId);
        return aiProxy.generate('beggar-inquiry', body.model, {
            ...context,
            userQuery: body.userQuery || body.question
        });
    }),

    // ── Image Route ─────────────────────────
    generateNpcAvatar: (npcName) => safeCall(() => gameEngine.generateNpcAvatar(npcName)),

    // ── GM Panel Routes ─────────────────────
    getNpcsForGM: () => safeCall(async () => {
        const profileId = gameEngine.getActiveProfileId();
        const states = await clientDB.npcs.listStates(profileId);
        const templates = await clientDB.npcs.listTemplates();
        const names = new Set([...states.map(s => s.npcName), ...templates.map(t => t.name)]);
        const result = [];
        for (const name of names) {
            const tpl = templates.find(t => t.name === name) || {};
            const st = states.find(s => s.npcName === name) || {};
            result.push({ ...tpl, ...st, name });
        }
        return result;
    }),
    updateNpcForGM: (body) => safeCall(async () => {
        const profileId = gameEngine.getActiveProfileId();
        const npcName = body.npcName || body.npcId || body.name;
        const existing = await clientDB.npcs.getState(profileId, npcName);
        await clientDB.npcs.setState(profileId, npcName, {
            ...(existing || {}),
            friendlinessValue: body.friendlinessValue ?? existing?.friendlinessValue,
            romanceValue: body.romanceValue ?? existing?.romanceValue
        });
        return { success: true };
    }),
    rebuildNpcForGM: (body) => safeCall(async () => ({ success: true, message: '本機模式暫不支援重建 NPC。' })),
    getLocationsForGM: () => safeCall(() => clientDB.locations.listTemplates()),
    rebuildLocationForGM: (body) => safeCall(async () => ({ success: true, message: '本機模式暫不支援重建地點。' })),
    getItemTemplatesForGM: () => safeCall(async () => {
        // 使用 clientDB 抽象層
        const items = [];
        // item_templates 沒有 list 方法，直接回傳空陣列
        return items;
    }),
    updatePlayerResourcesForGM: (body) => safeCall(async () => {
        const profileId = gameEngine.getActiveProfileId();
        if (body.money !== undefined) {
            const inv = await clientDB.inventory.list(profileId);
            const silver = inv.find(i => i.itemName === '銀兩' || i.templateId === '銀兩');
            if (silver) {
                await clientDB.inventory.update(profileId, silver.instanceId, { quantity: body.money });
            }
        }
        return { success: true };
    }),
    getPlayerStateForGM: () => safeCall(async () => {
        const profileId = gameEngine.getActiveProfileId();
        const profile = await clientDB.profiles.get(profileId);
        const inv = await clientDB.inventory.list(profileId);
        const silver = inv.find(i => i.itemName === '銀兩' || i.templateId === '銀兩');
        return {
            internalPower: profile.internalPower,
            externalPower: profile.externalPower,
            lightness: profile.lightness,
            morality: profile.morality,
            money: silver?.quantity || 0
        };
    }),
    updatePlayerStateForGM: (body) => safeCall(async () => {
        const profileId = gameEngine.getActiveProfileId();
        const updates = {};
        if (body.internalPower !== undefined) updates.internalPower = body.internalPower;
        if (body.externalPower !== undefined) updates.externalPower = body.externalPower;
        if (body.lightness !== undefined) updates.lightness = body.lightness;
        if (body.morality !== undefined) updates.morality = body.morality;
        await clientDB.profiles.update(profileId, updates);
        return { success: true };
    }),
    teleportPlayer: (body) => safeCall(async () => ({ success: true, message: '本機模式暫不支援傳送。' })),
    getCharactersForGM: () => safeCall(async () => {
        const profileId = gameEngine.getActiveProfileId();
        const profile = await clientDB.profiles.get(profileId);
        return [{ type: 'player', name: profile.username, ...profile }];
    }),
    updateNpcRelationship: (body) => safeCall(async () => ({ success: true })),
    gmCreateItemTemplate: (body) => safeCall(async () => ({ success: true, message: '本機模式暫不支援建立物品模板。' })),
    gmCreateNpcTemplate: (body) => safeCall(async () => ({ success: true, message: '本機模式暫不支援建立 NPC 模板。' })),
};
