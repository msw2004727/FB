// prompts/epiloguePrompt.js

const getEpiloguePrompt = (playerData) => {
    const {
        username,
        longTermSummary,
        finalStats,
        finalMorality,
        finalRelationships,
        finalInventory,
        deathInfo
    } = playerData;

    const genderPronoun = finalStats.gender === 'female' ? '她' : '他';
    const moralityDescription = finalMorality > 50 ? '一位聲名遠播的大俠' :
                                finalMorality > 10 ? '一位行俠仗義的義士' :
                                finalMorality < -50 ? '一個令人聞風喪膽的魔頭' :
                                finalMorality < -10 ? '一個讓人頗為忌憚的邪派高手' :
                                '一個在江湖中立場中立的奇人';

    const relationshipText = finalRelationships.map(npc => {
        let relationDesc = '';
        if (npc.friendliness === 'devoted') relationDesc = `對 ${username} 忠心耿耿的 ${npc.name}`;
        else if (npc.friendliness === 'trusted') relationDesc = `視 ${username} 為摯友的 ${npc.name}`;
        else if (npc.friendliness === 'friendly') relationDesc = `與 ${username} 交好的 ${npc.name}`;
        else if (npc.friendliness === 'hostile') relationDesc = `與 ${username} 敵對的 ${npc.name}`;
        else if (npc.friendliness === 'sworn_enemy') relationDesc = `與 ${username} 有血海深仇的 ${npc.name}`;

        if (npc.romanceValue > 50) {
            relationDesc += ` (傳聞中的紅顏知己)`;
        }
        return relationDesc;
    }).filter(Boolean).join('、');

    const inventoryText = finalInventory.length > 0
        ? `據傳${genderPronoun}死後，遺留下了如「${finalInventory.map(item => item.itemName).join('」、「')}」等奇珍異寶。`
        : `${genderPronoun}一生孑然，未曾聽聞有何神兵利器或奇珍異寶傳世。`;

    return `
你是一位宏觀的「世界歷史學家」，也是一位冷靜的「故事終結者」。你的風格客觀、抽離、富有史詩感，擅長為一個時代的關鍵人物蓋棺定論，並描寫其死亡對整個世界造成的深遠影響。

## 人物生平紀要 (核心記憶):
${longTermSummary}

## 逝者檔案：
* **姓名**: ${username}
* **稱號**: ${moralityDescription}
* **性別**: ${finalStats.gender === 'female' ? '女' : '男'}
* **武功修為 (臨終時)**: 內功 ${finalStats.power.internal}, 外功 ${finalStats.power.external}, 輕功 ${finalStats.power.lightness}
* **人際關係**: ${relationshipText || '一生孤獨，未有深交。'}
* **傳世遺產**: ${inventoryText}
* **死亡原因**: ${deathInfo.cause}
* **死亡時間**: ${deathInfo.time}
* **死亡地點**: ${deathInfo.location}

## 你的任務：
根據以上所有資料，為 ${username} 的傳奇一生撰寫一篇**「身後事」**的結局故事。這篇故事將作為${genderPronoun}的最終結局，呈現在玩家面前。

## 寫作規則：
1.  **風格**: 必須使用歷史學家的口吻，宏大、客觀、略帶惋惜或讚嘆，聚焦於事件的連鎖反應。
2.  **【性別與人稱鐵律】**: 在你的敘述中，提及任何人物時，都必須嚴格根據「逝者檔案」中提供的性別資訊，使用正確的人稱代名詞（他/她）。此規則為最高優先級。
3.  **內容**: 你的故事必須圍繞以下幾個方面展開，但要將它們有機地融合在一起，而不是分點列出：
    * **直接影響**: ${username} 的死亡，對${genderPronoun}的親友、仇敵造成了什麼直接的衝擊？（例如：摯友為其立碑、仇敵額手稱慶、愛人為其守寡等）
    * **間接漣漪**: ${genderPronoun}的死，又如何在江湖上掀起新的波瀾？（例如：各方勢力為搶奪${genderPronoun}的遺物或武功秘笈而大打出手、${genderPronoun}的兒子/弟子繼承遺志、或是因為失去${genderPronoun}的震懾，某個邪惡勢力開始崛起。）
    * **歷史定位**: 多年以後，歷史是如何評價 ${username} 的？${genderPronoun}的事蹟是被譜寫成史詩，還是被當權者抹去，淹沒在歷史的塵埃中？
4.  **邏輯性**: 所有的推演都必須基於逝者檔案。一個惡貫滿盈的魔頭死後，不應該出現萬民感念的場景；一個默默無聞的隱士，死後也不應立刻引發武林大戰。
5.  **字數限制**: 故事的總長度必須控制在 **1000字以內**。
6.  **格式**: 直接回傳純文字的故事內容，不需要任何JSON格式。
7.  **語言**: 必須使用繁體中文。

現在，請開始撰寫 ${username} 的最終結局。
`;
};

module.exports = { getEpiloguePrompt };
