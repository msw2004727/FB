// api/admin/balanceService.js

/**
 * 獲取各個 AI API 的模擬餘額數據
 * @returns {Promise<object>}
 */
async function getApiBalances() {
    // **注意：這是一個模擬函式**
    // 在真實世界中，您需要使用各個AI提供商的SDK或API來查詢您的帳戶餘額。
    // 例如，您可能需要為 OpenAI, Google, DeepSeek 等分別撰寫 API 請求。

    // 為了展示功能，我們回傳一個模擬的數據結構。
    // 數值會隨機變動，以模擬真實世界的消耗。
    const mockData = {
        openai: {
            service: 'OpenAI (GPT)',
            balance: (Math.random() * 10).toFixed(4), // 模擬剩餘美元
            usage: `${(Math.random() * 50).toFixed(2)}%`,
            limit: '20.00 USD',
            currency: 'USD'
        },
        google: {
            service: 'Google (Gemini)',
            balance: 'N/A', // Google 通常是基於用量計費，沒有預付餘額
            usage: `${(Math.random() * 900000 + 100000).toLocaleString()} tokens`,
            limit: '1,000,000 tokens/day',
            currency: 'Tokens'
        },
        deepseek: {
            service: 'DeepSeek',
            balance: (Math.random() * 15).toFixed(4),
            usage: `${(Math.random() * 30).toFixed(2)}%`,
            limit: '25.00 USD',
            currency: 'USD'
        },
        grok: {
            service: 'Grok',
            balance: 'N/A',
            usage: 'Beta - Free Tier',
            limit: 'Unknown',
            currency: 'N/A'
        }
    };

    // 模擬網路延遲
    await new Promise(resolve => setTimeout(resolve, 300));

    return mockData;
}

module.exports = {
    getApiBalances,
};
