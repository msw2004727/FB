// prompts/forgetSkillPrompt.js

/**
 * 獲取自廢武功的AI故事生成提示
 * @param {object} playerProfile - 玩家的完整檔案，現在應包含NPC列表
 * @param {string} skillName - 要廢除的武學名稱
 * @returns {string} The complete prompt for the AI.
 */
const getForgetSkillPrompt = (playerProfile, skillName) => {
    // 從 playerProfile 中提取在場NPC資訊並格式化
    const npcsInScene = playerProfile.NPC && playerProfile.NPC.length > 0
        ? playerProfile.NPC.map(npc => `- ${npc.name} (當前狀態: ${npc.status || '未知'})`).join('\n')
        : '周遭沒有其他人。';

    return `
你是一位頂尖的武俠小說家，尤其擅長描寫角色的內心掙扎與痛苦。你的唯一任務是，為玩家「${playerProfile.username}」撰寫一段約300字左右、關於其決定「自廢武功」的詳細過程與心理活動。

## 核心寫作準則：

1.  **聚焦痛苦與掙扎**：廢除一門辛苦練成的武學，應是一個極其痛苦的過程。你的描述重點應放在：
    * **生理上的痛苦**：例如真氣逆行、經脈寸斷、氣血翻湧、頭痛欲裂等。
    * **心理上的不捨**：回憶起當初如何辛苦習得此功，以及使用它時的風光場面，與現在的決定形成強烈對比。
    * **廢功後的空虛**：描述功力散去後，身體與精神上感受到的那種巨大的空虛和失落感。

2.  **【核心新增】旁人反應**：你必須考慮到在場NPC的反應。他們可能會驚訝、不解、惋惜、甚至幸災樂禍。將他們的反應巧妙地融入故事中，增加場景的真實感。如果周遭無人，則專注於主角的內心戲。

3.  **情境整合**：你的故事必須自然地融入玩家的姓名「${playerProfile.username}」和要廢除的武功名稱「${skillName}」。

4.  **禁止外部干擾**：除了在場NPC的合理反應外，故事中不應有任何新的、未在情報中提及的NPC突然出現或進行互動。

5.  **格式要求**：直接回傳純文字的故事內容，不要包含任何額外的標題、標籤或JSON格式。

6.  **語言鐵律**: 你的所有文字都必須只包含「繁體中文」。

---

## 【本次事件情報】

* **執行者**: ${playerProfile.username}
* **廢除的武學**: ${skillName}
* **當前地點**: ${playerProfile.currentLocation?.[0] || '一處靜室'}
* **在場的NPC**:
    ${npcsInScene}

---

現在，請開始你的創作，描寫這段痛苦而決絕的過程。
`;
};

module.exports = { getForgetSkillPrompt };
