# P0/P1 上線與營運手冊

更新日期：2026-08-11

## 正式架構

- 前端：GitHub Pages `https://msw2004727.github.io/FB/`
- 唯一 AI Proxy：Cloud Run `wenjiang-ai-proxy`，區域 `us-central1`
- 預設模型：MiniMax；其他模型一律由玩家提供短期 BYOK
- 玩家資料：瀏覽器 IndexedDB；正式後端不保存遊戲資料
- MemPalace、舊 `asia-east2` proxy、舊 Vercel proxy：不在正式流量路徑

## 已完成的 P0

- `/ai` 前置 Origin allowlist、可信代理鏈、PoW 匿名 session、IP/session 加權限流。
- 限制 JSON/context 大小、深度、節點、任務、模型、欄位與 AI 併發。
- 站方付費流量具 instance 小時／日熔斷；BYOK 不可消耗站方預算計數。
- 圖片生成預設 404 停用；MemPalace 預設 fail-closed。
- BYOK 只存在記憶體與 `sessionStorage`；清理舊 localStorage Key 與假 VIP bypass。
- CSP、HSTS、nosniff、frame、referrer 與 permissions headers；動態故事/存檔/GM 字串不使用 `innerHTML`。
- IndexedDB 升級不再刪除舊 store；回合、小說、玩家狀態與進度採同一 transaction；重開遊戲的清空與 R0 建立也為同一 transaction。
- GitHub Pages 僅發布 40 個明確檔案，不發布 `_archive`、後端、測試、文件或 secrets。

## 已完成的 P1

- 普通故事回合由 4 次模型請求降為 1 次：正文、選項、善惡值、建議、里程碑判定共用一份結構化回應。
- MiniMax 使用 SSE；首段正文到達即顯示，同時保持輸入鎖直到資料完整提交。
- 玩家離頁時取消上游請求；AI timeout/retry/token 上限均有界。
- 摘要改成每 5 回合或重要事件觸發，批次處理未摘要回合，並有 revision 與 Web Lock 防止舊摘要覆蓋。
- 死亡回合不再產生摘要；結局沿用玩家當時選擇的模型，依死亡回合快取並以 Web Lock 去重，避免重整或多分頁重複付費。
- 模型輸出的 NPC、日期推進與死亡狀態會在前後端雙重正規化；極端數字、空 NPC 與死後排隊動作不會卡死或污染存檔。
- 固定 prompt 規則移到動態內容前，以提高 MiniMax prefix cache 命中機會；記錄 TTFT、總耗時、token、cache 與 reasoning telemetry。
- MiniMax M2.x/M3 不傳送僅 MiniMax-Text-01 支援的 `response_format`；JSON 由固定契約、解析與 schema 正規化保證。
- 供應商額度耗盡（HTTP 429／MiniMax 1008、2056，包含 HTTP 200 的 `base_resp` 錯誤）統一轉成安全的 `503 PROVIDER_QUOTA_EXHAUSTED`；JSON 與 SSE 行為一致、不洩漏供應商原文、不自動改用其他站方付費模型，前端改提示 BYOK 且不顯示無效重試按鈕。
- 圖示與 Pages artifact 縮小；Service Worker 僅管理本 App cache，navigation 採 network-first 並可離線回退。

## Production 必要設定

秘密必須由 Secret Manager 掛載，不可放在 Git、Docker image 或一般環境變數明文中。

```text
NODE_ENV=production
CORS_ORIGINS=https://msw2004727.github.io
TRUST_PROXY_HOPS=2
REQUIRE_ANON_SESSION=true
ANON_SESSION_SECRET=<Secret Manager reference, at least 32 random characters>
SESSION_POW_DIFFICULTY=14
SERVER_KEY_MODELS=minimax
ENABLE_IMAGE_GENERATION=false
MEMPALACE_ENABLED=false
MAX_CONCURRENT_AI_REQUESTS=4
AI_MAX_RETRIES=0
RATE_LIMIT_SESSION_POINTS=24
RATE_LIMIT_IP_POINTS=48
INSTANCE_MAX_REQUESTS_PER_HOUR=300
INSTANCE_MAX_REQUESTS_PER_DAY=3000
INSTANCE_MAX_ESTIMATED_USD_PER_HOUR=5
INSTANCE_MAX_ESTIMATED_USD_PER_DAY=25
MINIMAX_API_KEY=<Secret Manager reference>
```

Cloud Run 平台限制：`min-instances=0`、`max-instances=1`、`concurrency=4`、`timeout=60s`。升到多 instance 前，必須先完成耐久化全域 quota。

首次由 v0.26 升級時必須先發布 Pages，再發布 Cloud Run。舊版頁面沒有新版 Service Worker 交握，採用窗口內先以 `REQUIRE_ANON_SESSION=false` 過渡；確認新版前端已自然或人工重新載入後才切成 `true`。仍開著的 v0.26 分頁不會自行顯示新版提示，若過早切成 strict 會收到 401。v0.27 之後會等待付費請求與未送出輸入結束，再安全刷新，不會強制中斷。

## 2026-08-11 正式環境狀態

- GitHub Pages v0.27 與 `us-central1` Cloud Run 已發布；Cloud Run 使用 Secret Manager、`max-instances=1`、`concurrency=4`，MemPalace／圖片生成均停用。
- 相容窗口目前刻意維持 `REQUIRE_ANON_SESSION=false`。只有在新版前端採用窗口完成且真實 MiniMax JSON + SSE canary 成功後，才可切為 `true`。
- 正式 MiniMax canary 目前被供應商帳戶的 Token Plan／Credits 額度耗盡（上游 429、code 2056）阻擋。必須先在 MiniMax 後台補充額度或升級方案並輪替金鑰，再重跑 canary；在成功前不得把本版本標成完整營運就緒。串流端也會在交給 SDK 前檢查原始 Content-Type，避免把 HTTP 200 JSON 錯誤誤當成空串流成功。
- 程式已對上述配額錯誤 fail-safe：回傳非重試 503 與 BYOK 指引，不 fallback 到另一個站方付費模型。

## 發布 Gate

1. 乾淨 `npm ci --ignore-scripts` 成功。
2. `npm test` 全綠，production `npm audit` 為 0。
3. 所有 JavaScript syntax、JSON、Actions YAML、Pages allowlist 與 `git diff --check` 通過。
4. PR 的 test/audit/container build 與 Pages quality workflow 全綠後才可合併。
5. 正式 Pages 實機驗證桌面、390px 手機、IndexedDB 新局/續玩及離線啟動；確認新版 Service Worker 已發布後才收緊後端 session。
6. Cloud Run canary 必須驗證：health、CORS、安全 headers、無 session 401、PoW session、圖片 404、JSON 成功、SSE `story_delta` + `result`、一次 story 只有一次 provider call。若供應商回配額錯誤，必須先確認安全 503 契約，再補足額度完成成功 canary，不能以失敗 canary 取代發布 Gate。

## 無法只靠程式碼封頂的風險

- instance limiter/budget 在冷啟動、新 revision 後會重置；`max-instances=1` 限制倍率，但不能取代供應商硬額度。
- 必須在 MiniMax 後台輪替既有 Key，設定每日／每月硬額度；GCP Billing 設 budget alerts。若帳戶權限不足，這是仍需人工完成的營運阻斷項。
- PoW session 不是登入身份，仍可被自動化；若日後開放較高免費額度，需改成耐久化的全域 quota/identity。
- 任何舊 Vercel 或 Cloud Run proxy 若仍公開，會繞過新版防線，必須停用公開存取。

## 回滾

- 前端：在 GitHub 對合併 commit 執行 revert；Pages workflow 會重新發布前一版。
- 後端：將 Cloud Run traffic 切回上一個已驗證 revision；不要重新開放舊跨區 proxy。
- 若出現費用或濫用異常：先撤銷 Cloud Run 公開 invoker，再處理 provider Key 與 hard quota。
