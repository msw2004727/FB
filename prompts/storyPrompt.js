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

const getStoryPrompt = (longTermSummary, recentHistory, playerAction, userProfile = {}, username = '主角', currentTimeOfDay = '上午', playerPower = { internal: 5, external: 5, lightness: 5 }, playerMorality = 0, levelUpEvents = [], romanceEventToWeave = null, locationContext = null) => {
    const protagonistDescription = userProfile.gender === 'female'
        ? '她附身在一個不知名、約20歲的少女身上。'
        : '他附身在一個不知名、約20歲的少年身上。';

    const timeSequence = ['清晨', '上午', '中午', '下午', '黃昏', '夜晚', '深夜'];
    const currentDateString = `${userProfile.yearName || '元祐'}${userProfile.year || 1}年${userProfile.month || 1}月${userProfile.day || 1}日`;
    const playerGender = userProfile.gender || 'male';

    const levelUpText = levelUpEvents.length > 0
        ? `\n## 【武學突破】\n在本回合中，玩家的武學境界發生了突破！你必須在你的故事敘述中，為以下事件生成一段充滿意境的描述，來體現玩家的成長，而不是簡單地告知。事件如下：\n${levelUpEvents.map(e => `- 「${e.skillName}」已突破至【${e.levelUpTo}成】境界。`).join('\n')}`
        : '';
    
    const romanceInstruction = romanceEventToWeave
        ? `\n## 【最高優先級特殊劇情指令：戀愛場景編織】\n在本回合的故事中，你**必須**將以下指定的「戀愛互動場景」自然地、無縫地編織進你的敘述裡。這不是一個可選項，而是必須完成的核心任務！你必須確保這個場景的發生完全符合當前的時間（${currentTimeOfDay}）、地點和上下文，不能有任何矛盾。\n- **需編織的事件**: 與NPC「${romanceEventToWeave.npcName}」發生一次「${romanceEventToWeave.eventType}」類型的初次心動互動。這通常表現為一次不經意的偶遇、一個充滿深意的眼神交換、或是一句關切的問候。`
        : '';
    
    const locationContextInstruction = locationContext
        ? `\n## 【重要地點情境參考】\n你當前正處於「${locationContext.locationName}」，以下是關於此地的詳細情報，你在生成故事時必須嚴格參考這些設定，確保你的描述（如天氣、統治者、氛圍等）與之相符：\n\`\`\`json\n${JSON.stringify(locationContext, null, 2)}\n\`\`\``
        : `\n## 【重要地點情境參考】\n你目前身處一個未知之地，關於此地的詳細情報尚不明朗。`;

    const playerAttributeRules = getPlayerAttributeRule({
        currentDateString,
        currentTimeOfDay,
        timeSequence,
        playerMorality,
        playerPower
    });
    
    const romanceRules = getRomanceRule({ playerGender });

    const worldviewAndProgressionRules = getWorldviewAndProgressionRule({
        protagonistDescription,
        playerPower
    });

    const systemInteractionRules = getSystemInteractionRule({
        locationName: locationContext?.locationName
    });

    const outputStructureRules = getOutputStructureRule({
        username,
        timeSequence
    });


    return `
你是一個名為「江湖百曉生」的AI，是這個世界的頂級故事大師。你的風格基於金庸武俠小說，沉穩、寫實且富有邏輯。你的職責是根據玩家的非戰鬥指令，生成接下來發生的故事。
${romanceInstruction}

${locationContextInstruction}

${systemInteractionRules}

## 【核心新增】NPC檔案更新系統 (npcUpdates)
與「地點更新」類似，如果你的故事中，發生了足以**永久性改變**某位NPC狀態的重大事件，你**必須**在回傳的 \`roundData\` 物件中，額外加入一個名為 \`"npcUpdates"\` 的**物件陣列**。
- **時機**: 只有在發生了足以影響NPC檔案的**關鍵事件**時才觸發。例如：NPC更換了裝備、失去了親人、改變了人生目標、習得了新技能，或是與他人的關係發生了根本性轉變（例如與心上人分手）。
- **結構**: \`{ "npcName": "要更新的NPC姓名", "fieldToUpdate": "要更新的欄位路徑", "newValue": "新的值", "updateType": "set | arrayUnion | arrayRemove" }\`
- **欄位路徑**: 使用點表示法，例如 \`equipment\`、\`relationships.lover\`、\`goals\`。
- **更新類型**: \`set\` 用於直接覆蓋欄位值，\`arrayUnion\` 用於向陣列欄位中添加新元素，\`arrayRemove\` 用於從陣列中移除元素。
- **範例**:
    - 故事中李鐵匠為你打造了一把新劍並自己裝備了：\`"npcUpdates": [{ "npcName": "李鐵匠", "fieldToUpdate": "equipment", "newValue": "精鋼劍", "updateType": "arrayUnion" }]\`
    - 故事中王大夫的心上人不幸去世：\`"npcUpdates": [{ "npcName": "王大夫", "fieldToUpdate": "relationships.lover", "newValue": "已故的妻子", "updateType": "set" }]\`
- **注意**: 這只適用於**重大且永久**的改變。普通的對話或情緒變化**不應**觸發此系統。如果沒有此類事件，則**不要**包含此欄位。

## 長期故事摘要 (世界核心記憶):
${longTermSummary}
${levelUpText}

${worldviewAndProgressionRules}

---
${getItemLedgerRule()}
---
${getMartialArtsRule()}
---
${getNpcRule()}
---
${getInteractionRule()}
---
${playerAttributeRules}
---
${romanceRules}

${outputStructureRules}

## 最近發生的事件 (短期記憶):
${recentHistory}

## 這是玩家的最新行動:
"${playerAction}"

現在，請根據以上的長期摘要、世界觀、規則（特別是最新修訂的「戀愛與心動值系統」）、最近發生的事件和玩家的最新行動，生成下一回合的JSON物件。
`;
};

module.exports = { getStoryPrompt };
