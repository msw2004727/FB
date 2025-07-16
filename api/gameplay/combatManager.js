// api/gameplay/combatManager.js
const admin = require('firebase-admin');
const { getMergedNpcProfile } = require('../npcHelpers');
const { getAICombatSetup } = require('../../services/aiService');
const { getPlayerSkills, getRawInventory } = require('../playerStateHelpers');

const db = admin.firestore();

const getNpcTags = (skills = []) => {
    if (!skills || skills.length === 0) return [{ name: '凡人', type: 'support' }];
    const tags = new Set();
    const tagMap = {
        '攻擊': { type: 'attack', keywords: ['劍', '刀', '拳', '掌', '指', '鏢'] },
        '防禦': { type: 'defend', keywords: ['罩', '盾', '罡', '體'] },
        '治癒': { type: 'heal', keywords: ['療傷', '回春', '治癒'] },
        '輔助': { type: 'support', keywords: ['陣', '歌', '舞'] }
    };
    skills.forEach(skill => {
        if (skill && skill.name) {
            if (skill.skillType === '醫術') tags.add('治癒');
            if (skill.skillType === '毒術') tags.add('攻擊');
            for (const [tagName, { type, keywords }] of Object.entries(tagMap)) {
                if (keywords.some(kw => skill.name.includes(kw))) {
                    tags.add(tagName);
                }
            }
        }
    });
    if (tags.size === 0) tags.add('攻擊');
    const typeMapping = { '攻擊': 'attack', '防禦': 'defend', '治癒': 'heal', '輔助': 'support' };
    return Array.from(tags).map(tagName => ({ name: tagName, type: typeMapping[tagName] || 'attack' }));
};


/**
 * 處理戰鬥發起的核心邏輯
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 * @param {string} targetNpcName - 目標NPC名稱
 * @param {string} intention - 戰鬥意圖 (切磋/教訓/打死)
 * @returns {Promise<object>} 返回戰鬥的初始狀態物件
 */
async function initiateCombat(userId, username, targetNpcName, intention) {
    if (!targetNpcName) {
        throw new Error("未指定對決目標。");
    }

    const userDocRef = db.collection('users').doc(userId);
    const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
    if (savesSnapshot.empty) {
        throw new Error("找不到玩家存檔。");
    }
    const lastSave = savesSnapshot.docs[0].data();
    
    const playerLocationHierarchy = lastSave.LOC;
    const targetNpcProfile = await getMergedNpcProfile(userId, targetNpcName);
    
    if (!targetNpcProfile) {
        throw new Error(`找不到名為 ${targetNpcName} 的目標。`);
    }
    
    const npcLocation = targetNpcProfile.currentLocation;

    if (!Array.isArray(playerLocationHierarchy) || !playerLocationHierarchy.includes(npcLocation)) {
        throw new Error(`你必須和 ${targetNpcName} 在同一個地方才能對其動手。`);
    }

    const simulatedPlayerAction = `我決定要「${intention}」${targetNpcName}。`;
    
    const combatSetupResult = await getAICombatSetup(simulatedPlayerAction, lastSave);

    const [allPlayerSkills, playerInventory] = await Promise.all([
        getPlayerSkills(userId),
        getRawInventory(userId) 
    ]);

    const equippedWeapon = playerInventory.find(item => item.isEquipped && item.equipSlot && item.equipSlot.startsWith('weapon'));
    const currentWeaponType = equippedWeapon ? (equippedWeapon.weaponType || null) : null;
    
    console.log(`[戰鬥準備] 玩家裝備武器: ${equippedWeapon?.itemName || '無'} (類型: ${currentWeaponType})。`);

    const userProfile = (await userDocRef.get()).data();
    const maxHp = (userProfile.externalPower || 5) * 10 + 50;
    const maxMp = (userProfile.internalPower || 5) * 5 + 20;

    const allNpcNames = [
        ...combatSetupResult.combatants.map(c => c.name),
        ...combatSetupResult.allies.map(a => a.name)
    ];
    
    const npcDocs = await Promise.all(
        allNpcNames.map(name => db.collection('npcs').doc(name).get())
    );

    const npcProfiles = npcDocs.reduce((acc, doc) => {
        if (doc.exists) {
            acc[doc.id] = doc.data();
        }
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
            currentWeaponType: currentWeaponType,
            hp: maxHp, 
            maxHp, 
            mp: maxMp, 
            maxMp,
            tags: [{ name: '主角', type: 'attack' }]
        }, 
        enemies: combatSetupResult.combatants,
        allies: combatSetupResult.allies || [], 
        bystanders: combatSetupResult.bystanders || [], 
        log: [combatSetupResult.combatIntro || '戰鬥開始了！'],
        isSparring: intention === '切磋',
        intention: intention
    };

    await userDocRef.collection('game_state').doc('current_combat').set(combatState);
    
    console.log(`[戰鬥系統] 由玩家 ${username} 主動對 ${targetNpcName} 發起戰鬥，意圖為「${intention}」。`);
    
    return combatState;
}

module.exports = {
    initiateCombat,
};
