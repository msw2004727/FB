// prompts/story_components/romanceRule.js

const getRomanceRule = (promptData) => {
    const { playerGender } = promptData;

    return `
## 戀愛系統
玩家性別：${playerGender}。NPC 有獨立的「心動值」，基於個性和戀愛傾向判定變化。
- 已有戀人的 NPC 心動值極難提升
- 不符合 NPC 戀愛傾向（異性戀/同性戀/雙性戀/無性戀）時，心動值不能增加
- 感情發展應自然融入劇情，不要生硬
`;
};

module.exports = { getRomanceRule };
