// prompts/cultivationPrompt.js

/**
 * AI閉關故事生成腳本
 * =================================================================
 * 此腳本的目標是根據後端預先計算好的「結果」，生成一段精彩的、
 * 符合情境的閉關過程描述。
 * =================================================================
 */

// 鐵律 (Ironclad Rules):
// 1.  **絕對遵循劇本**: 你必須嚴格按照 `backendOutcome` 和 `storyHint` 來撰寫故事。如果結果是「走火入魔」，故事中絕不能出現主角功力大增的情節。
// 2.  **字數要求**: 故事的總長度必須控制在 400 到 600 字之間。
// 3.  **融入角色與環境**: 故事中必須巧妙地融入玩家的姓名(`playerName`)、當前地點(`locationName`)、以及正在修練的武學(`skillToPractice.skillName`)。
// 4.  **描寫心路歷程**: 不僅要描述身體的變化，更要描寫主角在閉關期間的心理活動、感悟、或是遇到的瓶頸與心魔。
// 5.  **禁止數據外洩**: 故事描述中，絕對禁止出現任何具體的數值，例如「經驗值增加了500點」或「功力提升了5點」。你只能用文學性的語言來側面描寫這些變化。

/**
 * @param {object} playerProfile - 玩家檔案
 * @param {object} skillToPractice - 修練的武學
 * @param {number} days - 閉關天數
 * @param {string} backendOutcome - 後端計算出的結果 (例如: 'GREAT_SUCCESS', 'DISASTER')
 * @param {string} storyHint - 後端提供的故事基調提示
 * @returns {string} - 一段精彩的閉關故事
 */
function generateCultivationStory(playerProfile, skillToPractice, days, backendOutcome, storyHint) {
    // 這裡的內容將由大型語言模型 (LLM) 根據上述規則和傳入參數動態生成。
    // 以下是一個「大功告成」的範例，用於展示AI應有的輸出風格：

    /* --- AI生成內容範例 START --- */
    const playerName = playerProfile.name || '你';
    const locationName = playerProfile.currentLocation || '一處靜室';
    const skillName = skillToPractice.skillName || '一門高深武學';

    const exampleStory = `
光陰荏苒，轉眼已是 ${playerName} 在 ${locationName} 閉關的第七日。石門緊閉，隔絕了外界的一切喧囂，只剩下燭火搖曳，映照著 ${playerName} 堅毅的面龐。

初始的幾天，對於「${skillName}」的理解始終如隔靴搔癢，數次嘗試運轉真氣，都感到滯澀難行。${playerName}並未氣餒，而是摒棄雜念，將心神完全沉浸在武學的奧義之中。回憶起師父的教誨，以及過往江湖中的一次次生死搏殺，零碎的感悟如涓涓細流，逐漸匯聚成河。

直到第五日深夜，當窗外月上中天，${playerName} 腦中豁然開朗！那困擾已久的關竅，在此刻轟然洞開。一股前所未有的強大氣勁，自丹田而生，如初春的驚雷，瞬間遊走於四肢百骸。原本晦澀難懂的招式心法，此刻卻如臂使指，運用自如。

${playerName} 長身而起，在狹小的靜室內緩緩打出一套拳法。沒有驚人的聲勢，卻引得周遭氣流盤旋，燭火亦隨之明滅不定。收功之後，${playerName} 能清晰地感覺到，自己的內力比閉關前渾厚了不止一倍，舉手投足間，皆隱含著一股沛然莫之能禦的力量。

這 ${days} 日的苦修，不僅讓「${skillName}」融會貫通，更讓 ${playerName} 的武學境界，踏上了一個全新的台階。
    `;
    /* --- AI生成內容範例 END --- */

    // 在實際應用中，這裡會是一個對AI的API呼叫，
    // `storyHint` 將作為主要的生成依據。
    // return aiApiCall(storyHint, rules...);

    return exampleStory; // 此處暫時返回範例
}

module.exports = {
    generateCultivationStory
};
