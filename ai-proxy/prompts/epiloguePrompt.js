// prompts/epiloguePrompt.js
// 精簡版 — 不依賴已刪除的 inventory/NPC/skills 資料

const getEpiloguePrompt = (playerData) => {
    const username = playerData?.username || playerData?.player?.username || '無名俠客';
    const gender = playerData?.gender || playerData?.player?.gender || playerData?.finalStats?.gender || 'male';
    const genderPronoun = gender === 'female' ? '她' : '他';
    const longTermSummary = playerData?.longTermSummary || playerData?.summary || '這位穿越者在異世界度過了短暫卻精彩的一段時光。';
    const morality = playerData?.player?.morality ?? playerData?.finalStats?.morality ?? 0;
    const deathCause = playerData?.deathInfo?.cause || '在江湖的風波中走向了終點';
    const deathRound = playerData?.deathInfo?.round || '?';
    const lastLocation = playerData?.lastRoundData?.LOC || [];
    const locName = Array.isArray(lastLocation) ? lastLocation[lastLocation.length - 1] || '未知之地' : lastLocation || '未知之地';

    const moralityDesc = morality > 30 ? '一位受人敬重的義士' :
                         morality < -30 ? '一個令人忌憚的狠角色' :
                         '一個在江湖中立場曖昧的奇人';

    return `你是一位幽默而富有洞察力的「世界歷史學家」。請為以下角色撰寫一篇500字的結局故事。

## 角色資料
* 姓名：${username}
* 性別：${gender === 'female' ? '女' : '男'}（稱${genderPronoun}）
* 江湖評價：${moralityDesc}
* 死亡原因：${deathCause}
* 死亡地點：${locName}
* 存活回合數：${deathRound}

## 生平摘要
${longTermSummary}

## 寫作要求
1. 用繁體中文，幽默但帶點惋惜的筆調
2. 回顧${genderPronoun}在這個世界的經歷（根據生平摘要）
3. 描述${genderPronoun}的死如何影響了周遭的人
4. 結尾留一點懸念或溫暖（例如：有人發現了那張寫著「尋找回家的方法」的紙條...）
5. 控制在500字以內
6. 直接回傳純文字故事，不要 JSON 格式
7. 嚴禁簡體中文、英文、emoji
`;
};

module.exports = { getEpiloguePrompt };
