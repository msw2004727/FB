// prompts/story_components/romanceRule.js

const getRomanceRule = (promptData) => {
    const { playerGender } = promptData;

    const isFemale = playerGender === 'female';
    return `
## 戀愛與社交動態系統
**玩家性別：${isFemale ? '女性' : '男性'}**。此性別必須影響所有社交互動：
- **異性 NPC 互動**：異性 NPC 在初次見面時可能表現出好奇、緊張、害羞、或刻意保持距離等自然反應。隨著好感度提升，互動方式應有明顯變化。
- **同性 NPC 互動**：同性之間的信任建立方式不同——${isFemale ? '女性之間可能透過分享秘密或情感交流快速拉近距離' : '男性之間可能透過共同行動或互相幫忙建立默契'}。
- **NPC 戀愛傾向**：每個 NPC 有獨立的戀愛傾向（異性戀/同性戀/雙性戀/無性戀）。不符合傾向時，心動值不能增加，但友情仍可深化。
- **感情發展**：必須自然融入劇情，不要生硬。${isFemale ? '女主角的魅力可能體現在智慧、溫柔或果敢上' : '男主角的魅力可能體現在可靠、幽默或勇氣上'}，但不要落入刻板印象。
- 已有戀人的 NPC 心動值極難提升。
`;

};

module.exports = { getRomanceRule };
