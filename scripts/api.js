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
    getLatestGame: () => fetchApi('/api/game/latest-game'),
    startNewGame: () => fetchApi('/api/game/restart', { method: 'POST' }),
    forceSuicide: () => fetchApi('/api/game/force-suicide', { method: 'POST' }),
    interact: (body) => fetchApi('/api/game/interact', { method: 'POST', body: JSON.stringify(body) }),
    combatAction: (body) => fetchApi('/api/game/combat-action', { method: 'POST', body: JSON.stringify(body) }),
    getNpcProfile: (npcName) => fetchApi(`/api/game/npc-profile/${npcName}`),
    npcChat: (body) => fetchApi('/api/game/npc-chat', { method: 'POST', body: JSON.stringify(body) }),
    endChat: (body) => fetchApi('/api/game/end-chat', { method: 'POST', body: JSON.stringify(body) }),
};
