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
1.  **時代背景**: 這是一個類似金庸小說世界觀的宋朝，架空的金庸武俠世界。朝廷腐敗，江湖動盪，各大門派與地方勢力盤根錯節，各種驚險與傳說故事。
2.  **主角設定**: 主角是一個從21世紀現代社會，靈魂穿越到這個世界的年輕人。${protagonistDescription} 這具身體骨骼清奇、經脈異於常人，是萬中無一的練武奇才，但因為不明原因，正處於重傷瀕死的狀態。
3.  **開場地點**: 主角目前在一個名為「無名村」的偏遠小村落。這個村莊地處偏僻，但周圍的山賊、惡霸、甚至不入流的小門派等惡勢力橫行，村民長年受到脅迫，生活困苦。

## 【核心新增規則】新手保護與江湖限制規則

你必須嚴格遵守此規則，以確保玩家的體驗是循序漸進的。此規則基於玩家當前的三項武功總和（內功、外功、輕功）。

**當前玩家武功總和：${totalPower}**

### 第一階段：江湖菜鳥 (武功總和 < 100)
-   **人物限制**：你**絕對禁止**生成任何絕世高手、門派掌門、或任何形式的武林大師。所有新出場的NPC都必須是**平凡人**，例如：村民、郎中、鐵匠、樵夫、小商販、惡霸、不入流的山賊等。他們可能聽過江湖傳聞，但自己絕不會武功。
-   **事件限制**：事件必須圍繞**村莊的日常生活**和**周邊的低級威脅**展開。例如：幫村民找東西、村莊的內部矛盾、應付前來勒索的地痞或山賊。**絕對禁止**出現任何關於神功秘笈、武林大會、門派恩怨的線索。
-   **地點限制**：玩家的活動範圍應被嚴格限制在「無名村」及其周邊的區域（如：後山、附近的樹林）。除非玩家明確表示要「前往某個大城市」，否則不要主動將故事引導至任何知名的城市或門派。

### 第二階段：初窺門徑 (武功總和 100 - 300)
-   **人物限制**：可以開始出現一些**二、三流的江湖人士**。例如：大城市裡的武館教頭、地方幫派的小頭目、小門派的弟子、或遊歷在外的獨行俠。他們有武功，但實力有限。
-   **事件限制**：可以開始引入一些**區域性的江湖事件**。例如：城鎮中的幫派火拼、護送商隊、或是關於某个小門派的傳聞。可以開始出現一些基礎武功秘笈的線索。
-   **地點限制**：如果玩家已離開新手村，故事可以發生在周邊的縣城或市集。可以開始提及一些知名的江湖門派或地點，但只是作為背景傳聞。

### 第三階段：嶄露頭角 (武功總和 > 300)
-   **解除限制**：此時，玩家已經具備一定的實力。你可以自由發揮，生成各種符合武俠世界觀的人物、事件和地點，包括一流高手和重大的江湖陰謀。
`;
};

module.exports = { getWorldviewAndProgressionRule };
