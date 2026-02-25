# Work Log

## 2026-02-25

### Task: UI safety and sidebar interaction hardening (completed)
- Created this work log for ongoing session summaries.
- Planned fixes (by priority): reduce `innerHTML` injection risk in UI rendering, then tighten mobile sidebar auto-close behavior.
- Hardened multiple UI render paths in `scripts/uiUpdater.js` by escaping/sanitizing dynamic values before `innerHTML` insertion (location info, NPC list, inventory item entries), and escaped story text before NPC name highlighting.
- Replaced random event banner string injection with DOM text nodes to avoid raw HTML insertion.
- Added NPC friendliness class whitelist normalization to prevent class injection / broken styles from unexpected values.
- Fixed mobile sidebar auto-close behavior in `scripts/main.js` so it only closes on background/overlay clicks (`e.target === main-content`) instead of any click inside main content.

### Task: Add persistent work-log rule to AGENTS (completed)
- Created root `AGENTS.md` because it did not exist in the repository.
- Added a project rule requiring every work session to update `WORKLOG.md` before finishing the task response.

### Task: Finish remaining UI review fixes (items 1/2/3) (completed)
- Hardened `appendMessageToStory()` to render plain text safely by default and only allow HTML when explicitly requested (`{ allowHtml: true }`), then updated story rendering to opt in.
- Removed HTML string wrappers from selected call sites (`gameLoop.js`, `interactionHandlers.js`) so error/system messages now use safe text + newline rendering.
- Added right sidebar `menu-toggle` accessibility/state sync (`aria-expanded`, labels/titles) and icon swap (`bars` / `xmark`) in `scripts/main.js`.
- Added overflow protection for current-location ruler label pill (`.location-ruler`) and updated markup to use a dedicated `.location-ruler-label`.
- Remaining note: other non-`appendMessageToStory` `innerHTML` paths still exist in the codebase (outside this targeted fix pass).

### Task: Review PC status numeric update logic (inspection)
- Traced the full PC numeric update path across backend (`api/gameplay/stateUpdaters.js`) and frontend (`scripts/gameLoop.js`, `scripts/uiUpdater.js`).
- Confirmed the client receives merged final profile values (`finalPlayerProfile`) plus per-round deltas (`powerChange`, `moralityChange`), so `processNewRoundData()` currently performs a redundant pre-merge manual `+=` step before `Object.assign`.
- Identified numeric type-safety risk in backend power updates: `powerChange.*` is not normalized to numbers before arithmetic, so string values from AI JSON could cause string concatenation in stored `internalPower` / `externalPower` / `lightness`.
- Identified UI boundary issues in PC bars: `updatePowerBar()` clamps only the upper bound (negative values can produce negative width) and `updateMoralityBar()` does not clamp indicator position, so morality outside `[-100, 100]` can push the indicator outside the track.
- Next step option: normalize `powerChange` on the backend and simplify/remove redundant client-side delta application in `processNewRoundData()`.

### Task: Fix PC status numeric update logic issues (completed)
- Backend: added numeric normalization helpers in `api/gameplay/stateUpdaters.js` and applied them to `powerChange` / `moralityChange` before saving round data and updating player profile aggregates.
- Frontend: removed the redundant manual application of `powerChange` / `moralityChange` / `stamina` in `scripts/gameLoop.js` so `processNewRoundData()` now relies on the final `roundData` returned by the backend (`Object.assign` step).
- UI safety: clamped PC power-bar widths to `0~100%` and clamped morality indicator position to `0~100%` in `scripts/uiUpdater.js`; also normalized non-numeric values to `0` for display.
- Validation: `node --check` passed for `api/gameplay/stateUpdaters.js`, `scripts/gameLoop.js`, and `scripts/uiUpdater.js`.

### Task: Add non-negative guard for PC power stats (completed)
- Hardened backend final stat updates in `api/gameplay/stateUpdaters.js` so `internalPower`, `externalPower`, and `lightness` are clamped to a minimum of `0` before writing to the user profile.
- This prevents malformed/overly-negative AI deltas from pushing PC power stats into negative values.
- Validation: `node --check api/gameplay/stateUpdaters.js` passed.

### Task: Add upper-bound guard for PC power stats (completed)
- Added backend power-stat upper bound protection in `api/gameplay/stateUpdaters.js` using a shared local clamp helper and `PLAYER_POWER_MAX = 999` (aligned with current frontend `MAX_POWER` display baseline).
- Final persisted `internalPower`, `externalPower`, and `lightness` are now clamped to `0~999` before DB updates.
- Validation: `node --check api/gameplay/stateUpdaters.js` passed.

### Task: Share MAX_POWER config between frontend and backend (completed)
- Added `shared/gameConstants.mjs` as a single source of truth for shared gameplay constants (`MAX_POWER`).
- Updated frontend `scripts/config.js` to import `MAX_POWER` from the shared module instead of hardcoding it locally.
- Updated backend `api/gameplay/stateUpdaters.js` to load shared `MAX_POWER` via cached dynamic import (CJS-safe) and use it for server-side power clamps, with a fallback `999` if import fails.
- Validation: `node --check api/gameplay/stateUpdaters.js`, `node --check scripts/config.js`, and `node --check shared/gameConstants.mjs` passed.

### Task: Explain turn-loading runtime flow and latency sources (inspection)
- Traced the end-to-end path from frontend submit (`scripts/gameLoop.js`) to backend `/api/game/play/interact`, including route wrapper, pre-action checks, context building, main action handling, save/update pipeline, and final UI rendering.
- Confirmed normal turns currently include multiple serial AI calls: main story generation (`getAIStory`), long-term summary update (`getAISummary` inside `updateGameState`), and suggestion generation (`getAISuggestion`).
- Noted additional synchronous (awaited) Firestore/IO steps before response: context builder reads, round save + batch commit, cache invalidation, library novel update, and final inventory/location fetches.
- Identified remote backend factor: frontend is configured to call `https://ai-novel-final.onrender.com`, so user-perceived latency also includes browser->Render and backend->AI provider network time (plus possible Render cold starts).

### Task: Diagnose refresh stuck on "Ê≠£Âú®ÈÄ£Êé•‰Ω†ÁöÑ‰∏ñÁïåÔºåËÆÄÂèñË®òÊÜ∂‰∏≠..." (inspection)
- Verified local preview page is serving correctly (`http://127.0.0.1:5500/index.html` returned HTTP 200).
- Verified remote backend is reachable (unauthenticated `GET /api/game/state/latest-game` returned HTTP 401 quickly), so the service is not globally down.
- Traced frontend refresh loading path (`loadInitialGame()` -> `api.getLatestGame()`), then inspected `/api/game/state/latest-game` and confirmed it awaits two AI calls before responding: `getAIPrequel(...)` and `getAISuggestion(...)` via `Promise.all`.
- Likely cause of refresh spinner hangs: authenticated `latest-game` request is blocked waiting on one of those AI calls (or downstream provider latency), with no explicit client/server timeout fallback for the initial-load route.

### Task: Speed up refresh by removing AI dependency from `/latest-game` (completed)
- Updated `api/stateRoutes.js` so `GET /api/game/state/latest-game` no longer waits for AI prequel/suggestion generation before responding.
- Route now returns immediately with DB-backed latest round data, `prequel: null`, and a safe suggestion fallback (existing value or empty string).
- This directly reduces/avoids refresh-page hangs on the initial loading spinner when AI providers are slow.
- Validation: `node --check api/stateRoutes.js` passed.

### Task: Prepare local preview verification for refresh fix (blocked by local backend env)
- Confirmed the static preview page itself is healthy, but testing the refresh-speed fix requires running the backend locally because the current frontend points to the remote Render backend.
- Attempted to start `server.js` and found local dependencies are not installed (`Cannot find module 'dotenv'`).
- Confirmed required backend environment variables are missing in the current shell (`FIREBASE_SERVICE_ACCOUNT`, `JWT_SECRET`), so local authenticated `/api/game/state/latest-game` cannot be exercised yet.
- Next step: install dependencies and provide local backend env values, then point frontend API base to `http://127.0.0.1:3001` (or add a localhost auto-switch).

### Task: Add localhost preview mock mode for UI/flow testing (completed)
- Added a localhost-only preview helper (`scripts/localPreviewMode.js`) that auto-enables mock mode on `index.html` and seeds a local preview token/username, with `?mock=0` to disable and `?mock=1` to force enable.
- Added browser-side mock API implementation (`scripts/localPreviewMockApi.js`) covering homepage-critical endpoints (`latest-game`, `interact`, `skills`, `cultivation`, `force-suicide`, item drop/equip toggles) with persistent localStorage-backed mock game state.
- Updated `scripts/api.js` to intercept API requests in local preview mock mode, so no remote/backend/Firebase credentials are required for homepage preview testing.
- Updated `scripts/main.js` to bootstrap preview auth before the normal token redirect check.
- Updated `.codex-preview-server.js` to return `204` for `/favicon.ico` (reduces local preview console noise after server restart).
- Validation: `node --check` passed for `scripts/localPreviewMode.js`, `scripts/localPreviewMockApi.js`, `scripts/api.js`, `scripts/main.js`, `.codex-preview-server.js`.

### Task: Fix local preview module MIME error for `.mjs` (completed)
- Added `.mjs -> text/javascript; charset=utf-8` to `.codex-preview-server.js` MIME map so browser module imports load correctly.
- Identified that port `5500` was still occupied by a stale preview server process serving the old MIME map, then restarted the local preview server.
- Verified `http://127.0.0.1:5500/shared/gameConstants.mjs` now returns `Content-Type: text/javascript; charset=utf-8` and `index.html` returns HTTP 200.

### Task: Switch failing suggestion AI task from Grok to GPT-5.2 (completed)
- Investigated backend error log (`[AI ‰ªªÂãôÂ§±Êïó] Ê©üÈùàÊõ∏ÂÉÆ‰ªªÂãô`) and confirmed it maps to `getAISuggestion()` using `aiConfig.suggestion`.
- Changed `aiConfig.suggestion` from `grok` to `gpt5.2` in `api/aiConfig.js` to avoid the failing Grok path for the bookboy suggestion task.
- Added `gpt5.2` model routing in `services/aiService.js` (`OpenAI` client with model `gpt-5.2`) while keeping existing `openai` tasks on `gpt-4o-mini`.
- Validation: `node --check api/aiConfig.js` and `node --check services/aiService.js` passed.

### Task: Audit dashboard AI-core selector behavior and model mapping (inspection)
- Confirmed the dashboard `AIÊ†∏ÂøÉ` selector is a real control (`index.html`) and its current default option is `openai` (selected in markup).
- Verified frontend sends the selected model value with multiple gameplay requests (main action loop, NPC interaction flows, combat flows, and some state actions such as force-suicide).
- Verified backend receives `req.body.model` and many AI tasks use `playerModelChoice || aiConfig.<task>`; however some tasks still ignore the selector and use fixed `aiConfig` routes (notably `getAISuggestion()` uses `aiConfig.suggestion`, and `getAISummary()` uses `aiConfig.summary`).
- Recorded current selector option -> actual model mapping from `services/aiService.js` (`openai` now routes to `gpt-5.2`, `gemini` -> `gemini-1.5-flash`, `deepseek` -> `deepseek-chat`, `grok` -> `grok-3-fast`, `claude` -> `claude-3-5-sonnet-20240620`).

### Task: AI core selector persistence + fallback + bookboy suggestion follows selector (completed)
- Added persistent AI-core selection restore/save logic in frontend (`scripts/aiModelPreference.js`, wired in `scripts/main.js`) so the dashboard selector remembers the last choice via localStorage.
- Added `cluade` selector option alias in `index.html` and backend alias support in `services/aiService.js` (`case 'cluade'` falls through to Claude handling).
- Updated `services/aiService.js` `callAI()` to auto-retry failed non-default providers with default GPT route (`openai` -> `gpt-5.2`) before surfacing an error.
- Updated frontend error handling (`scripts/uiUpdater.js`) to reset the AI-core selector back to default GPT when an AI-model runtime failure still reaches the client.
- Updated `getAISuggestion()` to accept `playerModelChoice` and wired all major round-producing routes to pass the selected model (main action, combat finalize, cultivation, NPC give-item/end-chat, trade, forget-skill), including frontend request bodies for cultivation and forget-skill.
- Validation: `node --check` passed for `services/aiService.js`, `scripts/main.js`, `scripts/uiUpdater.js`, `scripts/aiModelPreference.js`, `api/gameplay/actionHandler.js`, `api/combatRoutes.js`, `api/gameplay/cultivationRoutes.js`, `api/routes/npcChatRoutes.js`, `api/routes/npcTradeRoutes.js`, `api/stateRoutes.js`.

### Task: Inspect duplicate Claude/Cluade options and current AI-core model mapping (inspection)
- Confirmed the AI-core selector currently contains both `claude` and `cluade` options in `index.html` (`Claude` + alias entry), which explains the apparent duplicate Claude option in the dropdown.
- Confirmed backend routing maps both `case 'claude'` and `case 'cluade'` to the same Anthropic model path in `services/aiService.js`.
- Re-verified current selector-model mappings: `openai -> gpt-5.2`, `gemini -> gemini-1.5-flash`, `deepseek -> deepseek-chat`, `grok -> grok-3-fast`, `claude/cluade -> claude-3-5-sonnet-20240620`.

### Task: Remove duplicate Cluade UI option and update AI-core model versions (completed)
- Removed the extra `cluade` dropdown option from the AI-core selector and kept the original `claude` option only (`index.html`).
- Updated selector labels to display requested versions: `GPT-5.2`, `Gemini 3.1`, `DeepSeek-V3.2`, `Grok-4.20`, `Claude-Sonnet-4.6`.
- Kept backward compatibility for older saved `cluade` values by normalizing `cluade -> claude` in `scripts/aiModelPreference.js`.
- Updated backend model routing strings in `services/aiService.js` to the requested versions (`gpt-5.2`, `gemini-3.1`, `deepseek-v3.2`, `grok-4.20`, `claude-sonnet-4.6`).
- Validation: `node --check services/aiService.js` and `node --check scripts/aiModelPreference.js` passed.

### Task: Inspect NPC avatar generation model and recommend lower-cost consistent image model (inspection/recommendation)
- Confirmed NPC avatar generation route `/api/image/generate/npc/:npcName` calls `getAIGeneratedImage(imagePrompt)` in `api/imageRoutes.js`.
- Confirmed current image generation implementation uses OpenAI Images API with `model: "dall-e-3"`, `quality: "hd"`, and `style: "vivid"` in `services/aiService.js`.
- Confirmed the route caches and reuses an existing `avatarUrl`, which already improves per-NPC visual consistency by avoiding re-generation.
- Prepared recommendation: for cheaper API image generation with good quality and easier future editing/consistency workflows, consider switching to `gpt-image-1-mini` (or `gpt-image-1` if higher consistency/quality is worth the extra cost), and keep a strong shared style anchor prompt + cached portraits.

### Task: Inspect local file `AIº“´¨´¨∏π` purpose (inspection)
- Confirmed `AIº“´¨´¨∏π` is a plain text file without extension in the project root, containing a manually maintained table of AI-core display names, model IDs, and providers.
- Searched the codebase and found no runtime references to the file path/name; current matches for listed model IDs are from the file itself (and historical notes in `WORKLOG.md`).
- Conclusion: this file is not used by the app at runtime; it serves as a human-readable reference/checklist and may be outdated relative to current `services/aiService.js` mappings.

### Task: Convert `AIº“´¨´¨∏π` to Markdown and sync to current effective versions (completed)
- Replaced the root plain-text file `AIº“´¨´¨∏π` with `AIº“´¨´¨∏π.md` in UTF-8 Markdown format.
- Synced the document to current runtime mappings from `services/aiService.js` and current UI selector labels in `index.html`.
- Document now includes: player AI-core mappings, compatibility aliases (`gpt5.2`, `cluade`), backend fallback behavior (auto-retry to `openai -> gpt-5.2`), and a note that NPC image generation is currently fixed to `dall-e-3`.
