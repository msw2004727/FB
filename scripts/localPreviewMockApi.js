import { getLocalPreviewIdentity } from './localPreviewMode.js';

const STORAGE_KEY = 'fb_local_preview_mock_state_v1';
const MAX_POWER = 999;
const TIME_SEQUENCE = ['上午', '午後', '黃昏', '深夜'];

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function deepClone(value) {
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

function readState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.version === 1 && parsed.roundData) return parsed;
        }
    } catch {
        // fall through to fresh state
    }
    const fresh = createInitialState();
    writeState(fresh);
    return fresh;
}

function writeState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createInitialState() {
    const skills = [
        { skillName: '基礎吐納', level: 2, exp: 35, skillType: '內功', power_type: 'internal', base_description: '調息養氣，穩定內息。', isCustom: false },
        { skillName: '散手拳路', level: 1, exp: 15, skillType: '外功', power_type: 'external', base_description: '樸實拳路，重在紮實。', isCustom: false },
        { skillName: '踏影步', level: 1, exp: 22, skillType: '身法', power_type: 'lightness', base_description: '步伐輕靈，便於脫身。', isCustom: false },
    ];

    const inventory = [
        {
            instanceId: 'item-silver',
            templateId: '碎銀',
            itemName: '碎銀',
            quantity: 42,
            itemType: '資源',
            category: '貨幣',
            bulk: '輕',
            baseDescription: '行走江湖的基本盤纏。',
            value: 42
        },
        {
            instanceId: 'item-bun',
            templateId: '白饅頭',
            itemName: '白饅頭',
            quantity: 3,
            itemType: '消耗品',
            category: '食物',
            bulk: '輕',
            baseDescription: '勉強充飢。',
            value: 2
        },
        {
            instanceId: 'item-water',
            templateId: '清水袋',
            itemName: '清水袋',
            quantity: 2,
            itemType: '消耗品',
            category: '飲品',
            bulk: '輕',
            baseDescription: '行路必備。',
            value: 2
        },
        {
            instanceId: 'item-sword',
            templateId: '鐵劍',
            itemName: '鐵劍',
            quantity: 1,
            itemType: '武器',
            category: '裝備',
            bulk: '中',
            equipSlot: 'weapon_right',
            isEquipped: true,
            baseDescription: '劍鋒略鈍，但尚堪一用。',
            stats: { attack: 3, defense: 0 },
            value: 18
        }
    ];

    const locationData = {
        name: '臨江鎮',
        description: '河道穿鎮而過，商旅雜沓，白日喧鬧，夜裡也不算太平。',
        terrain: '水路集鎮',
        governance: {
            ruler: '鎮守衙門',
            security: '尚可',
            allegiance: '本朝'
        },
        nearbyLocations: ['東碼頭', '茶棚', '舊戲臺']
    };

    const roundData = {
        R: 12,
        EVT: '暫歇茶棚',
        story: '你在臨江鎮的茶棚落座，聽見行腳商低聲談論碼頭夜裡的異動。',
        ATM: ['微雨將至', '空氣裡帶著潮氣與茶煙'],
        WRD: '陰',
        LOC: ['臨江鎮', '茶棚'],
        PC: '你稍作歇息，氣息平順，仍保持對四周動靜的警戒。',
        NPC: [
            { name: '店小二', status: '忙著添茶，眼神卻不時瞥向街口。', friendliness: 'friendly' },
            { name: '行腳商', status: '壓低聲音販賣消息，似乎知道些內情。', friendliness: 'neutral' }
        ],
        QST: '查清碼頭異動與流言來源。',
        PSY: '先觀察，再決定是否插手。',
        CLS: '茶棚裡人人都有話，但沒人把話說滿。',
        timeOfDay: '午後',
        internalPower: 14,
        externalPower: 11,
        lightness: 9,
        morality: 4,
        yearName: '元祐',
        year: 1,
        month: 3,
        day: 16,
        stamina: 88,
        playerState: 'alive',
        powerChange: { internal: 0, external: 0, lightness: 0 },
        moralityChange: 0,
        suggestion: '先向店小二探聽碼頭消息，再決定是否前往。'
    };

    return {
        version: 1,
        hasNewBounties: true,
        skills,
        inventory,
        locationData,
        roundData
    };
}

function calcBulkScore(inventory) {
    const scoreMap = { 輕: 2, 中: 5, 重: 10, 極重: 20 };
    return (inventory || []).reduce((sum, item) => sum + (scoreMap[item.bulk] || 0) * (Number(item.quantity) || 1), 0);
}

function updateSilverFields(roundData, inventory) {
    const silverItem = (inventory || []).find(item => item.templateId === '碎銀' || item.itemName === '碎銀');
    const silver = silverItem ? Number(silverItem.quantity) || 0 : 0;
    roundData.money = silver;
    roundData.silver = silver;
}

function syncRoundDataFromState(state) {
    state.roundData.skills = deepClone(state.skills);
    state.roundData.inventory = deepClone(state.inventory);
    state.roundData.bulkScore = calcBulkScore(state.inventory);
    updateSilverFields(state.roundData, state.inventory);
    state.roundData.suggestion = state.roundData.suggestion || '先觀察場面，再採取行動。';
}

function withResponseShape(state, extra = {}) {
    syncRoundDataFromState(state);
    return {
        story: state.roundData.story,
        prequel: null,
        roundData: deepClone(state.roundData),
        suggestion: state.roundData.suggestion || '',
        locationData: deepClone(state.locationData),
        inventory: deepClone(state.inventory),
        hasNewBounties: state.hasNewBounties,
        ...extra
    };
}

function nextTimeOfDay(current) {
    const currentIndex = TIME_SEQUENCE.indexOf(current);
    const nextIndex = (currentIndex + 1) % TIME_SEQUENCE.length;
    return {
        timeOfDay: TIME_SEQUENCE[nextIndex === -1 ? 0 : nextIndex],
        wrappedDay: currentIndex >= 0 && nextIndex === 0
    };
}

function parseRequestBody(options = {}) {
    if (!options.body) return {};
    if (typeof options.body === 'string') {
        try {
            return JSON.parse(options.body);
        } catch {
            return {};
        }
    }
    return options.body;
}

function buildStoryFromAction(action, state) {
    const lastLoc = state.roundData.LOC?.[state.roundData.LOC.length - 1] || '鎮口';
    return `你在${lastLoc}決定「${action}」。四周人群的目光略有變化，你感覺局勢正悄悄朝下一步推進。`;
}

function deriveEventTitle(action) {
    const text = String(action || '').trim();
    if (!text) return '江湖行動';
    return text.length > 12 ? `${text.slice(0, 12)}…` : text;
}

function applyActionToState(state, action) {
    const actionText = String(action || '').trim() || '四處觀察';
    const roundData = state.roundData;
    const next = deepClone(roundData);

    next.R = (Number(roundData.R) || 0) + 1;
    next.EVT = deriveEventTitle(actionText);
    next.story = buildStoryFromAction(actionText, state);
    next.playerState = 'alive';

    const lower = actionText.toLowerCase();
    const has = (...keys) => keys.some(k => actionText.includes(k) || lower.includes(k.toLowerCase()));

    let powerChange = { internal: 0, external: 0, lightness: 0 };
    let moralityChange = 0;
    let staminaDelta = -5;

    if (has('休息', '打坐', '睡', '調息')) {
        staminaDelta = 18;
        next.PC = '你調整呼吸與步伐，疲乏稍解，精神恢復了不少。';
        next.ATM = ['心神稍定', '雨氣被茶香壓住了些'];
    } else if (has('修練', '練功', '吐納', '內功')) {
        powerChange.internal = 1;
        staminaDelta = -10;
        next.PC = '你運轉內息，丹田微熱，內力略有精進。';
        next.ATM = ['氣機流轉', '呼吸間帶著熱意'];
    } else if (has('出拳', '外功', '刀', '劍', '搏鬥')) {
        powerChange.external = 1;
        staminaDelta = -9;
        next.PC = '你反覆校正發力節奏，筋骨發勁更穩。';
        next.ATM = ['勁風微起', '拳腳破空聲更分明'];
    } else if (has('輕功', '趕路', '探查', '追')) {
        powerChange.lightness = 1;
        staminaDelta = -8;
        next.PC = '你步法漸快，轉身借力更順，輕功稍有提升。';
        next.ATM = ['風聲掠耳', '腳步落地更輕'];
    }

    if (has('救', '幫', '護送', '行俠')) moralityChange += 2;
    if (has('搶', '偷', '勒索', '殺')) moralityChange -= 3;

    next.powerChange = powerChange;
    next.moralityChange = moralityChange;
    next.internalPower = clamp((Number(roundData.internalPower) || 0) + powerChange.internal, 0, MAX_POWER);
    next.externalPower = clamp((Number(roundData.externalPower) || 0) + powerChange.external, 0, MAX_POWER);
    next.lightness = clamp((Number(roundData.lightness) || 0) + powerChange.lightness, 0, MAX_POWER);
    next.morality = clamp((Number(roundData.morality) || 0) + moralityChange, -100, 100);
    next.stamina = clamp((Number(roundData.stamina) || 0) + staminaDelta, 0, 100);

    const { timeOfDay, wrappedDay } = nextTimeOfDay(roundData.timeOfDay);
    next.timeOfDay = timeOfDay;
    if (wrappedDay) {
        next.day = (Number(roundData.day) || 1) + 1;
    } else {
        next.day = Number(roundData.day) || 1;
    }

    next.yearName = roundData.yearName || '元祐';
    next.year = Number(roundData.year) || 1;
    next.month = Number(roundData.month) || 1;
    next.LOC = deepClone(roundData.LOC || ['臨江鎮']);
    next.WRD = next.stamina < 30 ? '悶熱' : (roundData.WRD || '陰');
    next.QST = roundData.QST || '查清碼頭異動與流言來源。';
    next.PSY = next.stamina < 25 ? '先恢復體力，別逞強。' : (roundData.PSY || '先觀察，再決定是否插手。');
    next.CLS = `你剛做了「${actionText}」，場面正在重新洗牌。`;
    next.NPC = (roundData.NPC || []).map(npc => ({ ...npc }));
    if (next.NPC[0]) {
        next.NPC[0].status = `聽見你提到「${actionText}」，神情明顯更注意你。`;
    }
    next.suggestion = next.stamina < 25
        ? '先找地方休息或補充飲食，再繼續行動。'
        : '可繼續追查碼頭異動，或向店小二深入打聽。';

    state.roundData = next;
}

function handleGetLatestGame() {
    const state = readState();
    const response = withResponseShape(state, {
        prequel: null
    });
    writeState(state);
    return response;
}

function handleInteract(options) {
    const body = parseRequestBody(options);
    const state = readState();
    applyActionToState(state, body.action);
    state.hasNewBounties = false;
    writeState(state);
    return withResponseShape(state);
}

function handleGetSkills() {
    const state = readState();
    return deepClone(state.skills);
}

function handleStartCultivation(options) {
    const body = parseRequestBody(options);
    const skillName = body.skillName || '吐納';
    const days = Math.max(1, Number(body.days) || 1);
    const state = readState();

    for (let i = 0; i < days; i++) {
        applyActionToState(state, `修練 ${skillName}`);
    }

    state.roundData.EVT = `閉關修練：${skillName}`;
    state.roundData.story = `你閉關修練 ${days} 日，反覆運氣行功，終於在收功時感到經脈更為順暢。`;
    state.roundData.PC = '你收功起身，氣息略顯疲憊，但功體有進境。';
    state.roundData.suggestion = '先確認身上資源與體力，再決定是否繼續修練。';

    writeState(state);
    return { success: true, ...withResponseShape(state) };
}

function handleForceSuicide() {
    const state = readState();
    state.roundData = {
        ...state.roundData,
        R: (Number(state.roundData.R) || 0) + 1,
        EVT: '英雄末路',
        story: '你在混亂與寂靜之間做出了終局的選擇，江湖傳奇在此刻落幕。',
        PC: '氣息斷絕，故事已然寫下句點。',
        playerState: 'dead',
        suggestion: '重新開始一段新的江湖人生。',
        powerChange: { internal: 0, external: 0, lightness: 0 },
        moralityChange: 0
    };
    writeState(state);
    return withResponseShape(state);
}

function handleDropItem(options) {
    const body = parseRequestBody(options);
    const itemId = body.itemId;
    if (!itemId) {
        return { success: false, message: '缺少 itemId。' };
    }

    const state = readState();
    const index = state.inventory.findIndex(item => item.instanceId === itemId);
    if (index === -1) {
        return { success: false, message: '找不到物品。' };
    }

    const item = state.inventory[index];
    if ((Number(item.quantity) || 0) > 1) {
        item.quantity = (Number(item.quantity) || 0) - 1;
    } else {
        state.inventory.splice(index, 1);
    }

    writeState(state);
    return {
        success: true,
        message: `已在本地預覽模式丟棄 ${item.itemName || '物品'}。`,
        inventory: deepClone(state.inventory),
        bulkScore: calcBulkScore(state.inventory)
    };
}

function handleEquipToggle(endpoint) {
    const shouldEquip = endpoint.includes('/equip/');
    const itemId = decodeURIComponent(endpoint.split('/').pop() || '');
    const state = readState();
    const item = state.inventory.find(entry => entry.instanceId === itemId);
    if (!item) {
        return { success: false, message: '找不到物品。' };
    }
    item.isEquipped = shouldEquip;
    writeState(state);
    return {
        success: true,
        message: shouldEquip ? '已裝備（本地預覽）' : '已卸下（本地預覽）',
        inventory: deepClone(state.inventory),
        bulkScore: calcBulkScore(state.inventory)
    };
}

function unsupported(endpoint) {
    throw new Error(`本地預覽 mock 尚未支援此 API：${endpoint}`);
}

function maybeDelay(result) {
    return new Promise(resolve => {
        window.setTimeout(() => resolve(result), 80);
    });
}

export async function handleLocalPreviewMockRequest(endpoint, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const path = String(endpoint || '');

    // Refresh/load path
    if (method === 'GET' && path === '/api/game/state/latest-game') {
        return maybeDelay(handleGetLatestGame());
    }

    // Main turn flow
    if (method === 'POST' && path === '/api/game/play/interact') {
        return maybeDelay(handleInteract(options));
    }

    // Homepage helpers
    if (method === 'GET' && path === '/api/game/state/skills') {
        return maybeDelay(handleGetSkills());
    }
    if (method === 'POST' && path === '/api/game/cultivation/start') {
        return maybeDelay(handleStartCultivation(options));
    }
    if (method === 'POST' && path === '/api/game/state/force-suicide') {
        return maybeDelay(handleForceSuicide());
    }
    if (method === 'POST' && path === '/api/game/state/drop-item') {
        return maybeDelay(handleDropItem(options));
    }
    if (method === 'POST' && (path.startsWith('/api/inventory/equip/') || path.startsWith('/api/inventory/unequip/'))) {
        return maybeDelay(handleEquipToggle(path));
    }

    // Non-critical fallbacks used by sidebar buttons/pages.
    if (method === 'GET' && path === '/api/bounties') {
        return maybeDelay([]);
    }

    const identity = getLocalPreviewIdentity();
    console.warn('[Local Preview Mock API] Unsupported endpoint requested.', { endpoint: path, method, identity });
    return maybeDelay(unsupported(path));
}

