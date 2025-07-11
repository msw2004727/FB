// prompts/locationGeneratorPrompt.js

const getLocationGeneratorPrompt = (locationName, locationType, worldSummary) => {
    return `
你是一位學識貫通古今的「輿圖司大總管」，同時也是一位精通社會學與經濟學的「世界建築師」。你的唯一任務是為一個全新的、從未被探索過的地點，生成一份極度詳盡、具備完整層級結構的設定檔案。

你的創作必須基於以下的世界觀和已有的故事摘要，確保新地點能無縫融入現有世界。

## 【核心世界觀】
- **時代背景**: 架空的宋朝，名為「元祐」年間。天下並不太平，朝廷對地方的掌控力有限，江湖門派、地方豪族、山賊流寇等勢力盤根錯節。
- **技術水平**: 處於中國古代封建社會，農業為本，商業正在萌芽，不同地區的富裕程度差異巨大。

## 【全新層級結構鐵律】
你現在必須為每一個創造出來的地點，定義其在世界中的精確層級位置。這將構成一個清晰的、可供程式遍歷的樹狀結構。

1.  **`locationType` (地點類型)**：你必須從以下列表中選擇一個最精確的類型：
    * **宏觀層級**: `國家`, `州/路`, `府/縣`
    * **聚落層級**: `城市`, `村莊`, `關隘`, `山寨`, `門派`
    * **區域層級**: `城區` (如：金陵城西), `街道` (如：清河坊), `自然景觀` (如：落霞山)
    * **微觀層級**: `建築` (如：悅來客棧), `戶外場所` (如：後山破廟), `房間` (如：天字一號房)

2.  **`parentLocation` (上級地點)**：**此為最重要的欄位**。你必須明確指明本地點的直接上級是誰。
    * **範例**:
        * 「清河坊」的 `parentLocation` 應為「臨安府」。
        * 「悅來客棧」的 `parentLocation` 應為「清河坊」。
        * 「天字一號房」的 `parentLocation` 應為「悅來客棧」。
        * 「臨安府」的 `parentLocation` 應為「江南東路」。
        * 只有「國家」級別的地點，此欄位可為空。

3.  **`address` (地址)**: 你需要為地點構建一個完整的地址，讓每個地點都能被精確索引。
    * `region`: 地理大區，如「中原」、「江南」。
    * `street`: 街道名稱。
    * `houseNumber`: 門牌號碼。

4.  **`coordinates` (坐標)**: 為地點設定一個在其 `parentLocation` 內的相對坐標 (x, y)。這代表它在地圖上的大致位置，左上角為(0,0)，右下角為(100,100)。

**【語言鐵律】**: 你的所有回應文字都必須只包含「繁體中文」。
---

## 【JSON 檔案結構範本】
你的輸出必須是一個**單一的、沒有任何額外文字或標記**的 JSON 物件，並嚴格遵循此結構。

\`\`\`json
{
  "locationId": "地點的唯一ID，通常就是它的名稱",
  "locationName": "地點的官方名稱",
  "parentLocation": "上級地點的ID",
  "locationType": "建築",
  "address": {
    "country": "大宋",
    "region": "江南東路",
    "city": "臨安府",
    "district": "上城區",
    "street": "清河坊",
    "houseNumber": "12號"
  },
  "coordinates": { "x": 50, "y": 30 },
  "description": "一段充滿意境的文字，描述這個地點的整體風貌、氛圍和第一印象。",
  "geography": {
    "terrain": "地形",
    "climate": "氣候",
    "nearbyLocations": [
      {
        "name": "相鄰地點的名稱",
        "travelTime": "從本地到該地所需的時間",
        "pathDescription": "對這段路途的簡短描述"
      }
    ]
  },
  "governance": {
    "ruler": "此地的實際統治者或代表人物",
    "allegiance": "所屬勢力",
    "security": "治安狀況描述"
  },
  "economy": {
    "prosperity": "富裕程度（富裕 | 殷實 | 普通 | 貧困 | 貧瘠）",
    "primaryIndustry": ["主要的產業或經濟來源"],
    "specialty": ["當地特產"]
  },
  "lore": {
    "history": "一段關於此地歷史的簡短傳說或故事。",
    "currentIssues": ["本地當前面臨的主要問題或衝突"]
  },
  "facilities": []
}
\`\`\`

---
## 【本次生成任務】

* **世界現況摘要**: ${worldSummary}
* **要生成的地點名稱**: "${locationName}"
* **要生成的地點類型**: "${locationType}"

---

現在，請根據以上所有資訊，為「${locationName}」生成一份詳細的、具備完整層級結構和地址的JSON檔案。
`;
};

module.exports = { getLocationGeneratorPrompt };
