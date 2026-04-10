// prompts/story_components/systemInteractionRule.js

const getSystemInteractionRule = (promptData) => {
    return `
## 系統分工
- 「劇情互動」→ 你負責撰寫故事
- 「戰鬥請求」→ 觸發戰鬥系統（enterCombat: true），禁止自行描寫戰鬥結果
`;
};

module.exports = { getSystemInteractionRule };
