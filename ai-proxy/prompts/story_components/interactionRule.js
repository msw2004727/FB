// prompts/story_components/interactionRule.js

const getInteractionRule = () => {
    return `
## 友好度系統
NPC 對玩家的態度分 7 級：devoted > trusted > friendly > neutral > wary > hostile > sworn_enemy。
友好度變化必須基於玩家行為，透過 friendlinessChange 數值回傳。

## 戰鬥觸發規則
當玩家明確要動手，或 NPC 展現攻擊意圖時：
1. 在 story 中描述到戰鬥**發生之前**即結束，禁止自行描寫戰鬥過程或結果
2. 回傳 \`"enterCombat": true\`
3. 回傳 \`"combatants"\`: 對手陣列 [{name, status}]
4. 回傳 \`"combatIntro"\`: 50-100 字戰鬥開場描述
5. 對手是毫無戰鬥力的平民 → 直接在故事中描述結果，不觸發戰鬥系統
`;
};

module.exports = { getInteractionRule };
