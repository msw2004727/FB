// scripts/api.js
import { backendBaseUrl } from './config.js';

// 集中管理 API 的 fetch 呼叫
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
    combatAction: (body) => fetchApi('/api/game/play/combat-action', { method: 'POST', body: JSON.stringify(body) }),
    endChat: (body) => fetchApi('/api/game/play/end-chat', { method: 'POST', body: JSON.stringify(body) }),
    
    // NPC Routes
    getNpcProfile: (npcName) => fetchApi(`/api/game/npc/npc-profile/${npcName}`),
    npcChat: (body) => fetchApi('/api/game/npc/npc-chat', { method: 'POST', body: JSON.stringify(body) }),
    giveItemToNpc: (body) => fetchApi('/api/game/npc/give-item', { method: 'POST', body: JSON.stringify(body) }),

    // State Routes
    getLatestGame: () => fetchApi('/api/game/state/latest-game'),
    startNewGame: () => fetchApi('/api/game/state/restart', { method: 'POST' }),
    forceSuicide: (body) => fetchApi('/api/game/state/force-suicide', { method: 'POST', body: JSON.stringify(body) }),
    getInventory: () => fetchApi('/api/game/state/inventory'),
    getRelations: () => fetchApi('/api/game/state/get-relations'),
    getNovel: () => fetchApi('/api/game/state/get-novel'),
    getEncyclopedia: () => fetchApi('/api/game/state/get-encyclopedia'),
    getSkills: () => fetchApi('/api/game/state/skills'),

    // 【核心新增】Bounty Route
    getBounties: () => fetchApi('/api/bounties'),

    // Epilogue Route
    getEpilogue: () => fetchApi('/api/epilogue'),
};
