// prompts/story_components/worldviewAndProgressionRule.js

/**
 * @param {object} promptData - An object containing data needed to construct the prompt.
 * @param {string} promptData.protagonistDescription - A description of the protagonist based on gender.
 * @param {number} promptData.currentRound - The current round number.
 * @returns {string} The rule text for Worldview and Progression rules.
 */
const getWorldviewAndProgressionRule = (promptData) => {
    const { protagonistDescription, currentRound } = promptData;

    return `
## 核心世界觀：
1.  **時代背景**: 這是一個類似宋朝的架空時代，名為「元祐」年間。天下並不太平，朝廷對地方的掌控力有限，各種思潮、勢力、機遇與危機並存。玩家可以選擇任何想走的路，例如成為行俠仗義的武者、富甲一方的商人、學富五車的文人、或是權傾朝野的官員。
2.  **主角設定**: 主角是一個從21世紀現代社會，靈魂穿越到這個時代的年輕人。${protagonistDescription} 主角醒來時手上握著一張紙條，寫著「任務：尋找回家的方法」。主角始終記得自己是穿越者，在探索這個世界的過程中，偶爾會遇到與「穿越」或「回家」相關的神秘線索。這些線索是自然融入故事的，不應被強迫出現。
3.  **開場地點**: 主角目前在一個名為「無名村」的偏遠小村落。這個村莊地處偏僻，民風淳樸，但似乎也隱藏著一些不為人知的秘密和來自周邊的威脅。

## 【核心規則】故事節奏與世界探索限制

你必須嚴格遵守此規則，以確保玩家的體驗是循序漸進的。此規則基於玩家當前的**遊戲回合數**。

**當前回合數：${currentRound || 0}**

### 第一階段：初來乍到 (回合 0 ~ 15)
-   **人物限制**：所有新出場的NPC都必須是符合新手村背景的**平凡人**，例如：村民、郎中、鐵匠、樵夫、小商販、地痞、不入流的山賊等。
-   **事件限制**：事件必須圍繞**村莊的日常生活**和**周邊的低級威脅**展開。**絕對禁止**出現任何關於絕世神功、朝廷核心機密、或足以顛覆世界的陰謀。
-   **地點限制**：玩家的活動範圍應在起始地附近。除非玩家明確表示要「前往某個大城市」，否則不要主動將故事引導至權力中心。

### 第二階段：初窺門徑 (回合 16 ~ 40)
-   **人物限制**：可以出現一些在**特定領域有專長**的人士，例如：武館教頭、地方幫派的小頭目、小門派的弟子、獨行俠、小有名氣的學者或商人。
-   **事件限制**：可以引入一些**區域性的事件**，例如：城鎮中的幫派火拼、護送商隊、參與詩會等。
-   **地點限制**：故事可以發生在周邊的縣城或市集，可以提及更廣闊的世界觀作為背景傳聞。

### 第三階段：嶄露頭角 (回合 > 40)
-   **解除限制**：你可以自由發揮，生成各種符合這個架空時代的宏大人物、事件和地點，包括一流高手、文壇領袖、商界巨擘和重大的歷史陰謀。
`;
};

module.exports = { getWorldviewAndProgressionRule };
