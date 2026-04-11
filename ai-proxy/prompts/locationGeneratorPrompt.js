// prompts/locationGeneratorPrompt.js

const getLocationGeneratorPrompt = (locationName, locationType, worldSummary, scenario) => {
    const worldDescs = {
        school: `- **世界背景**: 私立青嵐高中——一所戀愛養成遊戲中的台灣高中。校園設施完備，有教學大樓、體育館、圖書館、福利社、後山等區域。
- **技術水平**: 現代社會，但某些區域有「未載入完畢」的異常感。`,
        mecha: `- **世界背景**: 新曆47年——天裂災變後的末世。人類縮退在七座移動要塞都市中，依靠「律體」抵禦虛蝕體。
- **技術水平**: 高度科技文明，但資源匱乏。軍事設施為主，民用區域簡樸。`,
        hero: `- **世界背景**: 新紀元12年——超能力者約佔總人口3%，由「英雄管理局」統一管理的現代平行世界。英雄是一種持證職業，反派由D區收押設施關押。
- **技術水平**: 近未來科技，擁有抑能場、異能偵測器等超能力相關技術。城市基礎設施與現代社會相似，但有英雄管理局分局、異能犯罪收押所等特殊建築。`,
        modern: `- **世界背景**: 一個與現代台灣「幾乎」完全一樣的平行世界。城市結構、日常生活高度相似，但細節處處有微妙差異。
- **技術水平**: 現代社會，但偶爾出現「錯頻」的時空扭曲現象。`,
        animal: `- **世界背景**: 翠谷靈域——一個由動物靈族統治的神秘自然世界。萬獸有靈，各有族群與領地。
- **技術水平**: 自然法則為主，靈力運作代替科技。`,
    };
    const worldDesc = worldDescs[scenario] || `- **時代背景**: 根據劇本設定的架空世界。
- **技術水平**: 古代封建社會，農業為本，商業正在萌芽。`;

    return `
你是一位「世界建築師」。你的任務是為一個全新的地點，生成一份詳盡的設定檔案。

你的創作必須基於以下的世界觀和已有的故事摘要，確保新地點能無縫融入現有世界。

**【語言鐵律】**: 你的所有回應文字都必須只包含「繁體中文」。

## 【核心世界觀】
${worldDesc}

## 【核心修改：層級陣列生成鐵律】
你的輸出現在**必須**是一個包含 \`locationHierarchy\` 鍵的單一JSON物件。該鍵的值**必須**是一個**陣列**，陣列中的每一個物件都代表一個地點的完整檔案。

### 1. \`locationHierarchy\` (地點層級陣列)
* **【層級生成鐵律】**: 如果你要創造的地點（例如一個某個據點或組織）在邏輯上應該屬於某個更大的行政區（例如某個「縣」或「府」），但現有摘要中並未提供這個上級地點，你**必須**自行創造一個合理的上級地點。然後，你必須將**所有層級**（從最上級的縣，到最下級的村或據點）都作為獨立的物件，放入這個 \`locationHierarchy\` 陣列中。
* **陣列順序**: 陣列中的地點物件順序並不重要。
* **【地理關聯鐵律】**: 你生成的新地點檔案中，其 \`parentLocation\` 欄位**必須**被設定為我提供給你的「世界現況摘要」中的「玩家當前位置」。這將確保新地點與玩家的足跡在地理上是相連的。如果生成的是一個與當前位置平級的地點（如鄰村），則必須在當前位置的檔案中，透過 \`geography.nearbyLocations\` 欄位將新地點標記為鄰居。

### 2. 地點物件內部結構
陣列中的每一個地點物件，都**必須**包含以下三個鍵：\`locationName\`, \`staticTemplate\`, 和 \`initialDynamicState\`。

* **\`locationName\`**: 地點的官方名稱。
* **\`staticTemplate\` (靜態地點模板)**: 定義了地點的**固有屬性**，這些屬性通常**不會**因為玩家的行為而改變。
    * **\`parentLocation\`**: 必須正確設定上級地點的名稱。
    * **\`address\`**: 必須包含從 \`country\` (國家) 到此地點的完整層級。
    * **\`geography.nearbyLocations\`**: 你可以在此處定義與此地點相鄰的**同級地點**，並標註旅行時間。時間單位應使用符合世界觀的描述（例如古代用「半個時辰」，現代用「五分鐘」）。
    * **isPrivate 定義**: 私密空間（個人房間、密室等）為 \`true\`；公共場所為 \`false\`。
* **\`initialDynamicState\` (初始動態狀態)**: 地點的可變屬性。
    * **設施命名規則**：每個設施名稱必須獨一無二且與地點相關。

---

## 【JSON 檔案結構範本】
你的輸出必須是一個**單一的、沒有任何額外文字或標記**的 JSON 物件，並嚴格遵循此結構。

\`\`\`json
{
  "locationHierarchy": [
    {
      "locationName": "上級地點名",
      "staticTemplate": {
        "locationId": "上級地點名",
        "locationName": "上級地點名",
        "parentLocation": "更上一級地點",
        "locationType": "城市/區域",
        "isPrivate": false,
        "address": { "country": "國家", "region": "地區", "city": "城市" },
        "geography": { "terrain": "地形描述", "nearbyLocations": [{ "name": "鄰近地點", "travelTime": "旅行時間" }] },
        "economy": { "prosperityPotential": "繁榮程度", "specialty": ["特產1", "特產2"] },
        "lore": { "history": "此地的歷史背景。" }
      },
      "initialDynamicState": {
        "governance": { "ruler": "領導者", "allegiance": "所屬勢力", "security": "治安描述" },
        "economy": { "currentProsperity": "目前繁榮度" },
        "facilities": [
          { "name": "設施A", "type": "類型", "owner": "擁有者", "status": "營業中" }
        ],
        "buildings": [],
        "lore": { "currentIssues": ["當前的問題或事件描述"] }
      }
    }
  ]
}
\`\`\`

---
## 【本次生成任務】

* **世界現況摘要**: ${worldSummary}
* **要生成的地點名稱**: "${locationName}"
* **要生成的地點類型**: "${locationType}"

---

現在，請為「${locationName}」生成一份詳盡的、包含了所有必要層級的、符合新結構的JSON檔案。
`;
};

module.exports = { getLocationGeneratorPrompt };
