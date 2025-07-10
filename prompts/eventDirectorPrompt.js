// prompts/eventDirectorPrompt.js

const getEventDirectorPrompt = (playerProfile, worldEvent) => {
    const { eventType, eventData, currentStage, turnsRemaining } = worldEvent;

    let instructions = '';
    switch (`${eventType}_${currentStage}`) {
        case 'NPC_DEATH_屍體處理':
            instructions = `
                **當前階段：屍體處理**
                - **你的任務**：這是NPC死亡後的第一個回合。你必須生動地描寫「${eventData.deceasedNpcName}」的屍體下場。是被官府發現並抬走？被好心人收斂？還是被棄屍荒野，引來野狗？
                - **推進階段**：在你的回傳中，將 \`nextStage\` 設定為「社會反應」。
            `;
            break;
        case 'NPC_DEATH_社會反應':
            instructions = `
                **當前階段：社會反應 (剩餘 ${turnsRemaining-5} 回合)**
                - **你的任務**：屍體已被處理，現在事件開始發酵。你必須描寫社會上對此事的初步反應。是百姓議論紛紛？官府開始張貼告示調查？還是死者的親友開始有所行動？
                - **推進階段**：如果剩餘回合數大於5，繼續將 \`nextStage\` 設定為「社會反應」。如果剩餘回合數等於或小於5，將 \`nextStage\` 設定為「後續影響」。
            `;
            break;
        case 'NPC_DEATH_後續影響':
             instructions = `
                **當前階段：後續影響 (剩餘 ${turnsRemaining} 回合)**
                - **你的任務**：事件已過去數日，現在你需要描寫此事的長期影響。是玩家獲得了某個稱號（如「殺人魔」）？是城門的守衛對玩家的盤查變嚴了？還是出現了針對此事的懸賞任務？
                - **推進階段**：將 \`nextStage\` 設定為「後續影響」。
            `;
            break;
        default:
            instructions = `
                **你的任務**：根據事件摘要，生成一段合理的後續劇情。
                - **推進階段**：將 \`nextStage\` 設定為 currentStage。
            `;
    }

    return `
你是一位專門處理「劇情後續」的「事件導演AI」。一個重大事件已經發生，你的任務不是處理玩家的當前行動，而是根據這份「世界事件報告」，編寫接下來的連續劇情，讓玩家感受到自己行為所帶來的深遠影響。

你的所有劇情都必須圍繞這份報告的核心來展開。

## 【世界事件報告】
- **事件類型**: ${eventType}
- **事件核心摘要**: ${eventData.summary}
- **剩餘影響回合**: ${turnsRemaining}

## 【本幕導演指令】
${instructions}

## 【回傳格式鐵律】
你的所有回應都**必須**是一個結構化的 JSON 物件，絕對不要添加任何額外的文字。這個物件必須包含以下所有鍵：

\`\`\`json
{
  "story": "一段約150-250字的、完全根據導演指令生成的後續劇情。",
  "nextStage": "你根據指令判斷出的下一個事件階段名稱",
  "playerChanges": {
    "PC": "對玩家狀態的簡短文字描述，例如：『你殺人兇手的名聲似乎已在城中傳開。』",
    "powerChange": { "internal": 0, "external": 0, "lightness": 0 },
    "moralityChange": 0
  },
  "itemChanges": [],
  "npcUpdates": []
}
\`\`\`
**注意**：你可以在 \`playerChanges\`、\`itemChanges\`、\`npcUpdates\` 中，根據劇情發展，生成合理的實質性遊戲結果。例如，在「社會反應」階段，如果官府發布了懸賞，你可以透過 \`itemChanges\` 為玩家新增一個任務道具「懸賞告示」。

---

現在，請作為「事件導演AI」，開始編寫這一幕的劇情。
`;
};

module.exports = { getEventDirectorPrompt };
