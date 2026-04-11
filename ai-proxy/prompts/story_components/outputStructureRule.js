// prompts/story_components/outputStructureRule.js

/**
 * @param {object} promptData - An object containing data needed to construct the prompt.
 * @param {string} promptData.username - The player's name.
 * @param {Array<string>} promptData.timeSequence - The sequence of time of day.
 * @returns {string} The rule text for the final JSON output structure.
 */
const getOutputStructureRule = (promptData) => {
    const { username, timeSequence, scenario } = promptData;

    // 從劇本配置讀取範例（避免武俠內容汙染其他劇本）
    let npcAddress, evtExamples, locExample;
    if (scenario && scenario.npcAddressExamples) {
        npcAddress = scenario.npcAddressExamples;
        evtExamples = scenario.evtExamples;
        const LOC_EXAMPLES = {
            school: '["私立青嵐高中", "教學大樓", "二年三班教室"]',
            mecha: '["暮雲城", "零號格納庫", "駕駛艙"]',
            hero: '["英雄管理局", "第七分局", "D-7諮商室"]',
            animal: '["翠谷靈域", "東林", "醒魂坡"]',
            modern: '["台北", "信義區", "市政府站"]',
        };
        locExample = LOC_EXAMPLES[scenario.id] || '["無名村", "藥鋪"]';
    } else {
        npcAddress = '「少俠」「兄台」「姑娘」「這位公子」「閣下」';
        evtExamples = '如「初探無名村」「偶遇黑衣人」「酒館密談」「夜襲危機」';
        locExample = '["無名村", "藥鋪"]';
    }

    return `
## 你必須嚴格遵守以下的規則：
1.  【重要】玩家的姓名是「${username}」。在你的 "story" 敘述中（旁白部分），請使用這個名字來稱呼玩家，絕對禁止使用「主角」這個詞。但是，**NPC 不會自動知道玩家的名字**——除非玩家在故事中已經自我介紹過。在玩家尚未自報姓名之前，NPC 應使用合理的稱呼（如${npcAddress}等）。一旦玩家在對話中告知了姓名，該 NPC 之後才可以用名字稱呼玩家。
2.  **【語言鐵律 — 最高優先級】你的所有回應文字必須全程使用「繁體中文」。嚴格禁止：簡體中文、英文單字、日文。允許少量使用 emoji 表情符號來增強氣氛與情緒表達（如 😤💢😏🌙⚔️🔥💀🍃 等），但不可過度使用，每段文字最多 2-3 個，且必須自然融入文字中。**
3.  你的所有回應都必須是一個完整的JSON物件，不要在前後添加任何額外的文字或 "\\\`\\\`\\\`json" 標記。
4.  JSON物件必須包含 "story" 和 "roundData" 兩個頂層鍵。
5.  "story" 鍵的值是一個字串，用來生動地描述故事發展，字數必須在 450~500 字之間。要有充足的場景描寫、角色對話和氛圍營造。
6.  "roundData" key 的值是一個物件，必須包含以下所有欄位：
    - R: (數字) 新的回合編號
    - playerState: (字串) 玩家的存活狀態。只能是 'alive' (存活) 或 'dead' (死亡)。
    - timeOfDay: (字串) 行動結束後的最終時辰，必須是 ${JSON.stringify(timeSequence)} 之一。
    - daysToAdvance: (可選的數字) 如果行動跨越多日，則提供此欄位。
    - moralityChange: (數字) 正邪值的變化，可以是正數、負數或零。
    - EVT: (字串) 事件摘要
      - 需簡潔、有意境，通常為四到八個字。
      - **【風格鐵律】絕對禁止用玩家姓名「${username}」作為標題的開頭。**
      - **【佳例】**：${evtExamples}。
      - **【劣例】**：「${username}做了某件事」。
    - LOC: (陣列) 玩家當前的位置，採用層級結構。例如：${locExample}。
    - PC: (字串) 玩家狀態變化（30字以內的簡短描述）
    - NPC: (陣列) 請嚴格遵守上面最新的NPC資料結構規則。
    - WRD: (字串) 天氣狀況 (例如：晴空萬里、陰雨綿綿、狂風大作)。
    （注意：suggestion、actionOptions、actionMorality 由另一個 AI 並行生成，你不需要回傳這三個欄位。）
7. 【死亡判定規則】如果故事的發展對玩家造成了不可逆轉的致命後果（例如：被利刃刺穿心臟、服下劇毒且無解藥、墜入萬丈深淵），你必須在 "story" 中描述其死亡的结局，並將 "playerState" 欄位的值設為 "dead"。與此同時，你還必須在 \`roundData\` 物件中，額外加入一個名為 \`causeOfDeath\` 的字串欄位，用來簡短描述導致玩家死亡的直接原因（例如：「被黑衣人一劍穿心」、「服下毒酒，毒發身亡」）。
8. **絕對邏輯性**: 所有事件和物品的出現都必須有合理的因果關係。友好度的變化必須基於玩家的行動和故事的發展。
9. **NPC的靈魂**: 你創造的每位NPC，都必須有基本的個性、動機和背景故事。你在描述NPC的反應時，必須嚴格參考其 "personality" 標籤。例如，一個'正直'的NPC絕不會接受賄賂；一個'膽小'的NPC在面對危險時可能會逃跑。
10. **寫實的成長**: 主角雖然是奇才，但成長需要過程。
`;
};

module.exports = { getOutputStructureRule };
