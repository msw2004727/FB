# Claude Memory — AI 文江開發日誌

> 此檔案記錄 AI 文江專案的重大變更歷程，供 Claude 在未來對話中快速理解專案演進脈絡。

---

## 2026-04-10 — 大改版：Firebase → PWA 本機化

### 架構遷移
- 完全移除 Firebase Firestore 雲端資料庫（每月費用 → $0）
- 遊戲資料改存瀏覽器 IndexedDB（6 個 Store：profiles, game_saves, locations, location_states, novel_chapters, game_state）
- 新建 `client/` 目錄：本機遊戲引擎（gameEngine.js, stateManager.js, contextBuilder.js）
- 新建 AI Proxy 伺服器（`ai-proxy/`）：輕量 Node.js 轉發，保護 API Key
- 新增 PWA 支援：manifest.json + Service Worker，可安裝到手機/桌面
- 新增存檔匯出/匯入功能（JSON 檔案備份）
- 148 個舊檔案封存至 `_archive/`

### AI 模型
- 新增 MiniMax M2.7 模型支援（設為預設，內建金鑰）
- 修復 MiniMax `<think>` 標籤清理（回應前自動移除思考過程）
- 支援玩家自行填入其他模型 API Key（OpenAI/Gemini/Claude/DeepSeek/Grok）
- 所有模型失敗時自動 Fallback 回 MiniMax

### MemPalace AI 記憶系統（全 4 Phase 完成）
- Phase 0: 中文語意搜尋測試通過（83.3% 準確率）
- Phase 1: 每回合自動寫入記憶（故事全文 + NPC 互動 + 事件標題）
- Phase 2: AI 生成故事前自動搜尋相關歷史記憶，注入 prompt
- Phase 3: SQLite 知識圖譜 — NPC 位置/關係/狀態追蹤
- 降級機制：MemPalace 不可用時遊戲正常運作

### 主線進度系統（8 線索里程碑）
- 廢棄百分比制，改用 8 個敘事里程碑（M1~M8）
- 進度隱藏，僅通過故事線索讓玩家自然感知
- 進度判定獨立於故事生成（獨立 progress-evaluator task）
- 里程碑順序：異世界認知 → 第一條線索 → 關鍵人物 → 古老知識 → 重大阻礙 → 關鍵突破 → 最終準備 → 歸途
- 「回家」是可選結局之一，非唯一目標
- 新增「旅程」面板（回合數 + AI 自動更新的任務日誌）

### UI 大幅精簡
**移除的功能（預留未來改版）：**
- 氛圍 (ATM)、隨身物品 (Inventory)、負重 (Bulk)
- 人物見聞 (Encyclopedia)、任務日誌 (QST)
- 內心獨白 (PSY)、關鍵線索 (CLS)
- 懸賞告示板 (Bounties)、世界地圖 (Map)
- 武學總覽 (Skills)、閉關修煉系統
- 人物關係圖 (Relations)、故事回顧 (Novel)
- NPC 互動系統（名字點擊、頭像、交易、對話、戰鬥）
- 內功/外功/輕功/精力數據條、NPC 列表
- 當前地區欄位（統治者、地區描述、詳情按鈕）

**保留的 UI：**
- 角色狀態（30 字文字欄）、立場傾向（善惡條）
- 旅程（回合數 + 任務日誌）
- AI 核心選擇（含 API Key 設定）
- 書僮建議、行動選項按鈕（3 選 1 + 每 5 回合自由輸入）

### 新增功能
- 說明按鈕（綠色 ? 圓形按鈕）：收折式功能說明彈窗
- 存檔按鈕組：儲存、匯出、載入
- PWA 安裝提示橫幅（含 iOS Safari 說明）
- 開局故事：穿越醒來 + 紙條「任務：尋找回家的方法」（懸疑+搞笑風格）
- 行動選項系統：AI 每回合提供 3 個選項，每 5 回合可自由輸入
- 輸入框提示改為「在此輸入文字即可」

### AI 風格調整
- 敘事風格改為幽默風趣、機智詼諧（v3.0）
- 強制繁體中文（所有欄位，最高優先級）
- NPC 對話要有個性（吐槽、耍嘴皮、冷幽默）
- 禁止流水帳和過度嚴肅
- 世界觀新增穿越者紙條設定

### 死亡/結局系統修復
- 修復 epiloguePrompt.js — 移除對已刪除資料的依賴
- 修復 deathCausePrompt.js — 移除對已刪除的 ATM/PSY 依賴
- 死因風格改為幽默中帶點荒謬
- 死亡畫面改版：直接顯示 AI 生成的 500 字結局 + 只有「重新開始」按鈕
- 移除「查看結局」和「回顧生平」按鈕
- 修復重新開始的 username 唯一索引衝突
- 找不到存檔時自動建立新的 R0

### 部署
- AI Proxy 部署到 Vercel（https://ai-proxy-cyan.vercel.app）
- AI Proxy 同時部署到 Google Cloud Run（asia-east2）
- 前端透過 GitHub Pages 分享（https://msw2004727.github.io/FB/）

### 程式碼精簡
- 刪除 ~4,000+ 行廢棄程式碼
- IndexedDB Store 從 13 個縮減為 6 個
- 前端 JS 從 24 個模組縮減為 10 個
- CSS 從 16 個縮減為 7 個
- 移除 gameLoop.js 廢棄的 inventory/NPC 同步程式碼
- 移除 updateLocationInfo、updateNpcList 函式
- 活躍程式碼量約 6,700 行

---

## 決策紀錄

| 日期 | 決策 | 原因 |
|------|------|------|
| 2026-04-10 | 從 Firebase 遷移到 IndexedDB | 降低營運成本至 $0，離線優先 |
| 2026-04-10 | 選擇 MiniMax M2.7 為預設模型 | 中文理解力強、性價比高、可內建 Key |
| 2026-04-10 | 進度系統改為 8 里程碑制 | 百分比制太機械，里程碑更符合敘事體驗 |
| 2026-04-10 | 大幅移除 UI 功能 | 精簡為核心體驗，減少維護負擔 |
| 2026-04-10 | MemPalace 設計為可選 | 確保核心遊戲不依賴外部服務 |

---

## 待辦 / 未來方向

- 被移除的 UI 功能可能在未來改版中逐步重新加入
- MemPalace 知識圖譜可持續擴展（NPC 記憶、地點歷史）
- `skills.css`、`trade.css` 等 CSS 保留供未來功能使用
- `gameLoop.js` 中的亂碼註解需清理（編碼歷史問題）
