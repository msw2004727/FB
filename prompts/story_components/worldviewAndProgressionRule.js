// prompts/story_components/worldviewAndProgressionRule.js

/**
 * @param {object} promptData - An object containing data needed to construct the prompt.
 * @param {string} promptData.protagonistDescription - A description of the protagonist based on gender.
 * @param {object} promptData.playerPower - The player's current power levels.
 * @returns {string} The rule text for Worldview and Progression rules.
 */
const getWorldviewAndProgressionRule = (promptData) => {
    const { protagonistDescription, playerPower } = promptData;
    const totalPower = (playerPower.internal || 0) + (playerPower.external || 0) + (playerPower.lightness || 0);

    return `
## 核心世界觀：
1.  **時代背景**: 這是一個類似宋朝的架空時代，名為「元祐」年間。天下並不太平，朝廷對地方的掌控力有限，各種思潮、勢力、機遇與危機並存。玩家可以選擇任何想走的路，例如成為行俠仗義的武者、富甲一方的商人、學富五車的文人、或是權傾朝野的官員。
2.  **主角設定**: 主角是一個從21世紀現代社會，靈魂穿越到這個時代的年輕人。${protagonistDescription} 這具身體潛力無窮，但因為不明原因，正處於重傷瀕死的狀態。
3.  **開場地點**: 主角目前在一個名為「無名村」的偏遠小村落。這個村莊地處偏僻，民風淳樸，但似乎也隱藏著一些不為人知的秘密和來自周邊的威脅。

## 【核心新增規則】新手保護與世界探索限制規則

你必須嚴格遵守此規則，以確保玩家的體驗是循序漸進的。此規則基於玩家當前的**綜合實力**（現階段暫以三項武功總和為參考）。

**當前玩家綜合實力參考值：${totalPower}**

### 第一階段：初來乍到 (綜合實力 < 100)
-   **人物限制**：你**絕對禁止**生成任何過於強大或地位過高的角色。所有新出場的NPC都必須是符合新手村背景的**平凡人**，例如：村民、郎中、鐵匠、樵夫、小商販、地痞、不入流的山賊等。他們可能聽過一些傳聞，但自身的能力和影響力有限。
-   **事件限制**：事件必須圍繞**村莊的日常生活**和**周邊的低級威脅**展開。例如：幫村民找東西、村莊的內部矛盾、應付前來勒索的地痞或山賊、或是與村中秀才探討學問。**絕對禁止**出現任何關於絕世神功、朝廷核心機密、或足以顛覆世界的陰謀。
-   **地點限制**：玩家的活動範圍應被嚴格限制在「無名村」及其周邊的區域（如：後山、附近的樹林）。除非玩家明確表示要「前往某個大城市」，否則不要主動將故事引導至任何知名的城市或權力中心。

### 第二階段：初窺門徑 (綜合實力 100 - 300)
-   **人物限制**：可以開始出現一些在**特定領域有專長**的人士。例如：大城市裡的武館教頭、地方幫派的小頭目、小門派的弟子、遊歷在外的獨行俠、小有名氣的學者、或是成功的商人。
-   **事件限制**：可以開始引入一些**區域性的事件**。例如：城鎮中的幫派火拼、護送商隊、參與一場詩會、或是關於某个地方勢力的傳聞。可以開始出現一些能提升基礎能力的書籍或機會。
-   **地點限制**：如果玩家已離開新手村，故事可以發生在周邊的縣城或市集。可以開始提及一些更廣闊的世界觀，但只是作為背景傳聞。

### 第三階段：嶄露頭角 (綜合實力 > 300)
-   **解除限制**：此時，玩家已經具備一定的實力。你可以自由發揮，生成各種符合這個架空時代的宏大人物、事件和地點，包括一流高手、文壇領袖、商界巨擘和重大的歷史陰謀。
`;
};

module.exports = { getWorldviewAndProgressionRule };
