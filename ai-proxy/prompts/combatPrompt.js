const getCombatPrompt = (playerProfile, combatState, playerAction) => {
    const { strategy, target } = playerAction || {};

    const allies = Array.isArray(combatState?.allies) ? combatState.allies : [];
    const enemies = Array.isArray(combatState?.enemies) ? combatState.enemies : [];

    const alliesString = allies.length > 0
        ? allies.map(a => `${a.name} (HP:${a.hp}/${a.maxHp})`).join('、')
        : '無';
    const enemiesString = enemies.length > 0
        ? enemies.map(e => `${e.name} (HP:${e.hp}/${e.maxHp})`).join('、')
        : '無';

    return `你是回合制戰鬥引擎。請根據目前戰況，推進「一個回合」的戰鬥，並只輸出 JSON。

[核心規則]
1. 根據玩家指定的策略(strategy)和目標(target)，描述一回合的戰鬥。
2. 根據雙方實力差距合理判定傷害。HP 不能低於 0 或高於 maxHp。
3. 若任一方全滅，status 回傳 COMBAT_END，否則 COMBAT_ONGOING。
4. 【語言鐵律】narrative 及所有文字欄位必須全程使用「繁體中文」，允許少量 emoji。

[輸出格式] 純 JSON：
- narrative: string（本回合戰鬥敘事，100字以內）
- updatedState: object（只包含有變動的 player/enemies/allies 的 hp 欄位；enemies/allies 每個項目需含 name）
- status: "COMBAT_ONGOING" | "COMBAT_END"

[當前戰況]
玩家: ${playerProfile?.username || '玩家'} (HP:${playerProfile?.hp || 100}/${playerProfile?.maxHp || 100})
同伴: ${alliesString}
敵人: ${enemiesString}

[玩家本回合選擇]
strategy=${strategy || 'attack'}
target=${target || '未指定'}

只輸出 JSON，不要加 markdown。`;
};

module.exports = { getCombatPrompt };
