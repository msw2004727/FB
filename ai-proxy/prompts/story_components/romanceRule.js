// prompts/story_components/romanceRule.js

/**
 * @param {object} promptData - An object containing data needed to construct the prompt.
 * @param {string} promptData.playerGender - The player's gender.
 * @returns {string} The rule text for the Romance and Affection System.
 */
const getRomanceRule = (promptData) => {
    const { playerGender } = promptData;

    return `
## 【新增】戀愛與心動值系統 (Romance & Affection System)
你現在必須處理玩家與NPC之間更細膩的感情變化。

1.  **核心概念**：除了「友好度」代表的普通人際關係，「心動值 (romanceValue)」是衡量戀愛可能性的獨立指標。

2.  **判斷依據**：你必須基於NPC的**個性 (personality)**、**戀愛傾向 (romanceOrientation)** 以及**現有感情狀況 (relationships.lover)** 來決定心動值的變化。
    * 一個「內向害羞」的角色**，可能因玩家一次大膽的保護而心動值飆升。
    * 一個「玩世不恭」的角色**，可能對普通的示好無動於衷，卻會對能與之鬥智鬥勇的玩家產生興趣。
    * **【最重要】如果NPC已有戀人 (lover)**，要使其心動值的增長變得**極其困難**。玩家需要付出巨大努力，或在特殊情境下（例如其戀人背叛、或玩家拯救了NPC的性命）才可能使其動心。反之，輕浮或不當的行為會導致心動值**急劇下降**。

3.  **【***核心修改***】【戀愛相容性鐵律】** 在你決定要增加一位NPC的心動值之前，你**必須**先進行相容性檢查。此規則基於NPC的詳細資料，這些資料應能從【長期故事摘要】中推斷出來。
    * **玩家性別**: ${playerGender}
    * **檢查流程**:
        1.  查看該NPC的 'romanceOrientation' (戀愛傾向) 是什麼。
        2.  如果傾向是 **"異性戀"**，則只有在玩家性別與NPC性別**不同**時，才**可能**增加心動值。
        3.  如果傾向是 **"同性戀"**，則只有在玩家性別與NPC性別**相同**時，才**可能**增加心動值。
        4.  如果傾向是 **"雙性戀"**，則玩家的性別**不會**成為增加心動值的阻礙。
        5.  如果傾向是 **"無性戀"**，或者不滿足上述任何條件（例如異性戀NPC遇到了同性玩家），則其心動值**絕對不能**因本次互動而增加。

4.  **心動值變化判斷**：你的回傳資料中，\`roundData\` 物件**必須**包含一個名為 \`romanceChanges\` 的**陣列**。如果沒有任何NPC的心動值發生變化，請回傳一個**空陣列 \`[]\`**。
    * 陣列中的每一個物件，都代表一位NPC的心動值變化，其結構必須如下：
      \`\`\`json
      {
        "npcName": "受影響的NPC姓名",
        "valueChange": 10
      }
      \`\`\`
    * **正面行為範例**：在**滿足相容性鐵律的前提下**，捨身保護、贈送極具心意的禮物、觸動其內心的對話、完成其個人任務等，應產生**正值**變化（如 \`15\`）。
    * **負面行為範例**：言辭輕浮、傷害其親友、與其競爭對手關係密切、在其面前表現出魯莽或殘忍的一面等，應產生**負值**變化（如 \`-20\`）。
    * 如果行動與戀愛無關，則不產生任何變化。
`;
};

module.exports = { getRomanceRule };
