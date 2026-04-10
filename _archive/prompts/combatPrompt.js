const getCombatPrompt = (playerProfile, combatState, playerAction) => {
    const { strategy, skill: selectedSkillName, powerLevel, target } = playerAction || {};

    const skills = Array.isArray(playerProfile?.skills) ? playerProfile.skills : [];
    const allies = Array.isArray(combatState?.allies) ? combatState.allies : [];
    const enemies = Array.isArray(combatState?.enemies) ? combatState.enemies : [];

    const skillsString = skills.length > 0
        ? skills.map(s => `${s.skillName} (等級:${s.level || 1}, cost:${s.cost || 5}, 類別:${s.combatCategory || '未知'})`).join('、')
        : '無';
    const alliesString = allies.length > 0
        ? allies.map(a => `${a.name} (HP:${a.hp}/${a.maxHp}, MP:${a.mp ?? 0}/${a.maxMp ?? 0})`).join('、')
        : '無';
    const enemiesString = enemies.length > 0
        ? enemies.map(e => `${e.name} (HP:${e.hp}/${e.maxHp}, MP:${e.mp ?? 0}/${e.maxMp ?? 0})`).join('、')
        : '無';

    return `你是回合制武俠戰鬥引擎。請根據目前戰況，推進「一個回合」的戰鬥，並只輸出 JSON。\n\n` +
`[核心規則]\n` +
`1. 你必須尊重玩家指定策略(strategy)、招式(skill)、成數(powerLevel)、目標(target)。\n` +
`2. 若玩家使用武學(skill 非空)，MP 消耗必須 = 該武學 cost * powerLevel。\n` +
`3. 傷害/治療/輔助效果需與 powerLevel 成正比，powerLevel 越高效果越強、風險也可略增。\n` +
`4. target 是玩家本回合優先作用目標；敘事與 updatedState 應反映此目標受影響。\n` +
`5. HP/MP 不能低於 0；HP 不可高於 maxHp；MP 不可高於 maxMp。\n` +
`6. 若 updatedState.enemies / allies 有任何角色數值變動，該陣列元素必須包含 name（名稱要與當前戰況完全一致）。\n` +
`7. 若任一方全滅，status 回傳 COMBAT_END，否則 COMBAT_ONGOING。\n\n` +
`[輸出格式]\n` +
`請輸出 JSON，包含：\n` +
`- narrative: string（本回合戰鬥敘事，請描述目標互動與結果）\n` +
`- updatedState: object（只包含有變動的 player/enemies/allies 的 hp/mp 欄位；enemies/allies 每個項目需含 name）\n` +
`- status: "COMBAT_ONGOING" | "COMBAT_END"\n\n` +
`[範例片段]\n` +
`{"updatedState":{"player":{"hp":96,"mp":28},"enemies":[{"name":"山賊甲","hp":41}]}}\n\n` +
`[當前戰況]\n` +
`玩家: ${playerProfile?.username || '玩家'} (HP:${playerProfile?.hp}/${playerProfile?.maxHp}, MP:${playerProfile?.mp}/${playerProfile?.maxMp})\n` +
`同伴: ${alliesString}\n` +
`敵人: ${enemiesString}\n` +
`玩家武學: ${skillsString}\n\n` +
`[玩家本回合選擇]\n` +
`strategy=${strategy || 'attack'}\n` +
`skill=${selectedSkillName || '無'}\n` +
`powerLevel=${powerLevel || 1}\n` +
`target=${target || '未指定'}\n\n` +
`只輸出 JSON，不要加 markdown。`;
};

module.exports = { getCombatPrompt };
