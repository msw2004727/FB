// scripts/api.js
import { backendBaseUrl } from './config.js';

async function fetchApi(endpoint, options = {}) {
    const token = localStorage.getItem('jwt_token');
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${backendBaseUrl}${endpoint}`, {
        ...options,
        headers,
    });
    
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || `伺服器錯誤: ${response.status}`);
    }
    return data;
}

export const api = {
    // Gameplay Routes
    interact: (body) => fetchApi('/api/game/play/interact', { method: 'POST', body: JSON.stringify(body) }),

    // Combat Routes
    initiateCombat: (body) => fetchApi('/api/game/combat/initiate', { method: 'POST', body: JSON.stringify(body) }),
    combatAction: (body) => fetchApi('/api/game/combat/action', { method: 'POST', body: JSON.stringify(body) }),
    combatSurrender: (body) => fetchApi('/api/game/combat/surrender', { method: 'POST', body: JSON.stringify(body) }),
    finalizeCombat: (body) => fetchApi('/api/game/combat/finalize-combat', { method: 'POST', body: JSON.stringify(body) }),

    // NPC Routes
    getNpcProfile: (npcName) => fetchApi(`/api/game/npc/profile/${npcName}`),
    startTrade: (npcName) => fetchApi(`/api/game/npc/start-trade/${npcName}`),
    confirmTrade: (body) => fetchApi('/api/game/npc/confirm-trade', { method: 'POST', body: JSON.stringify(body) }),
    npcChat: (body) => fetchApi('/api/game/npc/chat', { method: 'POST', body: JSON.stringify(body) }),
    giveItemToNpc: (body) => fetchApi('/api/game/npc/give-item', { method: 'POST', body: JSON.stringify(body) }),
    endChat: (body) => fetchApi('/api/game/npc/end-chat', { method: 'POST', body: JSON.stringify(body) }),

    // State Routes
    getLatestGame: () => fetchApi('/api/game/state/latest-game'),
    startNewGame: () => fetchApi('/api/game/state/restart', { method: 'POST' }),
    forceSuicide: (body) => fetchApi('/api/game/state/force-suicide', { method: 'POST', body: JSON.stringify(body) }),
    getInventory: () => fetchApi('/api/game/state/inventory'),
    getRelations: () => fetchApi('/api/game/state/get-relations'),
    getNovel: () => fetchApi('/api/game/state/get-novel'),
    getEncyclopedia: () => fetchApi('/api/game/state/get-encyclopedia'),
    getSkills: () => fetchApi('/api/game/state/skills'),
    equipItem: (body) => fetchApi('/api/game/state/equip', { method: 'POST', body: JSON.stringify(body) }),

    // Bounty Route
    getBounties: () => fetchApi('/api/bounties'),

    // Epilogue Route
    getEpilogue: () => fetchApi('/api/epilogue'),

    // Map Route
    getMap: () => fetchApi('/api/map/world-map'),
    
    // 【核心修改】Beggar (丐幫) Routes
    summonBeggar: (body) => fetchApi('/api/beggar/summon', { method: 'POST', body: JSON.stringify(body) }),
    startBeggarInquiry: (body) => fetchApi('/api/beggar/start-inquiry', { method: 'POST', body: JSON.stringify(body) }), // 新增：付費API
    askBeggarQuestion: (body) => fetchApi('/api/beggar/ask', { method: 'POST', body: JSON.stringify(body) }), // 修改：提問API

    // GM Panel Routes
    getNpcsForGM: () => fetchApi('/api/gm/npcs'),
    updateNpcForGM: (body) => fetchApi('/api/gm/update-npc', { method: 'POST', body: JSON.stringify(body) }),
    rebuildNpcForGM: (body) => fetchApi('/api/gm/rebuild-npc', { method: 'POST', body: JSON.stringify(body) }),
    getLocationsForGM: () => fetchApi('/api/gm/locations'),
    rebuildLocationForGM: (body) => fetchApi('/api/gm/rebuild-location', { method: 'POST', body: JSON.stringify(body) }),
    getItemTemplatesForGM: () => fetchApi('/api/gm/item-templates'),
    updatePlayerResourcesForGM: (body) => fetchApi('/api/gm/update-player-resources', { method: 'POST', body: JSON.stringify(body) }),
    getPlayerStateForGM: () => fetchApi('/api/gm/player-state'),
    updatePlayerStateForGM: (body) => fetchApi('/api/gm/player-state', { method: 'POST', body: JSON.stringify(body) }),
    teleportPlayer: (body) => fetchApi('/api/gm/teleport', { method: 'POST', body: JSON.stringify(body) }),
    getCharactersForGM: () => fetchApi('/api/gm/characters'),
    updateNpcRelationship: (body) => fetchApi('/api/gm/update-npc-relationship', { method: 'POST', body: JSON.stringify(body) }),
    gmCreateItemTemplate: (body) => fetchApi('/api/gm/create-item-template', { method: 'POST', body: JSON.stringify(body) }),
    gmCreateNpcTemplate: (body) => fetchApi('/api/gm/create-npc-template', { method: 'POST', body: JSON.stringify(body) }),
};
