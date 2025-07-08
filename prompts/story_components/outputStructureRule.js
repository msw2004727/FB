// prompts/story_components/outputStructureRule.js

/**
 * @param {object} promptData - An object containing data needed to construct the prompt.
 * @param {string} promptData.username - The player's name.
 * @param {Array<string>} promptData.timeSequence - The sequence of time of day.
 * @returns {string} The rule text for the final JSON output structure.
 */
const getOutputStructureRule = (promptData) => {
    const { username, timeSequence } = promptData;

    return `
## 你必須嚴格遵守以下的規則：
1.  【重要】玩家的姓名是「${username}」。在你的所有 "story" 敘述中，請務必使用這個名字來稱呼玩家，絕對禁止使用「主角」這個詞。
2.  **【語言鐵律】你的所有 "story" 回應，必須只包含「繁體中文」角色。絕對禁止使用任何簡體中文、英文、或任何形式的表情符號 (emoji)。**
3.  你的所有回應都必須是一個完整的JSON物件，不要在前後添加任何額外的文字或 "\\\`\\\`\\\`json" 標記。
4.  JSON物件必須包含 "story" 和 "roundData" 兩個頂層鍵。
5.  "story" 鍵的值是一個字串，用來生動地描述故事發展，且字數控制在500字以內。
6.  "roundData" key 的值是一個物件，必須包含以下所有欄位：
    - R: (數字) 新的回合編號
    - playerState: (字串) 玩家的存活狀態。只能是 'alive' (存活) 或 'dead' (死亡)。
    - timeOfDay: (字串) 行動結束後的最終時辰，必須是 ${JSON.stringify(timeSequence)} 之一。
    - daysToAdvance: (可選的數字) 如果行動跨越多日，則提供此欄位。
    - powerChange: (物件) 武功數值的變化，格式為 {"internal": X, "external": Y, "lightness": Z}。
    - moralityChange: (數字) 正邪值的變化，可以是正數、負數或零。
    - itemChanges: (陣列) 根據最新的「物品帳本系統」規則生成。
    - romanceChanges: (陣列) 根據最新的「戀愛與心動值系統」規則生成。
    - skillChanges: (陣列) 【核心新增】根據最新的「武學系統」規則生成。
    - ATM: (陣列) [氛圍, 感官細節]
    - EVT: (字串) 事件摘要
      - 此摘要應如武俠小說的「章回標題」，需簡潔、有意境，通常為四到八個字。
      - **【風格鐵律】絕對禁止用玩家姓名「${username}」作為標題的開頭。**
      - **【佳例】**：「初探無名村」、「偶遇黑衣人」、「瀑下習劍」、「丹房竊藥」、「揭榜領懸賞」。
      - **【劣例】**：「${username}在瀑布下練習劍法」、「${username}走進了村莊」。
    - LOC: (陣列) [地點名稱, {地點狀態}]
    - PSY: (字串) 角色內心獨白或感受
    - PC: (字串) 玩家狀態變化
    - NPC: (陣列) 請嚴格遵守上面最新的NPC資料結構規則。
    - QST: (字串) 任務變化
        - 如果玩家正在執行某個懸賞任務，請在此處簡要註明，例如：「懸賞任務：清剿黑風寨」。
    - WRD: (字串) 天氣狀況 (例如：晴空萬里、陰雨綿綿、狂風大作)。
    - LOR: (字串) 獲得的背景知識
    - CLS: (字串) 關鍵線索
    - IMP: (字串) 行動造成的直接影響
    - enterCombat: (可選的布林)
    - combatants: (可選的物件陣列)
    - combatIntro: (可選的字串，僅在 enterCombat 為 true 時提供)
    - claimBounty: (可選的物件)
    - mentionedLocations: (可選的陣列) // 【核心新增】
    - locationUpdates: (可選的陣列) // 【核心新增】
7. 【死亡判定規則】如果故事的發展對玩家造成了不可逆轉的致命後果（例如：被利刃刺穿心臟、服下劇毒且無解藥、墜入萬丈深淵），你必須在 "story" 中描述其死亡的结局，並將 "playerState" 欄位的值設為 "dead"。與此同時，你還必須在 \`roundData\` 物件中，額外加入一個名為 \`causeOfDeath\` 的字串欄位，用來簡短描述導致玩家死亡的直接原因（例如：「被黑衣人一劍穿心」、「服下毒酒，毒發身亡」）。
8. **絕對邏輯性**: 所有事件和物品的出現都必須有合理的因果關係。友好度的變化必須基於玩家的行動和故事的發展。
9. **NPC的靈魂**: 你創造的每位NPC，都必須有基本的個性、動機和背景故事。你在描述NPC的反應時，必須嚴格參考其 "personality" 標籤。例如，一個'正直'的NPC絕不會接受賄賂；一個'膽小'的NPC在面對危險時可能會逃跑。
10. **寫實的成長**: 主角雖然是奇才，但成長需要過程。
`;
};

module.exports = { getOutputStructureRule };
