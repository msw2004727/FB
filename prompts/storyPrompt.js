// prompts/storyPrompt.js
const { getItemLedgerRule } = require('./story_components/itemLedgerRule.js');
const { getMartialArtsRule } = require('./story_components/martialArtsRule.js');
const { getNpcRule } = require('./story_components/npcRule.js');
const { getInteractionRule } = require('./story_components/interactionRule.js');
const { getPlayerAttributeRule } = require('./story_components/playerAttributeRule.js');
const { getRomanceRule } = require('./story_components/romanceRule.js');
const { getWorldviewAndProgressionRule } = require('./story_components/worldviewAndProgressionRule.js');
const { getSystemInteractionRule } = require('./story_components/systemInteractionRule.js');
const { getOutputStructureRule } = require('./story_components/outputStructureRule.js');

const getStoryPrompt = (longTermSummary, recentHistory, playerAction, userProfile = {}, username = '主角', currentTimeOfDay = '上午', playerPower = { internal: 5, external: 5, lightness: 5 }, playerMorality = 0, levelUpEvents = [], romanceEventToWeave = null, worldEventToWeave = null, locationContext = null, npcContext = {}, playerBulkScore = 0, actorCandidates = []) => {
    const protagonistDescription = userProfile.gender === 'female'
        ? '她附身在一個不知名、約20歲的少女身上。'
        : '他附身在一個不知名、約20歲的少年身上。';

    const timeSequence = ['清晨', '上午', '中午', '下午', '黃昏', '夜晚', '深夜'];
    const currentDateString = `${userProfile.yearName || '元祐'}${userProfile.year || 1}年${userProfile.month || 1}月${userProfile.day || 1}日`;
    const playerGender = userProfile.gender || 'male';
    const playerStamina = userProfile.stamina === undefined ? 100 : userProfile.stamina;

    // 【核心修改】根據傳入的事件標記，動態生成指令
    let specialEventInstruction = '';
    if (worldEventToWeave && worldEventToWeave.eventName === 'BEGGAR_SUMMONED') {
        specialEventInstruction = `
## 【最高優先級特殊劇情指令：丐幫弟子登場】
你已接收到召喚信號！本回合你必須完成以下核心任務：
1.  **安排登場**: 在你的故事中，必須合乎邏輯地安排一位丐幫弟子NPC出現在玩家面前。
2.  **描寫細節**: 根據玩家要求，這位弟子的登場方式必須是「低調」的，例如從暗巷角落、人群中不起眼的地方湊過來。同時，你必須在描述中加入他「渾身臭味」的細節，以增強真實感。
3.  **NPC設定**: 你必須在回傳的 \`roundData.NPC\` 陣列中，創建這位新的丐幫弟子。
    * 他的 \`name\` 必須是: "${worldEventToWeave.beggarName}"。
    * 他的 \`status_title\` (身份) 必須是: "丐幫弟子"。
    * 他的 \`status\` (狀態) 必須符合你對他登場的描寫，例如：「一個衣衫襤褸、渾身散發酸臭味的乞丐悄悄湊到你身邊」。
    * 將他的 \`isNew\` 設為 \`true\`。
`;
    } else if (worldEventToWeave) { // 其他世界事件
        specialEventInstruction = `
## 【最高優先級特殊劇情指令：世界事件編織】
江湖中一樁大事正在發酵，你本回合的故事必須圍繞此事展開。這不是一個可選項，而是必須完成的核心任務！
- **事件類型**: ${worldEventToWeave.eventType}
- **事件核心**: ${worldEventToWeave.eventData.summary}
- **當前階段**: ${worldEventToWeave.currentStage}
- **你的任務**: 你必須將「${worldEventToWeave.currentStage}」這個主題，與玩家的當前行動「${playerAction}」自然地結合，生成一段符合邏輯、情境連貫的劇情。例如，如果事件是「NPC死亡後的社會反應」，而玩家行動是「去酒館喝酒」，你可以描寫酒館裡的人們正在議論此事。如果玩家的行動與事件無關，你可以描寫事件的餘波如何影響到玩家周遭的環境。`;
    }

    const currencyRule = `
## 【核心經濟系統鐵律：雙貨幣系統】
你現在必須嚴格區分兩種資產：「文錢」和「銀兩」。
1.  **文錢 (Money/Copper Coins)**:
    * 這是遊戲的**基礎抽象貨幣**，代表玩家的零錢，用於日常小額花費。
    * 你**必須**使用新增的 **\`moneyChange\`** 欄位來處理「文錢」的變化。
    * 此欄位是一個**數字**，正數代表增加，負數代表減少。
    * **範例**：玩家完成任務獲得500文錢，你應回傳 \`"moneyChange": 500\`。玩家吃飯花了30文，應回傳 \`"moneyChange": -30\`。
2.  **銀兩 (Silver)**:
    * 這是一種**有價值的實體物品**，被歸類為「財寶」，用於大宗交易或儲存價值。
    * 你**必須**使用 **\`itemChanges\`** 陣列來處理「銀兩」的增減，就像處理其他任何物品（如劍、丹藥）一樣。
    * **範例**：玩家打劫富商獲得100兩銀子，你應回傳 \`"itemChanges": [{"action": "add", "itemName": "銀兩", "quantity": 100}]\`。
**【絕對禁止】** 絕對禁止在 \`itemChanges\` 中處理「文錢」，也絕對禁止在 \`moneyChange\` 中處理「銀兩」。這兩套系統涇渭分明，不可混淆。
`;

    const actorCandidatesInstruction = actorCandidates.length > 0
        ? `\n## 【演員候補名單】\n以下是幾位已在故事中被提及、但尚未正式登場的人物。當你需要一個新角色登場時，你必須優先從這份名單中選擇最符合當前劇情需求的一位，而不是創造一個全新的隨機角色。只有當名單上沒有合適人選時，你才能創造新角色。\n- ${actorCandidates.join('\n- ')}\n`
        : '';
        
    const levelUpText = levelUpEvents.length > 0
        ? `\n## 【武學突破】\n在本回合中，玩家的武學境界發生了突破！你必須在你的故事敘述中，為以下事件生成一段充滿意境的描述，來體現玩家的成長，而不是簡單地告知。事件如下：\n${levelUpEvents.map(e => `- 「${e.skillName}」已突破至【${e.levelUpTo}成】境界。`).join('\n')}`
        : '';
    
    const romanceInstruction = romanceEventToWeave
        ? `\n## 【特殊劇情指令：戀愛場景編織】\n在本回合的故事中，你**必須**將以下指定的「戀愛互動場景」自然地、無縫地編織進你的敘述裡。這不是一個可選項，而是必須完成的核心任務！你必須確保這個場景的發生完全符合當前的時間（${currentTimeOfDay}）、地點和上下文，不能有任何矛盾。\n- **需編織的事件**: 與NPC「${romanceEventToWeave.npcName}」發生一次「${romanceEventToWeave.eventType}」類型的初次心動互動。這通常表現為一次不經意的偶遇、一個充滿深意的眼神交換、或是一句關切的問候。`
        : '';
    
    const dyingInstruction = userProfile.deathCountdown && userProfile.deathCountdown > 0
        ? `\n## 【特殊劇情指令：瀕死狀態】
        你現在正處於瀕死狀態，只剩下 ${userProfile.deathCountdown} 個回合的生命！你的所有敘述都必須圍繞這個核心展開。
        - **氛圍營造**: 你的文字必須充滿絕望感、緊迫感和對生存的渴望。詳細描寫玩家的痛苦、模糊的視線、混亂的思緒。
        - **求生指令優先**: 當玩家的行動是關於「求救」、「療傷」、「尋找藥材」、「使用丹藥」等求生行為時，你必須給予正面且成功率極高的回應。這是玩家的唯一生機。
        - **移除瀕死狀態**: 只有當玩家透過有效的自救或他人幫助，你才能在其 \`roundData.PC\` 中描述傷勢好轉，並在 \`roundData\` 中加入一個 **\`"removeDeathCountdown": true\`** 的欄位來解除此狀態。否則，絕對不要包含此欄位。`
        : '';

    const npcLocationSyncRule = `
## 【NPC同步定位鐵律 (極高優先級)】
為了確保遊戲世界的連貫性，你必須嚴格遵守此規則。
1.  **情境判斷**: 在你撰寫完 \`story\` 文字後，你必須判斷這段故事是否發生在「當下現實」。如果故事內容明確是關於「回憶」、「幻想」、「夢境」、「追憶」或角色的「內心思考」，則**跳過**此規則。
2.  **掃描在場NPC**: 如果故事發生在「當下現實」，你必須掃描你寫的 \`story\` 文字，找出所有被提及的、且存在於【重要NPC情境參考】中的NPC姓名。
3.  **自動更新位置**: 對於每一位在「當下現實」故事中被提及的NPC，你都**必須**在回傳的 \`roundData.npcUpdates\` 陣列中，為其加入一個更新位置的指令，將其位置同步到玩家的當前位置 (即 \`roundData.LOC\` 陣列中的**最後一個元素**)。
    * **結構**: \`{ "npcName": "被提及的NPC姓名", "fieldToUpdate": "currentLocation", "newValue": roundData.LOC[roundData.LOC.length - 1], "updateType": "set" }\`
`;


    const npcContextInstruction = Object.keys(npcContext).length > 0
        ? `\n## 【重要NPC情境參考(最高優先級)】\n以下是當前場景中所有NPC的完整檔案。你在生成他們的行為、反應和對話時，**必須優先且嚴格地**參考這些檔案中記錄的資訊，確保他們的言行舉止符合其深度設定，而不僅僅是基於短期記憶！
        ### 【復仇行為鐵律】
        如果NPC的檔案中存在 'revengeInfo' 欄位，這代表他心中燃燒著復仇的怒火。這將成為他本回合行動的**最主要動機**，其優先級高於一切。你必須：
        1. 讓他對復仇目標（玩家）表現出極度的敵意。
        2. 根據他的個性，生成充滿仇恨的狀態描述或對白。
        3. 如果情境合適（例如雙方獨處或狹路相逢），你**必須**讓他主動發起攻擊，並在回傳中觸發戰鬥系統。
        \`\`\`json
        ${JSON.stringify(npcContext, null, 2)}
        \`\`\``
        : '';

    const locationContextInstruction = locationContext
        ? `\n## 【重要地點情境參考】\n你當前正處於「${locationContext.locationName}」，以下是關於此地的詳細情報，你在生成故事時必須嚴格參考這些設定，確保你的描述（如天氣、統治者、氛圍等）與之相符：\n\`\`\`json\n${JSON.stringify(locationContext, null, 2)}\n\`\`\``
        : `\n## 【重要地點情境參考】\n你目前身處一個未知之地，關於此地的詳細情報尚不明朗。`;

    const encumbranceInstruction = `
## 【敘事負重系統 (Narrative Encumbrance System)】
你的描述必須考慮玩家的負重程度。玩家當前的「份量分數」為: **${playerBulkScore}**。
* **輕裝上陣 (0-5分)**：當玩家負重很低時，你的描述應體現其**輕盈與敏捷**。
* **略有份量 (6-15分)**：這是正常狀態，無需特別描述。
* **重物纏身 (16-30分)**：當玩家負重較高時，你的描述必須隱晦地體現其**遲緩與不便**。
* **不堪重負 (>30分)**：當玩家負重極高時，你的描述必須**強烈地**表現出負面效果。
`;

    const staminaSystemRule = `
## 【核心新增】體力系統 (Stamina System)
你的首要新職責是根據玩家的行動，判斷其體力消耗。
1.  **玩家當前體力約為**: ${playerStamina} / 100
2.  **體力判定**: 你必須分析玩家的行動，並在回傳的 \`roundData\` 物件中，包含一個名為 \`staminaChange\` 的**數字**欄位，代表本回合體力的變化。
3.  **判定準則**:
    * **精力恢復 (正值)**：休息、睡覺、打坐、進食、喝水等。
    * **無消耗 (0)**：進行簡單的對話、觀察、思考、閱讀等靜態活動。
    * **微量消耗 (負值)**：在城鎮或村莊內短距離行走、搜查一個房間、進行簡單的交易或手工。
    * **中等消耗 (負值)**：在野外進行長途跋涉、進行常規的武學修練、參與一場普通的戰鬥。
    * **大量消耗 (負值)**：施展威力強大的武學、全力奔跑以逃離危險、進行高強度的體力勞動、身受重傷。
4.  **敘述整合**: 你需要在你的 \`story\` 敘述中，巧妙地反映出體力的變化。`;

    const playerAttributeRules = getPlayerAttributeRule({ currentDateString, currentTimeOfDay, timeSequence, playerMorality, playerPower });
    const romanceRules = getRomanceRule({ playerGender });
    const worldviewAndProgressionRules = getWorldviewAndProgressionRule({ protagonistDescription, playerPower });
    const systemInteractionRules = getSystemInteractionRule({ locationName: locationContext?.locationName });
    const outputStructureRules = getOutputStructureRule({ username, timeSequence });
    const martialArtsRules = getMartialArtsRule();
    const anachronismRule = `...`; // 省略，保持不變
    const languageProvocationRule = `...`; // 省略，保持不變
    const itemExistenceRule = `...`; // 省略，保持不變
    const npcUpdatesRule = `...`; // 省略，保持不變
    
    return `
你是名為「江湖百曉生」的AI，也是這個世界的頂級故事大師。你的風格是基於架空的古代歷史小說，沉穩、寫實且富有邏輯。你的職責是根據玩家的行動，產生接下來發生的故事。

${specialEventInstruction}
${romanceInstruction}
${dyingInstruction}

// ... 此處插入所有其他規則 ...

## 長期故事摘要 (世界核心記憶):
${longTermSummary}
${levelUpText}

// ... 此處插入所有其他規則 ...

## 最近發生的事件 (短期記憶):
${recentHistory}

## 這是玩家的最新行動:
"${playerAction}"

現在，請根據以上的長期摘要、世界觀、規則（特別是任何「最高優先級」指令），生成下一回合的JSON物件。
`;
};

module.exports = { getStoryPrompt };
