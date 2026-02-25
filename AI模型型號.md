# AI模型型號

最後同步時間：2026-02-25（依目前程式碼實際生效設定）

## AI核心（玩家下拉選單）

預設核心：`openai`（UI 顯示 `GPT-5.2`）

| AI核心選單值 | UI顯示名稱 | 實際模型 | 供應商 |
| --- | --- | --- | --- |
| `openai` | GPT-5.2 | `gpt-5.2` | OpenAI |
| `gemini` | Gemini 3.1 | `gemini-3.1` | Google |
| `deepseek` | DeepSeek-V3.2 | `deepseek-v3.2` | DeepSeek |
| `grok` | Grok-4.20 | `grok-4.20` | xAI |
| `claude` | Claude-Sonnet-4.6 | `claude-sonnet-4.6` | Anthropic |

## 相容別名（非UI選單）

| 輸入值 | 實際模型 | 說明 |
| --- | --- | --- |
| `gpt5.2` | `gpt-5.2` | 後端內部可用別名 |
| `cluade` | `claude-sonnet-4.6` | 舊 typo 相容別名（仍可被後端辨識） |

## 失敗回退機制

- 非預設模型（例如 `grok` / `gemini` / `deepseek` / `claude`）呼叫失敗時，後端會自動重試預設 GPT 路徑：`openai -> gpt-5.2`
- 前端若仍收到 AI 模型錯誤，會將 AI核心選單重設回預設 `GPT-5.2`

## 其他（目前與 AI核心選單無關）

- NPC 生圖固定使用 OpenAI Images：`dall-e-3`（`quality: "hd"`, `style: "vivid"`）

## 參考程式位置

- `index.html`（AI核心下拉選單）
- `services/aiService.js`（模型路由與 fallback）
- `scripts/aiModelPreference.js`（AI核心偏好記憶與 alias 正規化）
- `scripts/uiUpdater.js`（AI錯誤時前端重設預設核心）
