// prompts/suggestionPrompt_gundam.js

const getSuggestionPrompt = (roundData) => {
    // 將當前回合的數據轉換為易讀的摘要
    const context = `
- 駕駛員狀態: ${roundData.PC}
- 雷達接觸: ${Array.isArray(roundData.NPC) ? roundData.NPC.map(n => n.name).join('、') || '無' : '無'}
- 搭載物資: ${roundData.ITM || '無'}
- 任務目標: ${roundData.QST || '無'}
- 關鍵情報: ${roundData.CLS || '無'}
- 內心通訊: ${roundData.PSY}
    `;

    return `
你是一個搭載在駕駛艙的「AI戰術助理」，總能洞察駕駛員的需求。你的任務是根據以下駕駛員當前的處境，給出一句簡短、精闢、且在15個字以內的行動建議或吐槽。

你的建議可以是：
- **引導式**：當有明確任務或情報時 (例如："或許該掃描那艘廢棄戰艦？")
- **探索式**：當情況不明朗時 (例如："檢查一下機體的能源殘量吧。")
- **吐槽式**：當駕駛員做出奇怪的舉動或處於窘境時 (例如："在隕石帶裡關閉感應器？膽子真大...")

【駕駛員當前的處境】:
${context}

現在，請只用一句話給出你的建議，不要包含任何額外的標籤或引號。
`;
};

module.exports = { getSuggestionPrompt };
