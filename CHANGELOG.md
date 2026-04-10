# AI 文江 — 更新日誌

## 2026-04-10 大改版

### 架構遷移：Firebase → PWA 本機化
- 完全移除 Firebase Firestore 雲端資料庫（每月費用 → $0）
- 遊戲資料改存瀏覽器 IndexedDB（6 個 Store：profiles, game_saves, locations, location_states, novel_chapters, game_state）
- 新建 `client/` 目錄：本機遊戲引擎（gameEngine.js, stateManager.js, contextBuilder.js）
- 新建 AI Proxy 伺服器（`ai-proxy/`）：輕量 Node.js 轉發，保護 API Key
- 新增 PWA 支援：manifest.json + Service Worker，可安裝到手機/桌面
- 新增存檔匯出/匯入功能（JSON 檔案備份）

### AI 模型
- 新增 MiniMax M2.7 模型支援（設為預設）
- 修復 MiniMax `<think>` 標籤清理（回應前自動移除思考過程）
- 支援玩家自行填入其他模型 API Key（OpenAI/Gemini/Claude/DeepSeek/Grok）
- 所有模型失敗時自動 Fallback

### MemPalace AI 記憶系統（全 4 Phase 完成）
- Phase 0: 中文語意搜尋測試通過（83.3% 準確率）
- Phase 1: 每回合自動寫入記憶（故事全文 + NPC 互動 + 事件標題）
- Phase 2: AI 生成故事前自動搜尋相關歷史記憶，注入 prompt
- Phase 3: SQLite 知識圖譜 — NPC 位置/關係/狀態追蹤
- 降級機制：MemPalace 不可用時遊戲正常運作

### UI 大幅精簡
移除的功能（預留未來改版）：
- 氛圍 (ATM)、隨身物品 (Inventory)、負重 (Bulk)
- 人物見聞 (Encyclopedia)、任務日誌 (QST)
- 內心獨白 (PSY)、關鍵線索 (CLS)
- 懸賞告示板 (Bounties)、世界地圖 (Map)
- 武學總覽 (Skills)、閉關修煉系統
- 人物關係圖 (Relations)、故事回顧 (Novel)
- NPC 互動系統（名字點擊、頭像、交易、對話、戰鬥）
- 內功/外功/輕功/精力數據條
- NPC 列表

保留的 UI：
- 角色狀態（14→30 字文字欄）
- 立場傾向（善惡條）
- 當前地區
- AI 核心選擇（含 API Key 設定）
- 書僮建議
- 行動選項按鈕（3 選 1 + 每 5 回合自由輸入）

### 新增功能
- 說明按鈕（綠色 ? 圓形按鈕）：收折式功能說明彈窗
- 存檔按鈕組：儲存、匯出、載入
- PWA 安裝提示橫幅
- 開局故事：穿越 + 紙條任務「尋找回家的方法」
- 行動選項系統：AI 每回合提供 3 個選項，每 5 回合可自由輸入

### AI 風格調整
- 敘事風格改為幽默風趣、機智詼諧（v3.0）
- 強制繁體中文（所有欄位，最高優先級）
- NPC 對話要有個性（吐槽、耍嘴皮、冷幽默）
- 禁止流水帳和過度嚴肅

### 部署
- AI Proxy 部署到 Vercel（https://ai-proxy-cyan.vercel.app）
- 前端可透過 GitHub Pages 分享（https://msw2004727.github.io/FB/）
- 148 個舊檔案封存至 `_archive/`

### 程式碼精簡
- 刪除 ~3,000+ 行廢棄程式碼
- IndexedDB Store 從 13 個縮減為 6 個
- 前端 JS 從 24 個模組縮減為 10 個
- CSS 從 16 個縮減為 7 個
- 活躍程式碼量大幅減少，維護性提升
