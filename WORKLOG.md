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

### Task: Diagnose refresh stuck on "正在連接你的世界，讀取記憶中..." (inspection)
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
- Investigated backend error log (`[AI 任務失敗] 機靈書僮任務`) and confirmed it maps to `getAISuggestion()` using `aiConfig.suggestion`.
- Changed `aiConfig.suggestion` from `grok` to `gpt5.2` in `api/aiConfig.js` to avoid the failing Grok path for the bookboy suggestion task.
- Added `gpt5.2` model routing in `services/aiService.js` (`OpenAI` client with model `gpt-5.2`) while keeping existing `openai` tasks on `gpt-4o-mini`.
- Validation: `node --check api/aiConfig.js` and `node --check services/aiService.js` passed.

### Task: Audit dashboard AI-core selector behavior and model mapping (inspection)
- Confirmed the dashboard `AI核心` selector is a real control (`index.html`) and its current default option is `openai` (selected in markup).
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

### Task: Inspect local file `AI�ҫ�����` purpose (inspection)
- Confirmed `AI�ҫ�����` is a plain text file without extension in the project root, containing a manually maintained table of AI-core display names, model IDs, and providers.
- Searched the codebase and found no runtime references to the file path/name; current matches for listed model IDs are from the file itself (and historical notes in `WORKLOG.md`).
- Conclusion: this file is not used by the app at runtime; it serves as a human-readable reference/checklist and may be outdated relative to current `services/aiService.js` mappings.

### Task: Convert `AI�ҫ�����` to Markdown and sync to current effective versions (completed)
- Replaced the root plain-text file `AI�ҫ�����` with `AI�ҫ�����.md` in UTF-8 Markdown format.
- Synced the document to current runtime mappings from `services/aiService.js` and current UI selector labels in `index.html`.
- Document now includes: player AI-core mappings, compatibility aliases (`gpt5.2`, `cluade`), backend fallback behavior (auto-retry to `openai -> gpt-5.2`), and a note that NPC image generation is currently fixed to `dall-e-3`.

### Task: Deep inspection of `map.html` / world-map generation failure and design issues (inspection only)
- Confirmed `map.html` uses `scripts/map.js -> api.getMap() -> GET /api/map/world-map` and renders returned `mermaidSyntax` via Mermaid on the client.
- Confirmed `/api/map` routes are mounted behind `authMiddleware` in `server.js`, so the backend route itself is authenticated correctly.
- Identified a confirmed local-preview failure path: localhost mock mode persists across pages, but `scripts/localPreviewMockApi.js` does not implement `/api/map/world-map`, so `map.html` will fail in mock mode with an unsupported-endpoint error.
- Identified map-generation robustness risks in `api/mapRoutes.js`: direct interpolation of AI/location strings into Mermaid syntax without escaping (location names / travel times can break Mermaid parsing), and schema assumptions around `nearbyLocations` shape.
- Identified design issues in current map logic: mixing hierarchy (`parentLocation`) and proximity (`nearbyLocations`) into one Mermaid flowchart (`graph TD`) creates unstable, non-geographic layouts and often disconnected graphs because only discovered locations are loaded into the node set.
- Discussion-only phase requested: no implementation changes made.

### Task: Implement map feature fixes and map-generation logic refactor (completed)
- Rebuilt `api/mapRoutes.js` for stronger map generation: normalizes `nearbyLocations` schema (string/object forms), escapes Mermaid labels, separates hierarchy and adjacency edges, and returns structured map payload (`views.hierarchy` / `views.adjacency`) while keeping legacy `mermaidSyntax` for backward compatibility.
- Added a thin context-ring fetch (parents/nearby referenced locations from static `locations`) to reduce disconnected map graphs; context nodes are included and styled as undiscovered placeholders.
- Updated `scripts/map.js` to support the new structured map payload, render switchable map views (hierarchy/adjacency), show map metadata, and keep compatibility with legacy `mermaidSyntax` responses.
- Updated `map.html` with toolbar/meta UI styles and containers for the new map view controls.
- Added local preview mock support for `/api/map/world-map` in `scripts/localPreviewMockApi.js` so `map.html` no longer fails in localhost mock mode.
- Extended localhost auto-mock convenience to include `map.html` in `scripts/localPreviewMode.js`.
- Validation: `node --check` passed for `api/mapRoutes.js`, `scripts/map.js`, `scripts/localPreviewMockApi.js`, and `scripts/localPreviewMode.js`.

### Task: Deep inspection of current location info/details feature anomalies (inspection only)
- Traced current-location info flow end-to-end: backend `getMergedLocationData()` -> API responses -> `gameState.currentLocationData` -> sidebar card (`updateLocationInfo`) and location-details modal (`openLocationDetailsModal`).
- Identified a major data-loss bug in `getMergedLocationData()`: static and dynamic location docs are merged shallowly (`{...staticData, ...dynamicData}`), which overwrites nested objects like `economy` / `lore` and causes loss of static fields such as `prosperityPotential`, `specialty`, and `history`.
- Identified a first-load inconsistency bug: when a static location exists but dynamic state is missing, `generateAndCacheLocation()` is called, but `dynamicDoc` is not re-fetched in the same request, so the first rendered location details may miss newly-created dynamic fields.
- Identified generation-contract mismatch: `locationGeneratorPrompt` requires `initialDynamicState`, but `worldEngine` stores only `loc.staticTemplate` and later creates a generic dynamic state, so AI-generated dynamic richness is discarded.
- Identified modal-rendering quality issues: address path uses `Object.values(address)` (unstable ordering / blank entries), and modal HTML rendering is largely unescaped (can produce malformed display when AI text contains HTML-like characters).
- Identified local-preview mock schema mismatch for location details: mock `locationData` uses `name` and top-level `nearbyLocations` instead of runtime schema (`locationName`, `geography.nearbyLocations`), making the location details modal look incomplete/weird in mock mode.
- Discussion-only phase requested: no fixes implemented yet.

### Task: Major location-data API structure refactor + location details UI/mock alignment (completed)
- Rebuilt backend `getMergedLocationData()` in `api/worldStateHelpers.js` to return a structured payload (`schemaVersion: 2`) with `summary`, `current.{static,dynamic,merged,inheritedMerged}`, `hierarchy[]`, and `layers`, while preserving legacy top-level fields (`locationName`, `description`, `governance`, etc.) for backward compatibility.
- Fixed the nested-field overwrite bug by replacing shallow merges with deep merges for location data; static and dynamic nested objects (e.g., `economy`, `lore`, `governance`, `geography`) now merge without losing static fields.
- Fixed first-load inconsistency: when location static/dynamic docs are generated on demand, `getMergedLocationData()` now re-fetches the docs in the same request before building the response.
- Added traversal hardening in `getMergedLocationData()`: accepts string-or-array inputs, normalizes hierarchy names, and guards against parent-location cycles.
- Updated `api/worldEngine.js` so initial dynamic location state can ingest AI-generated `initialDynamicState` (when present) and deep-merge it into the default dynamic template instead of always discarding it.
- Refactored `scripts/modalManager.js` location-details modal rendering to consume the new structured location payload, with legacy fallback support; added stable address ordering and safe HTML escaping for strings/arrays/objects to reduce malformed rendering/XSS risk in modal content.
- Updated `scripts/uiUpdater.js` current-location sidebar card to prefer `locationData.summary` (ruler/description) while preserving fallback to legacy top-level fields.
- Aligned localhost mock location payload in `scripts/localPreviewMockApi.js` with the new runtime schema (including `summary`, `current`, `hierarchy`, `layers`) and kept legacy aliases (`name`, top-level `nearbyLocations`) for existing mock map helpers.
- Updated mock `roundData.LOC` to match the new mock location hierarchy so local map preview and location-details UI stay consistent.
- Validation: `node --check` passed for `api/worldStateHelpers.js`, `api/worldEngine.js`, `scripts/modalManager.js`, `scripts/uiUpdater.js`, and `scripts/localPreviewMockApi.js`.

### Task: Convert current-location field labels back to Chinese (completed)
- Updated current-location sidebar card label and button tooltip in `scripts/uiUpdater.js` to Chinese (`�Ϊv��`, `�d�ݦa�ϸԱ�`) and restored Chinese loading/fallback text.
- Updated location-details modal labels/section titles in `scripts/modalManager.js` to Chinese, including summary/static/dynamic section headers and field-name mappings (`����`, `�a�}`, `�h�Ÿ��|`, `�Ϊv��`, etc.).
- Restored visible fallback strings in the modal from English (`N/A`, `Unknown`) to Chinese (`�L`, `����`) to avoid mixed-language UI in the current-location feature.
- Validation: `node --check` passed for `scripts/uiUpdater.js` and `scripts/modalManager.js`.

### Task: Fix remaining English field label and location-detail modal title fallback (completed)
- Added Chinese label mapping for field key description in location-details modal so it no longer renders as raw English key.
- Hardened modal title/name resolution in scripts/modalManager.js: ignores placeholder names (e.g. Unknown Location) and falls back to currentMerged.name, legacy locationData.name, and the last item of locationHierarchy.
- Updated backend uildLocationSummary() in pi/worldStateHelpers.js to also read legacy 
ame fields and use Chinese fallback strings (�����a��, �a�ϱ������J��...) to reduce placeholder leakage into UI.
- Validation: 
ode --check passed for scripts/modalManager.js and pi/worldStateHelpers.js.

### Task: Fix current-location modal English `description` label and title fallback (completed)
- Added explicit Chinese label mapping for `description` in `scripts/modalManager.js` (written as Unicode escape to avoid console/codepage corruption in source edits).
- Hardened `normalizeLocationModalData()` title/name resolution to ignore placeholder names (e.g., `Unknown Location`) and fall back to `currentMerged.name`, legacy `locationData.name`, and the last item of `locationHierarchy`.
- Updated backend `buildLocationSummary()` in `api/worldStateHelpers.js` to support legacy `name` fields and use Chinese fallback strings, reducing placeholder leakage into UI responses.
- Validation: `node --check` passed for `scripts/modalManager.js` and `api/worldStateHelpers.js`.

### Task: Fix GitHub Pages build failure (UTF-8 + nojekyll) (completed)
- Diagnosed likely GitHub Pages build failure cause: `WORKLOG.md` contained invalid UTF-8 bytes, which can break Pages/Jekyll build processing.
- Rewrote `WORKLOG.md` as valid UTF-8 (invalid byte sequences were replaced during conversion to restore build compatibility).
- Added root `.nojekyll` file so GitHub Pages serves the repo as static files instead of trying to process it as a Jekyll site.
- Validation: project text-file UTF-8 scan now passes (`ALL_TEXT_FILES_UTF8_OK`).

### Task: Auto-group currency items into Money Bag (completed)
- Added front-end currency detection in `scripts/uiUpdater.js` (`isCurrencyItem`) using item name/type/category keywords so currency-like items (e.g., ??/??/??/??) are automatically recognized even if mixed into normal inventory payloads.
- Updated `renderInventory()` to exclude detected currency items from the `???? (ITM)` list and show only general items there.
- Added `updateMoneyBagDisplay()` in `scripts/uiUpdater.js` to aggregate and render multi-currency balances inside the `??` card (single `??` keeps legacy compact display, multi-currency shows a list).
- Updated post-payment beggar inquiry flow in `scripts/interactionHandlers.js` to sync `??` balance back into `gameState.roundData.inventory` and refresh the money bag UI via the shared helper instead of directly overwriting `#money-content` text.
- Updated item-drop flow in `scripts/main.js` to refresh `??` after inventory changes, preventing stale currency display after dropping currency items.
- Added small UI styles in `styles/components.css` for multi-line money bag rendering (`.money-display-list`, `.money-line`, `.money-amount`).
- Validation: `node --check` passed for `scripts/uiUpdater.js`, `scripts/interactionHandlers.js`, and `scripts/main.js`.

### Task: Rebuild character relations graph (data-driven + radial UI) (completed)
- Replaced `/api/game/state/get-relations` AI-summary Mermaid generation with a data-driven graph builder in `api/stateRoutes.js` using actual `npc_states` + `npcs` template relationships, with typed edges, dedupe, player-centered relations, and `cacheKey`.
- Redesigned `relations.html` into a dedicated graph workspace (toolbar, filter chips, zoom controls, side meta/legend panel, improved loading/empty states).
- Rewrote `scripts/relations.js` to render a protagonist-centered 360-degree radial SVG graph with pan/zoom, fit-to-view, relation-type hide/show filters, and local cache-first loading (revalidate and only rerender when `cacheKey` changes).
- Added local preview support for `relations.html` mock mode in `scripts/localPreviewMode.js`.
- Added mock endpoints in `scripts/localPreviewMockApi.js` for `/api/game/state/get-relations` and `/api/game/npc/profile/:npcName` so relations page works in localhost preview.
- Validation: `node --check` passed for `api/stateRoutes.js`, `scripts/relations.js`, `scripts/localPreviewMode.js`, and `scripts/localPreviewMockApi.js`.

### Task: Deep review of NPC attack/combat system (analysis only)
- Reviewed end-to-end NPC attack/combat flow across front-end interaction (`scripts/interactionHandlers.js`, `scripts/modalManager.js`, `scripts/main.js`) and backend combat lifecycle (`api/gameplay/combatManager.js`, `api/combatRoutes.js`, `services/aiService.js`, `prompts/combatPrompt.js`).
- Identified critical defects: a TDZ runtime bug in `/finalize-combat` (`killedNpcNames` referenced before declaration), client-trusted `combatResult` finalization payload, and likely missing `getInventoryState` export/implementation causing runtime failures in surrender/finalization paths.
- Identified major logic gaps: front-end `powerLevel`/`target` selections are sent but backend combat action ignores them; target selection UI state appears unwired; location co-presence validation is type-fragile (`includes(npcLocation)` on mixed array/string shapes).
- Identified UX/state issues: closing combat modal can leave `gameState.isInCombat = true` (soft-lock behavior), and skill-required flows can proceed without enforcing a selected skill.
- Prepared prioritized remediation order and risk notes for follow-up implementation.

### Task: Implement NPC attack/combat fixes + full combat UI redesign (completed)
- Rebuilt backend combat flow in `api/combatRoutes.js` to validate `strategy`, `powerLevel`, and `target`, pass them to AI combat resolution, and clamp combatant HP/MP updates when merging AI state changes.
- Removed client authority over combat finalization: `/combat/action` now stores a server-side `pending_combat_result`, and `/combat/finalize-combat` reads that server-stored result instead of trusting client-submitted `combatResult`.
- Fixed the `/finalize-combat` TDZ issue by restructuring settlement logic (including killed-NPC extraction before player transaction updates) as part of the route rewrite.
- Added missing `getInventoryState()` implementation/export in `api/playerStateHelpers.js` and reused it for combat surrender/finalization inventory + money snapshots.
- Rewrote `api/gameplay/combatManager.js` to normalize AI combat setup payloads, validate attack intentions, harden same-location checks for mixed location formats, and reject attacks on deceased targets.
- Replaced broken `prompts/combatPrompt.js` with a clean prompt that explicitly includes `powerLevel` and `target`, and enforces JSON-only combat outputs.
- Redesigned combat modal UX in `scripts/modalManager.js` + `styles/modals_interaction.css` (new roster card styling, battle status strip, target selection panel, action summary chips, and denser action composer layout).
- Reworked front-end combat interaction flow in `scripts/interactionHandlers.js` to support target selection UI, action summary updates, confirm-button state management, and safer combat log rendering defaults.
- Fixed combat modal cancel behavior soft-lock by clearing `gameState.isInCombat` and combat selection state on close/cancel paths.
- Validation: `node --check` passed for `api/combatRoutes.js`, `api/gameplay/combatManager.js`, `api/playerStateHelpers.js`, `prompts/combatPrompt.js`, `scripts/interactionHandlers.js`, `scripts/modalManager.js`, and `scripts/gameState.js`.

### Task: Combat flow validation checklist (runtime-feasible subset) (completed)
- Re-ran syntax validation for the rebuilt combat stack (`api/combatRoutes.js`, `api/gameplay/combatManager.js`, `api/playerStateHelpers.js`, `prompts/combatPrompt.js`, `scripts/interactionHandlers.js`, `scripts/modalManager.js`, `scripts/gameState.js`) and all passed `node --check`.
- Verified front-end finalize flow no longer posts client-controlled `combatResult` payload (`scripts/interactionHandlers.js` now calls `api.finalizeCombat({ model })` only), matching the server-side pending-result settlement design in `api/combatRoutes.js`.
- Verified server-side pending combat settlement path is wired (`PENDING_COMBAT_RESULT_DOC_ID`, pending result write on `COMBAT_END`, finalize reads pending snapshot existence before settlement).
- Verified target-selection UI wiring exists in front-end combat flow (`renderCombatTargetSelection`, `updateCombatConfirmState`, `selectedTarget` resets/updates in multiple combat lifecycle points).
- Identified remaining E2E blocker for localhost mock validation: `scripts/localPreviewMockApi.js` dispatcher still has no `/api/game/combat/*` mock routes, so `?mock=1` cannot execute the full “動手→戰鬥→結算→投降→再進戰鬥” flow.
- Note: Full browser click-through E2E was not executable in this shell environment (no browser automation step available here).

### Task: Hotfix modalManager syntax error after combat refactor (completed)
- Fixed `scripts/modalManager.js` parse failure (`Invalid or unexpected token` around line 26) caused by encoding-corrupted/broken string literals in the top helper section (`handleForgetSkill` / `openTradeModal`).
- Rewrote the affected string literals to ASCII-safe messages to avoid codepage corruption during local edits and confirmed `node --check scripts/modalManager.js` passes.
