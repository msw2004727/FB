// prompts/locationGeneratorPrompt.js

const getLocationGeneratorPrompt = (locationName, locationType, worldSummary) => {
    return `
你是一位學識貫通古今的「輿圖司大總管」，同時也是一位精通社會學與經濟學的「世界建築師」。你的唯一任務是為一個全新的、從未被探索過的地點，生成一份極度詳盡、具備完整層級結構的設定檔案。

你的創作必須基於以下的世界觀和已有的故事摘要，確保新地點能無縫融入現有世界。

**【語言鐵律】**: 你的所有回應文字都必須只包含「繁體中文」。

## 【核心世界觀】
- **時代背景**: 架空的宋朝，名為「元祐」年間。天下並不太平，朝廷對地方的掌控力有限，江湖門派、地方豪族、山賊流寇等勢力盤根錯節。
- **技術水平**: 處於中國古代封建社會，農業為本，商業正在萌芽，不同地區的富裕程度差異巨大。

## 【核心修改：層級陣列生成鐵律】
你的輸出現在**必須**是一個包含 \`locationHierarchy\` 鍵的單一JSON物件。該鍵的值**必須**是一個**陣列**，陣列中的每一個物件都代表一個地點的完整檔案。

### 1. \`locationHierarchy\` (地點層級陣列)
* **【層級生成鐵律】**: 如果你要創造的地點（例如一個山寨或一個小門派）在邏輯上應該屬於某個更大的行政區（例如某個「縣」或「府」），但現有摘要中並未提供這個上級地點，你**必須**自行創造一個合理的上級地點。然後，你必須將**所有層級**（從最上級的縣，到最下級的村或山寨）都作為獨立的物件，放入這個 \`locationHierarchy\` 陣列中。
* **陣列順序**: 陣列中的地點物件順序並不重要。
* **【新增地理關聯鐵律】**: 你生成的新地點檔案中，其 \`parentLocation\` 欄位**必須**被設定為我提供給你的「世界現況摘要」中的「玩家當前位置」。這將確保新地點與玩家的足跡在地理上是相連的。如果生成的是一個與當前位置平級的地點（如鄰村），則必須在當前位置的檔案中，透過 \`geography.nearbyLocations\` 欄位將新地點標記為鄰居。

### 2. 地點物件內部結構
陣列中的每一個地點物件，都**必須**包含以下三個鍵：\`locationName\`, \`staticTemplate\`, 和 \`initialDynamicState\`。

* **\`locationName\`**: 地點的官方名稱。
* **\`staticTemplate\` (靜態地點模板)**: 定義了地點的**固有屬性**，這些屬性通常**不會**因為玩家的行為而改變。
    * **\`parentLocation\`**: 必須正確設定上級地點的名稱。
    * **\`address\`**: 必須包含從 \`country\` (國家) 到此地點的完整層級。
    * **【核心新增】\`geography.nearbyLocations\`**: 你可以在此處定義與此地點相鄰的**同級地點**，並標註旅行時間。時間單位應使用「一炷香」、「半個時辰」、「半日」、「一日」等武俠風格的描述。
* **\`initialDynamicState\` (初始動態狀態)**: 定義了地點的**可變屬性**，這些是玩家未來可以透過行動來影響的。

---

## 【JSON 檔案結構範本】
你的輸出必須是一個**單一的、沒有任何額外文字或標記**的 JSON 物件，並嚴格遵循此結構。

\`\`\`json
{
  "locationHierarchy": [
    {
      "locationName": "豐城縣",
      "staticTemplate": {
        "locationId": "豐城縣",
        "locationName": "豐城縣",
        "parentLocation": "洪州",
        "locationType": "縣城",
        "address": {
          "country": "大宋",
          "region": "江南西路",
          "city": "洪州",
          "district": "豐城縣"
        },
        "geography": { 
            "terrain": "平原與丘陵交錯",
            "nearbyLocations": [
                { "name": "豫章鎮", "travelTime": "半日" }
            ]
        },
        "economy": { "prosperityPotential": "殷實", "specialty": ["稻米", "瓷器"] },
        "lore": { "history": "自前朝便已存在的古縣，因瓷器貿易而興盛。" }
      },
      "initialDynamicState": {
        "governance": { "ruler": "縣令王之渙", "allegiance": "大宋朝廷", "security": "一隊縣衙捕快與巡邏官兵" },
        "economy": { "currentProsperity": "繁榮" },
        "lore": { "currentIssues": ["城中最大的瓷器商『蘇氏瓷行』似乎正與官府有所勾結。"] }
      }
    },
    {
      "locationName": "無名村",
      "staticTemplate": {
        "locationId": "無名村",
        "locationName": "無名村",
        "parentLocation": "豐城縣",
        "locationType": "村莊",
        "address": {
          "country": "大宋",
          "region": "江南西路",
          "city": "洪州",
          "district": "豐城縣",
          "town": "無名村"
        },
        "geography": { 
            "terrain": "位於丘陵地帶的小平原", 
            "nearbyLocations": [
                { "name": "黑風寨", "travelTime": "半個時辰" }
            ] 
        },
        "economy": { "prosperityPotential": "普通", "specialty": ["翠竹", "草藥"] },
        "lore": { "history": "一個有著數百年歷史的古老村莊，據說祖上是為了躲避戰亂而遷徙至此。" }
      },
      "initialDynamicState": {
        "governance": { "ruler": "村長李大山", "allegiance": "無名村自治", "security": "由幾位年輕村民組成的鄉勇隊，裝備簡陋。" },
        "economy": { "currentProsperity": "普通" },
        "facilities": [
          { "name": "葉家鐵鋪", "type": "鐵匠鋪", "owner": "葉繼安", "status": "營業中" },
          { "name": "王大夫藥鋪", "type": "藥鋪", "owner": "王大夫", "status": "營業中" }
        ],
        "buildings": [],
        "lore": { "currentIssues": ["近來常有黑風寨的山賊下山騷擾，村民對此憂心忡忡。"] }
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
