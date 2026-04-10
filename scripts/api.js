// scripts/api.js
// 精簡版：僅保留使用中的 API 方法

import * as gameEngine from '../client/engine/gameEngine.js';
import clientDB from '../client/db/clientDB.js';

let _initialized = false;

async function ensureReady() {
    if (!_initialized) {
        await clientDB.init();
        _initialized = true;
    }
    if (!gameEngine.getActiveProfileId()) {
        const savedId = localStorage.getItem('wenjiang_active_profile');
        if (savedId) {
            const profile = await clientDB.profiles.get(savedId);
            if (profile) gameEngine.setActiveProfile(savedId);
        }
    }
}

async function safeCall(fn) {
    await ensureReady();
    return fn();
}

export const api = {
    // ── Gameplay ─────────────────────────────
    interact: (body) => safeCall(() => gameEngine.interact({
        action: body.action,
        model: body.model
    })),

    // ── State ────────────────────────────────
    getLatestGame: () => safeCall(() => gameEngine.getLatestGame()),
    startNewGame: () => safeCall(() => gameEngine.startNewGame()),
    forceSuicide: (body) => safeCall(() => gameEngine.forceSuicide({ model: body?.model })),

    // ── Epilogue ─────────────────────────────
    getEpilogue: () => safeCall(() => gameEngine.getEpilogue()),

    // ── GM Panel ─────────────────────────────
    getPlayerStateForGM: () => safeCall(async () => {
        const profileId = gameEngine.getActiveProfileId();
        const profile = await clientDB.profiles.get(profileId);
        return { morality: profile.morality };
    }),
    updatePlayerStateForGM: (body) => safeCall(async () => {
        const profileId = gameEngine.getActiveProfileId();
        const updates = {};
        if (body.morality !== undefined) updates.morality = body.morality;
        await clientDB.profiles.update(profileId, updates);
        return { success: true };
    }),
    getCharactersForGM: () => safeCall(async () => {
        const profileId = gameEngine.getActiveProfileId();
        const profile = await clientDB.profiles.get(profileId);
        return [{ type: 'player', name: profile.username, ...profile }];
    }),
    getNpcsForGM: () => safeCall(async () => []),
    getLocationsForGM: () => safeCall(() => clientDB.locations.listTemplates()),
    getItemTemplatesForGM: () => safeCall(async () => []),
};
