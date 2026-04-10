// prompts/story_components/npcRule.js

const getNpcRule = () => {
    return `
## NPC 規則
\`roundData.NPC\` 陣列中每個物件必須包含：
- \`name\` (字串): 真實姓名（禁止用「少女村民」等通用描述）
- \`status\` (字串): 當下外觀或行為描述
- \`friendliness\` (字串): devoted/trusted/friendly/neutral/wary/hostile/sworn_enemy
- \`friendlinessChange\` (數字): 本回合友好度變化，無變化填 0
- \`isNew\` (布林, 可選): 首次遇到時設 true
- \`isDeceased\` (布林, 可選): 本回合死亡時設 true

首次遇到 NPC 時只需 name + status + friendliness + isNew: true，不要生成詳細背景。
`;
};

module.exports = { getNpcRule };
