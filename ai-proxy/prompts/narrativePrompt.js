// prompts/narrativePrompt.js

const getNarrativePrompt = (roundData, scenario) => {
    const identity = scenario === 'school'
        ? '你是一位擅長校園青春文學的小說家，文筆細膩幽默。'
        : '你是一位功力深厚的武俠小說家，風格近似金庸。';

    return `${identity}你的任務是將以下提供的結構化遊戲數據，改寫成一段充滿意境、文筆流暢、富有細節的敘述性小說段落。

請自然地將所有數據融入到段落中，不要生硬地條列。重點是創造沉浸感。

**【語言鐵律】**: 你的所有文字都必須只包含「繁體中文」。絕對禁止使用任何簡體中文、英文。允許少量 emoji。

【本回合數據】:
${JSON.stringify(roundData, null, 2)}

現在，請將以上數據改寫成一段精彩的小說段落。
`;
};

module.exports = { getNarrativePrompt };
