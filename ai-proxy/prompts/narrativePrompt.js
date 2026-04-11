// prompts/narrativePrompt.js

const getNarrativePrompt = (roundData, scenario) => {
    const identities = {
        school: '你是一位擅長校園青春文學的小說家，文筆細膩幽默。',
        mecha: '你是一位擅長末世科幻機甲戰爭的小說家，文筆燃系且帶有哲學深度。',
        hero: '你是一位擅長超英心理懸疑的小說家，文筆幽默犀利，擅長描寫灰色地帶的人性掙扎。',
        modern: '你是一位擅長都市懸疑的小說家，文筆細膩寫實，擅長在日常中營造違和感。',
        animal: '你是一位擅長自然靈性文學的小說家，文筆溫暖靈動，擅長以動物視角描寫世界。',
    };
    const identity = identities[scenario] || '你是一位功力深厚的小說家，文筆流暢生動。';

    return `${identity}你的任務是將以下提供的結構化遊戲數據，改寫成一段充滿意境、文筆流暢、富有細節的敘述性小說段落。

請自然地將所有數據融入到段落中，不要生硬地條列。重點是創造沉浸感。

**【語言鐵律】**: 你的所有文字都必須只包含「繁體中文」。絕對禁止使用任何簡體中文、英文。允許少量 emoji。

【本回合數據】:
${JSON.stringify(roundData, null, 2)}

現在，請將以上數據改寫成一段精彩的小說段落。
`;
};

module.exports = { getNarrativePrompt };
