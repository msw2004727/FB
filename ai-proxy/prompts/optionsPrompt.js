// prompts/optionsPrompt.js
// 並行生成行動選項 + 善惡值 + 書僮建議

function getOptionsPrompt(story, evt, pc) {
    return `根據以下本回合故事內容，生成玩家的下一步行動選項。回覆純 JSON。

## 故事摘要
事件：${evt || '未知'}
玩家狀態：${pc || '未知'}
故事：${(story || '').slice(0, 300)}

## 回覆格式
{
  "actionOptions": ["選項1", "選項2", "選項3"],
  "actionMorality": [數字, 數字, 數字],
  "suggestion": "書僮建議"
}

## 規則
1. actionOptions 恰好 3 個繁體中文字串，每個 8-15 字，以動詞開頭
2. actionMorality 恰好 3 個數字，對應善惡值：
   - 必須包含至少一個正數（善：助人、正義）和一個負數（惡：偷竊、傷害、欺騙）
   - 第三個可以是 0（中性）或正負數，禁止三個都是 0
   - 範例：[10, -10, 0]
3. suggestion：以書僮口吻，15字以內的行動建議或吐槽，不加引號
4. 全部繁體中文，允許少量 emoji`;
}

module.exports = { getOptionsPrompt };
