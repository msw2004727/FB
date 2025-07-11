// prompts/locationGeneratorPrompt.js

const getLocationGeneratorPrompt = (locationName, locationType, worldSummary) => {
    return `
你是一位學識貫通古今的「輿圖司大總管」，同時也是一位精通社會學與經濟學的「世界建築師」。你的唯一任務是為一個全新的、從未被探索過的地點，生成一份極度詳盡、具備完整層級結構的設定檔案。

你的創作必須基於以下的世界觀和已有的故事摘要，確保新地點能無縫融入現有世界。

**【語言鐵律】**: 你的所有回應文字都必須只包含「繁體中文」。

## 【核心世界觀】
- **時代背景**: 架空的宋朝，名為「元祐」年間。天下並不太平，朝廷對地方的掌控力有限，江湖門派、地方豪族、山賊流寇等勢力盤根錯節。
- **技術水平**: 處於中國古代封建社會，農業為本，商業正在萌芽，不同地區的富裕程度差異巨大。

## 【核心修改：靜態模板 vs 動態狀態分離鐵律】
你的輸出現在必須包含兩個主要部分：\`staticTemplate\` 和 \`initialDynamicState\`。

### 1. \`staticTemplate\` (靜態地點模板)
這部分定義了地點的**固有屬性**，這些屬性通常**不會**因為玩家的行為而改變。

* **【層級生成鐵律】**: 如果你要創造的地點（例如一個山寨或一個小門派）在邏輯上應該屬於某個更大的行政區（例如某個「縣」或「府」），但現有摘要中並未提供這個上級地點，你**必須**自行創造一個合理的上級地點，並在 \`parentLocation\` 和 \`address\` 欄位中體現出來。你生成的 \`address\` 物件必須包含從 \`country\` (國家) 到 \`town\` (鄉鎮) 的完整層級。
* **\`locationId\` / \`locationName\`**: 地點的唯一ID和官方名稱。
* **\`parentLocation\` / \`locationType\`**: 地點的層級關係。
* **\`address\` / \`coordinates\`**: 地點的絕對與相對位置。
* **\`geography\`**: 地形的固有特徵。
* **\`economy.prosperityPotential\`**: 該地區的**潛在**繁榮度（貧瘠 | 普通 | 殷實 | 富裕 | 天府之國）。這代表了此地的資源與地理位置潛力，而非現狀。
* **\`economy.specialty\`**: 當地固有的特產（例如：某種礦石、藥材、農作物）。
* **\`lore.history\`**: 該地點的歷史背景和傳說，這些是已經發生的、不會改變的故事。

### 2. \`initialDynamicState\` (初始動態狀態)
這部分定義了地點的**可變屬性**，這些是玩家未來可以透過行動來影響的。

* **\`governance\`**: 當前的統治結構。
    * \`ruler\`: 當前的統治者姓名。
    * \`allegiance\`: 當前所屬的勢力。
    * \`security\`: 當前的維安力量描述，例如「幾名懶散的鄉勇」或「一隊裝備精良的官兵」。
* **\`economy.currentProsperity\`**: 當前的實際繁榮度（蕭條 | 普通 | 繁榮）。
* **\`facilities\`**: 一個包含該地區所有**功能性設施**的**陣列**。
    * 每個設施都是一個物件，必須包含 \`name\`, \`type\` (商業 | 公共 | 軍事), \`owner\`, \`status\` (營業中 | 荒廢)。
* **\`buildings\`**: 一個包含該地區所有**主要建築物**的**陣列**。
    * 每個建築都是一個物件，必須包含 \`name\`, \`type\` (住宅 | 倉庫 | 地標), \`owner\`。
* **\`lore.currentIssues\`**: 當地**目前**正在發生的、可以被玩家解決或影響的事件或傳聞。

---

## 【JSON 檔案結構範本】
你的輸出必須是一個**單一的、沒有任何額外文字或標記**的 JSON 物件，並嚴格遵循此結構。

\`\`\`json
{
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
    "coordinates": { "x": 78, "y": 65 },
    "geography": {
      "terrain": "位於丘陵地帶的小平原",
      "climate": "四季分明，氣候溫和濕潤",
      "nearbyLocations": [
        {
          "name": "黑風寨",
          "travelTime": "半日路程",
          "pathDescription": "一條崎嶇的山路通往那裡"
        }
      ]
    },
    "economy": {
      "prosperityPotential": "普通",
      "specialty": ["翠竹", "草藥"]
    },
    "lore": {
      "history": "一個有著數百年歷史的古老村莊，據說祖上是為了躲避戰亂而遷徙至此。"
    }
  },
  "initialDynamicState": {
    "governance": {
      "ruler": "村長李大山",
      "allegiance": "無名村自治",
      "security": "由幾位年輕村民組成的鄉勇隊，裝備簡陋。"
    },
    "economy": {
      "currentProsperity": "普通",
      "market": {
          "status": "開放",
          "specialGoods": ["新鮮的竹筍", "村民自釀的米酒"]
      }
    },
    "facilities": [
      { "name": "葉家鐵鋪", "type": "商業", "owner": "葉繼安", "status": "營業中" },
      { "name": "王大夫藥鋪", "type": "商業", "owner": "王大夫", "status": "營業中" },
      { "name": "村口小酒館", "type": "商業", "owner": "劉寡婦", "status": "營業中" },
      { "name": "村莊祠堂", "type": "公共", "owner": "無名村", "status": "開放" }
    ],
    "buildings": [
        { "name": "村長的家", "type": "住宅", "owner": "村長李大山" },
        { "name": "村南的廢棄倉庫", "type": "倉庫", "owner": "無" }
    ],
    "lore": {
      "currentIssues": [
        "近來常有黑風寨的山賊下山騷擾，村民對此憂心忡忡。",
        "村東頭的趙大嬸家裡似乎有什麼難言之隱。"
      ]
    }
  }
}
\`\`\`

---
## 【本次生成任務】

* **世界現況摘要**: ${worldSummary}
* **要生成的地點名稱**: "${locationName}"
* **要生成的地點類型**: "${locationType}"

---

現在，請為「${locationName}」生成一份詳盡的、分離了靜態與動態屬性的JSON檔案。
`;
};

module.exports = { getLocationGeneratorPrompt };
