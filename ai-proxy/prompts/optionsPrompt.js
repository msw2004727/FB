// prompts/optionsPrompt.js
// 並行生成行動選項 + 善惡值 + 書僮建議

function getOptionsPrompt(playerAction, evt, pc, scenario) {
    const scenarioHints = {
        wuxia: '這是一個武俠世界。選項應符合古代江湖氛圍（如探查、切磋、拜訪）。',
        school: '這是一個校園遊戲世界。選項應符合高中生活（如上課、社團、探索校園）。',
        mecha: '這是一個末世機甲世界。選項應符合軍事基地生活（如巡邏、維修、訓練）。',
        modern: '這是現代台北的平行世界。選項應符合都市日常（如通勤、調查、社交）。',
        animal: '這是動物靈域世界。選項應符合動物行為（如覓食、巡域、與其他動物互動）。',
        hero: '這是超能力英雄世界。選項應符合諮商師日常（如諮商、調查、應對異能事件）。',
    };
    const hint = scenarioHints[scenario] || scenarioHints.wuxia;

    return `根據玩家行動和世界觀，生成下一步行動選項。回覆純 JSON。

## 世界觀
${hint}

## 當前情境
玩家行動：${playerAction || '未知'}
事件：${evt || '未知'}
玩家狀態：${pc || '未知'}

## 回覆格式
{
  "actionOptions": ["選項1", "選項2", "選項3"],
  "actionMorality": [數字, 數字, 數字],
  "suggestion": "一句15字以內的建議或吐槽"
}

## 規則
1. actionOptions 恰好 3 個繁體中文字串，每個 8-15 字，以動詞開頭
2. 選項必須與當前世界觀和情境緊密相關，禁止出現不屬於此世界的內容
3. actionMorality 必須包含至少一個正數和一個負數，禁止三個都是 0
4. 全部繁體中文，允許少量 emoji`;
}

module.exports = { getOptionsPrompt };
