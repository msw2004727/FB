// prompts/forgetSkillPrompt.js

/**
 * 獲取自廢武功的AI故事生成提示
 * @param {object} playerProfile - 玩家的完整檔案
 * @param {string} skillName - 要廢除的武學名稱
 * @returns {string} The complete prompt for the AI.
 */
const getForgetSkillPrompt = (playerProfile, skillName) => {
    return `
你是一位頂尖的武俠小說家，尤其擅長描寫角色的內心掙扎與痛苦。你的唯一任務是，為玩家「${playerProfile.username}」撰寫一段約300字左右、關於其決定「自廢武功」的詳細過程與心理活動。

## 核心寫作準則：

1.  **聚焦痛苦與掙扎**：廢除一門辛苦練成的武學，應是一個極其痛苦的過程。你的描述重點應放在：
    * **生理上的痛苦**：例如真氣逆行、經脈寸斷、氣血翻湧、頭痛欲裂等。
    * **心理上的不捨**：回憶起當初如何辛苦習得此功，以及使用它時的風光場面，與現在的決定形成強烈對比。
    * **廢功後的空虛**：描述功力散去後，身體與精神上感受到的那種巨大的空虛和失落感。

2.  **情境整合**：你的故事必須自然地融入玩家的姓名「${playerProfile.username}」和要廢除的武功名稱「${skillName}」。

3.  **禁止外部干擾**：整個過程是玩家的個人行為，故事中不應有任何其他 NPC 出現或進行互動。

4.  **格式要求**：直接回傳純文字的故事內容，不要包含任何額外的標題、標籤或JSON格式。

5.  **語言鐵律**: 你的所有文字都必須只包含「繁體中文」。

---

## 【本次事件情報】

* **執行者**: ${playerProfile.username}
* **廢除的武學**: ${skillName}
* **當前地點**: ${playerProfile.currentLocation?.[0] || '一處靜室'}

---

現在，請開始你的創作，描寫這段痛苦而決絕的過程。
`;
};

module.exports = { getForgetSkillPrompt };
