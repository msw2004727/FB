const admin = require('firebase-admin');
const { getMergedNpcProfile } = require('../npcHelpers');
const { getAICombatSetup } = require('../../services/aiService');
const { getPlayerSkills, getRawInventory } = require('../playerStateHelpers');

const db = admin.firestore();

const VALID_COMBAT_INTENTIONS = new Set(['切磋', '教訓', '打死']);

function toSafeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeLocationHierarchy(location) {
    if (Array.isArray(location)) {
        return location.map(v => String(v || '').trim()).filter(Boolean);
    }
    if (typeof location === 'string') {
        const trimmed = location.trim();
        return trimmed ? [trimmed] : [];
    }
    return [];
}

function hasLocationOverlap(playerLocationHierarchy, npcLocation) {
    const player = normalizeLocationHierarchy(playerLocationHierarchy);
    const npc = normalizeLocationHierarchy(npcLocation);
    if (player.length === 0 || npc.length === 0) return false;

    if (player[player.length - 1] === npc[npc.length - 1]) return true;
    const playerSet = new Set(player);
    return npc.some(segment => playerSet.has(segment));
}

function inferNpcTagType(skill) {
    const combatCategory = String(skill?.combatCategory || '').trim();
    const skillType = String(skill?.skillType || '').trim();
    const skillName = String(skill?.name || skill?.skillName || '').trim();

    if (combatCategory) {
        if (combatCategory === '攻擊') return { name: '攻擊', type: 'attack' };
        if (combatCategory === '防禦') return { name: '防禦', type: 'defend' };
        if (combatCategory === '迴避') return { name: '迴避', type: 'evade' };
        if (combatCategory === '輔助') return { name: '輔助', type: 'support' };
        if (combatCategory === '治療') return { name: '治療', type: 'heal' };
    }

    if (skillType.includes('醫') || skillName.includes('療') || skillName.includes('醫')) {
        return { name: '治療', type: 'heal' };
    }
    if (skillName.includes('守') || skillName.includes('盾') || skillName.includes('防')) {
        return { name: '防禦', type: 'defend' };
    }
    if (skillName.includes('身法') || skillName.includes('步') || skillName.includes('閃')) {
        return { name: '迴避', type: 'evade' };
    }
    if (skillName.includes('陣') || skillName.includes('護') || skillName.includes('助')) {
        return { name: '輔助', type: 'support' };
    }

    return { name: '攻擊', type: 'attack' };
}

function getNpcTags(skills = []) {
    if (!Array.isArray(skills) || skills.length === 0) {
        return [{ name: '輔助', type: 'support' }];
    }

    const tags = new Map();
    for (const skill of skills) {
        const tag = inferNpcTagType(skill);
        if (!tags.has(tag.type)) tags.set(tag.type, tag);
    }

    if (tags.size === 0) {
        return [{ name: '攻擊', type: 'attack' }];
    }
    return Array.from(tags.values());
}

function normalizeCombatEntity(entity, fallbackName) {
    if (!entity || typeof entity !== 'object') return null;
    const name = String(entity.name || fallbackName || '').trim();
    if (!name) return null;

    const maxHp = Math.max(1, toSafeNumber(entity.maxHp, toSafeNumber(entity.hp, 100)));
    const hp = Math.min(maxHp, Math.max(0, toSafeNumber(entity.hp, maxHp)));
    const maxMp = Math.max(0, toSafeNumber(entity.maxMp, toSafeNumber(entity.mp, 0)));
    const mp = Math.min(maxMp, Math.max(0, toSafeNumber(entity.mp, maxMp)));

    return {
        ...entity,
        name,
        status: entity.status || '',
        hp,
        maxHp,
        mp,
        maxMp
    };
}

function normalizeCombatSetupResult(rawResult, targetNpcName) {
    const base = (rawResult && typeof rawResult === 'object') ? rawResult : {};
    const combatants = Array.isArray(base.combatants)
        ? base.combatants.map(entity => normalizeCombatEntity(entity)).filter(Boolean)
        : [];
    const allies = Array.isArray(base.allies)
        ? base.allies.map(entity => normalizeCombatEntity(entity)).filter(Boolean)
        : [];
    const bystanders = Array.isArray(base.bystanders) ? base.bystanders.filter(Boolean) : [];

    if (!combatants.some(c => c.name === targetNpcName)) {
        combatants.unshift(normalizeCombatEntity({ name: targetNpcName, hp: 100, maxHp: 100, mp: 0, maxMp: 0 }, targetNpcName));
    }

    return {
        combatants,
        allies,
        bystanders,
        combatIntro: typeof base.combatIntro === 'string' ? base.combatIntro : ''
    };
}

async function initiateCombat(userId, username, targetNpcName, intention) {
    console.log(`[戰鬥事件] 玩家 ${username} 對 ${targetNpcName} 發起戰鬥，意圖為「${intention}」。`);

    if (!targetNpcName) {
        throw new Error('缺少動手目標。');
    }
    if (!VALID_COMBAT_INTENTIONS.has(intention)) {
        throw new Error('無效的動手意圖。');
    }

    const userDocRef = db.collection('users').doc(userId);
    const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
    if (savesSnapshot.empty) {
        throw new Error('找不到最新回合資料。');
    }
    const lastSave = savesSnapshot.docs[0].data();

    const playerLocationHierarchy = normalizeLocationHierarchy(lastSave.LOC);
    const targetNpcProfile = await getMergedNpcProfile(userId, targetNpcName);

    if (!targetNpcProfile) {
        throw new Error(`找不到名為 ${targetNpcName} 的目標。`);
    }
    if (targetNpcProfile.isDeceased) {
        throw new Error(`${targetNpcName} 已死亡，無法再動手。`);
    }

    if (!hasLocationOverlap(playerLocationHierarchy, targetNpcProfile.currentLocation)) {
        throw new Error(`你必須和 ${targetNpcName} 在同一個地方才能對其動手。`);
    }

    const simulatedPlayerAction = `我決定要「${intention}」${targetNpcName}。`;
    const combatSetupResult = normalizeCombatSetupResult(
        await getAICombatSetup(simulatedPlayerAction, lastSave),
        targetNpcName
    );

    const [allPlayerSkills, playerInventory] = await Promise.all([
        getPlayerSkills(userId),
        getRawInventory(userId)
    ]);

    const equippedWeapon = playerInventory.find(item => item && item.isEquipped && item.equipSlot && String(item.equipSlot).startsWith('weapon'));
    const currentWeaponType = equippedWeapon ? (equippedWeapon.weaponType || null) : null;

    console.log(`[戰鬥初始化] 玩家武器: ${equippedWeapon?.itemName || '無'} (類型: ${currentWeaponType || '空手'})`);

    const userProfile = (await userDocRef.get()).data() || {};
    const maxHp = Math.max(1, (toSafeNumber(userProfile.externalPower, 5) * 10) + 50);
    const maxMp = Math.max(0, (toSafeNumber(userProfile.internalPower, 5) * 5) + 20);

    const allNpcNames = [...new Set([
        ...combatSetupResult.combatants.map(c => c.name),
        ...combatSetupResult.allies.map(a => a.name)
    ].filter(Boolean))];

    const npcDocs = await Promise.all(allNpcNames.map(name => db.collection('npcs').doc(name).get()));
    const npcProfiles = npcDocs.reduce((acc, doc) => {
        if (doc.exists) acc[doc.id] = doc.data();
        return acc;
    }, {});

    combatSetupResult.combatants.forEach(c => {
        const profile = npcProfiles[c.name];
        c.tags = profile ? getNpcTags(profile.skills) : [{ name: '攻擊', type: 'attack' }];
    });
    combatSetupResult.allies.forEach(a => {
        const profile = npcProfiles[a.name];
        a.tags = profile ? getNpcTags(profile.skills) : [{ name: '輔助', type: 'support' }];
    });

    const combatState = {
        turn: 1,
        player: {
            username,
            skills: allPlayerSkills,
            currentWeaponType,
            hp: maxHp,
            maxHp,
            mp: maxMp,
            maxMp,
            tags: [{ name: '攻擊', type: 'attack' }]
        },
        enemies: combatSetupResult.combatants,
        allies: combatSetupResult.allies || [],
        bystanders: combatSetupResult.bystanders || [],
        log: [combatSetupResult.combatIntro || '戰鬥開始，雙方對峙。'],
        isSparring: intention === '切磋',
        intention
    };

    await userDocRef.collection('game_state').doc('current_combat').set(combatState);
    return combatState;
}

module.exports = {
    initiateCombat,
};
