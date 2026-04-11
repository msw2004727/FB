// scripts/main.js

import * as gameLoop from './gameLoop.js';
import { initializeGmPanel } from './gmManager.js';
import { gameState } from './gameState.js';
import { initializeDOM, dom } from './dom.js';
import { api } from './api.js';
import { handleApiError } from './uiUpdater.js';
import { restoreAiModelSelection, setStoredAiModel, needsUserApiKey, getStoredApiKey, setStoredApiKey, AI_MODEL_INFO, verifyVipPassword, activateVip, deactivateVip, isVip } from './aiModelPreference.js';
import clientDB from '../client/db/clientDB.js';
import * as gameEngine from '../client/engine/gameEngine.js';
import { exportSave, importSave, shouldRemindBackup, markBackupReminded } from '../client/utils/exportImport.js';
import { initStorageManager } from '../client/db/storageManager.js';
import { getScenario } from '../client/scenarios/scenarios.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 初始化 IndexedDB + 請求持久化儲存
    await clientDB.init();
    initStorageManager().catch(() => {});

    // 註冊 Service Worker (PWA)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(err => {
            console.warn('[SW] Service Worker 註冊失敗:', err);
        });
    }

    // --- PWA 安裝提示 ---
    let _deferredInstallPrompt = null;
    const pwaBanner = document.getElementById('pwa-install-banner');
    const pwaBtn = document.getElementById('pwa-install-btn');
    const pwaIosHelpBtn = document.getElementById('pwa-ios-help-btn');
    const pwaIosTooltip = document.getElementById('pwa-ios-tooltip');

    // iOS / 非支援瀏覽器：顯示橫幅 + 問號說明
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        _deferredInstallPrompt = e;
        if (pwaBanner) pwaBanner.style.display = '';
    });

    // iOS 無 beforeinstallprompt，手動顯示橫幅
    if (isIos && !isStandalone && pwaBanner) {
        pwaBanner.style.display = '';
    }

    if (pwaBtn) {
        pwaBtn.addEventListener('click', async () => {
            if (_deferredInstallPrompt) {
                _deferredInstallPrompt.prompt();
                const result = await _deferredInstallPrompt.userChoice;
                if (result.outcome === 'accepted') {
                    if (pwaBanner) pwaBanner.style.display = 'none';
                }
                _deferredInstallPrompt = null;
            } else if (isIos) {
                // iOS 沒有原生安裝提示，展開說明
                if (pwaIosTooltip) pwaIosTooltip.classList.toggle('visible');
            }
        });
    }

    // 問號按鈕：toggle iOS 說明
    if (pwaIosHelpBtn && pwaIosTooltip) {
        pwaIosHelpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            pwaIosTooltip.classList.toggle('visible');
        });
    }

    // 已安裝後隱藏
    window.addEventListener('appinstalled', () => {
        if (pwaBanner) pwaBanner.style.display = 'none';
        _deferredInstallPrompt = null;
    });

    // ── 劇本頁主題開關（進遊戲前就能切換）──────────────
    const scenarioThemeSwitcher = document.getElementById('scenario-theme-switcher');
    if (scenarioThemeSwitcher) {
        const curTheme = localStorage.getItem('game_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        scenarioThemeSwitcher.checked = curTheme === 'dark';
        scenarioThemeSwitcher.addEventListener('change', () => {
            const t = scenarioThemeSwitcher.checked ? 'dark' : 'light';
            localStorage.setItem('game_theme', t);
            document.body.classList.remove('light-theme', 'dark-theme'); document.body.classList.add(`${t}-theme`);
        });
    }

    // ── 劇本選擇 + 角色建立流程 ──────────────────────

    let activeProfile = null;

    // ── 劇本選擇（兩步驟：先選劇本 → 再選 NEW 或繼續）──
    const scenarioSelect = document.getElementById('scenario-select');
    const scenarioActions = document.getElementById('scenario-actions');
    const scenarioNewBtn = document.getElementById('scenario-new-btn');
    const scenarioSaves = document.getElementById('scenario-saves');
    const SCENARIO_ICONS = { wuxia: 'fa-yin-yang', school: 'fa-school', mecha: 'fa-robot', modern: 'fa-city', animal: 'fa-paw', hero: 'fa-mask' };

    // 預載所有存檔
    const allProfiles = await clientDB.profiles.list();
    const profilesByScenario = {};
    for (const p of allProfiles) {
        const sid = p.scenario || 'wuxia';
        if (!profilesByScenario[sid]) profilesByScenario[sid] = [];
        const lastSave = await clientDB.saves.getLatest(p.id);
        profilesByScenario[sid].push({ ...p, lastRound: lastSave?.R || 0 });
    }

    if (scenarioSelect.parentElement !== document.body) {
        document.body.appendChild(scenarioSelect);
    }
    scenarioSelect.style.display = 'flex';

    // 移除毛玻璃載入遮罩
    const loadingScreen = document.getElementById('app-loading-screen');
    if (loadingScreen) {
        loadingScreen.style.opacity = '0';
        setTimeout(() => loadingScreen.remove(), 400);
    }

    let selectedScenario = null;

    // Step 1: 點劇本按鈕 → 預覽主題 + 顯示 NEW/存檔
    function selectScenario(scenarioId) {
        selectedScenario = scenarioId;
        const scn = getScenario(scenarioId);

        // 切換主題預覽
        document.body.classList.remove('school-theme', 'mecha-theme', 'animal-theme', 'modern-theme', 'hero-theme');
        if (scn.themeClass) document.body.classList.add(scn.themeClass);

        // 高亮選中的按鈕
        scenarioSelect.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('selected'));
        const btn = scenarioSelect.querySelector(`.scenario-btn[data-scenario="${scenarioId}"]`);
        if (btn) btn.classList.add('selected');

        // 顯示該劇本的存檔
        const saves = profilesByScenario[scenarioId] || [];
        let savesHtml = '';
        for (const p of saves) {
            const icon = SCENARIO_ICONS[scenarioId] || 'fa-book';
            savesHtml += `<div class="scenario-save-row">
                <button class="scenario-save-btn" data-profile-id="${p.id}">
                    <span class="scenario-save-icon"><i class="fas ${icon}"></i></span>
                    <span class="scenario-save-info">
                        <span class="scenario-save-name">${p.username || '冒險者'}</span>
                        <span class="scenario-save-detail">第 ${p.lastRound} 回</span>
                    </span>
                </button>
                <button class="scenario-delete-btn" data-delete-id="${p.id}" data-delete-name="${p.username || '冒險者'}" title="刪除存檔"><i class="fas fa-trash-can"></i></button>
            </div>`;
        }
        scenarioSaves.innerHTML = savesHtml;

        // 綁定存檔按鈕事件
        scenarioSaves.querySelectorAll('.scenario-save-btn').forEach(btn => {
            btn.addEventListener('click', () => resolveChoice({ type: 'load', profileId: btn.dataset.profileId }));
        });

        // 綁定刪除按鈕事件
        scenarioSaves.querySelectorAll('.scenario-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.deleteId;
                const name = btn.dataset.deleteName;
                if (!confirm(`確定刪除「${name}」的存檔？\n此操作無法復原。`)) return;
                await clientDB.resetProfile(id);
                await clientDB.profiles.delete(id);
                // 從本地資料移除
                const sid = selectedScenario;
                if (profilesByScenario[sid]) {
                    profilesByScenario[sid] = profilesByScenario[sid].filter(p => p.id !== id);
                }
                // 重新渲染
                selectScenario(sid);
            });
        });

        scenarioActions.style.display = '';
    }

    // Step 2: 等待最終選擇（NEW 或載入存檔）
    let resolveChoice;
    const choice = await new Promise((resolve) => {
        resolveChoice = resolve;

        // 劇本按鈕 → 預覽（不直接開始遊戲）
        scenarioSelect.querySelectorAll('.scenario-btn:not(.locked)').forEach(btn => {
            btn.addEventListener('click', () => selectScenario(btn.dataset.scenario));
        });

        // NEW 按鈕
        scenarioNewBtn.addEventListener('click', () => {
            if (!selectedScenario) return;
            // 直接建新存檔，不覆蓋舊的
            resolve({ type: 'new', scenario: selectedScenario });
        });
    });

    scenarioSelect.style.display = 'none';
    document.querySelector('.game-container').removeAttribute('hidden');

    if (choice.type === 'load') {
        activeProfile = await clientDB.profiles.get(choice.profileId);
    } else {
        // 新劇本 → 建角
        const introModal = document.getElementById('intro-modal');
        const introNameInput = document.getElementById('intro-name-input');
        const introConfirmBtn = document.getElementById('intro-name-confirm');
        const introStory2 = introModal.querySelector('.intro-story-2');
        const introGenderBtns = introModal.querySelector('.intro-gender-btns');

        introModal.style.display = 'flex';
        introNameInput.value = '';
        introNameInput.disabled = false;
        introConfirmBtn.disabled = true;
        introStory2.style.display = 'none';
        introGenderBtns.style.display = 'none';
        introNameInput.focus();

        function confirmName() {
            const name = introNameInput.value.trim();
            if (!name) {
                introNameInput.classList.add('shake');
                setTimeout(() => introNameInput.classList.remove('shake'), 400);
                introNameInput.focus();
                return;
            }
            introNameInput.disabled = true;
            introConfirmBtn.disabled = true;
            introStory2.style.display = '';
            introGenderBtns.style.display = '';
        }

        introNameInput.addEventListener('input', () => {
            introConfirmBtn.disabled = !introNameInput.value.trim();
        });
        introNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); confirmName(); }
        });
        introConfirmBtn.addEventListener('click', confirmName);

        const genderSelected = await new Promise((resolve) => {
            introGenderBtns.querySelectorAll('.intro-gender-btn').forEach(btn => {
                btn.addEventListener('click', () => resolve(btn.dataset.gender));
            });
        });

        const playerName = introNameInput.value.trim() || '冒險者';
        introModal.style.display = 'none';

        // 永遠建新 profile，不覆蓋舊存檔
        {
            const result = await gameEngine.createNewGame(playerName, genderSelected, choice.scenario);
            activeProfile = result.profile;
        }
    }

    // 套用劇本主題 CSS class + 動態 UI 文字
    const activeScenario = getScenario(activeProfile.scenario || 'wuxia');
    if (activeScenario.themeClass) {
        document.body.classList.add(activeScenario.themeClass);
    }
    // 善惡標籤動態化
    const lblNeg = document.getElementById('morality-label-neg');
    const lblPos = document.getElementById('morality-label-pos');
    if (lblNeg && activeScenario.moralityLabels) lblNeg.textContent = activeScenario.moralityLabels.negative;
    if (lblPos && activeScenario.moralityLabels) lblPos.textContent = activeScenario.moralityLabels.positive;
    // 里程碑文字 + tooltip 動態化
    const milestoneEl = document.getElementById('milestone-runes');
    if (milestoneEl) {
        if (activeScenario.milestoneDisplay) {
            milestoneEl.title = `${activeScenario.milestoneDisplay.title} — ${activeScenario.milestoneDisplay.description}`;
        }
        if (activeScenario.milestoneChars) {
            milestoneEl.querySelectorAll('.rune').forEach((r, i) => {
                if (activeScenario.milestoneChars[i]) r.textContent = activeScenario.milestoneChars[i];
            });
        }
    }
    // 任務日誌預設文字
    const questJournal = document.getElementById('quest-journal');
    if (questJournal && activeScenario.questJournalDefault && !questJournal.textContent.trim()) {
        questJournal.textContent = activeScenario.questJournalDefault;
    }
    // 儲存劇本供 uiUpdater 等使用
    window.__activeScenario = activeScenario;
    localStorage.setItem('wenjiang_scenario', activeProfile.scenario || 'wuxia');

    // 設定活躍檔案
    gameEngine.setActiveProfile(activeProfile.id);
    localStorage.setItem('wenjiang_active_profile', activeProfile.id);
    localStorage.setItem('username', activeProfile.username);
    if (!localStorage.getItem('jwt_token')) {
        localStorage.setItem('jwt_token', 'local-pwa-token');
    }

    initializeDOM();

    // --- 角色名字+性別即時編輯 ---
    const playerNameInput = document.getElementById('player-name-display');
    const playerGenderSelect = document.getElementById('player-gender-select');
    const playerIdentitySaveBtn = document.getElementById('player-identity-save');

    if (playerNameInput && playerGenderSelect && playerIdentitySaveBtn) {
        // 填入當前值
        playerNameInput.value = activeProfile.username || '';
        playerGenderSelect.value = activeProfile.gender === 'female' || activeProfile.gender === '女' ? 'female' : 'male';

        let originalName = playerNameInput.value;
        let originalGender = playerGenderSelect.value;

        function checkIdentityChanged() {
            const changed = playerNameInput.value.trim() !== originalName || playerGenderSelect.value !== originalGender;
            playerIdentitySaveBtn.classList.toggle('visible', changed && playerNameInput.value.trim().length > 0);
        }

        playerNameInput.addEventListener('input', checkIdentityChanged);
        playerGenderSelect.addEventListener('change', checkIdentityChanged);

        playerIdentitySaveBtn.addEventListener('click', async () => {
            const newName = playerNameInput.value.trim();
            const newGender = playerGenderSelect.value;
            if (!newName || newName.length > 8) return;
            try {
                await gameEngine.renamePlayer(newName);
                await clientDB.profiles.update(activeProfile.id, { gender: newGender });
                activeProfile.username = newName;
                activeProfile.gender = newGender;
                originalName = newName;
                originalGender = newGender;
                playerIdentitySaveBtn.classList.remove('visible');
            } catch (e) {
                alert('儲存失敗：' + e.message);
            }
        });
    }

    // 重選劇本按鈕 → reload 回到劇本選擇頁
    const reselectBtn = document.getElementById('reselect-scenario-btn');
    if (reselectBtn) {
        reselectBtn.addEventListener('click', () => {
            if (confirm('返回劇本選擇頁面？\n（當前進度已自動儲存）')) {
                window.location.reload();
            }
        });
    }

    // --- 卡片說明彈窗 ---
    const CARD_HELP = {
        pc: { title: '角色狀態 (PC)', body: '這是你目前的身體和精神狀態的簡短描述。\n\n受傷了會顯示傷勢、心情好會顯示狀態良好。簡單說就是「你現在看起來怎麼樣」。\n\n如果這裡寫著什麼很嚇人的東西……嗯，也許該考慮去找個醫生（如果這個世界有的話）。' },
        morality: { title: '立場傾向', body: '這條軸線反映你在這個世界裡的行事風格。\n\n每個劇本的兩端含義不同——可能是正義與邪惡、秩序與自由、共感與理性等等。\n\n你的每一個選擇都會微妙地推動這個數值。NPC 們會根據你的立場傾向，用不同的態度對待你。\n\n沒有所謂的「正確」方向，走到哪邊都有獨特的故事體驗。' },
        journey: { title: '旅程', body: '這裡記錄你的主線進度和目前的回合數。\n\n上面那排神秘的字元是里程碑標記——每當你觸發一個重大劇情轉折，就會點亮一個。集滿全部就能到達結局。\n\n下方的文字是你目前的主線任務提示。如果你迷路了，看看這裡也許能找到方向。\n\n（但說真的，迷路也是冒險的一部分不是嗎？）' },
        character: { title: '角色', body: '在這裡你可以修改角色的名字和性別。\n\n改完記得按右邊的 ✓ 儲存。你的名字會影響 NPC 怎麼稱呼你，性別會影響故事中的互動和稱呼方式。\n\n「重選劇本」按鈕可以回到劇本選擇畫面，你的進度會自動保存。' },
        ai: { title: 'AI 核心', body: '這裡選擇為你編寫故事的 AI 模型。\n\n不同模型就像不同的小說家——有的文筆華麗、有的邏輯嚴密、有的腦洞大開。預設的 MiniMax 免費使用，其他模型需要自行輸入 API Key 或啟用 VIP。\n\n切換模型後故事風格會明顯改變，就像換了一個說書人。\n\n右邊的版本號是遊戲版本，跟你的故事無關，別擔心。' },
    };

    const helpModal = document.getElementById('card-help-modal');
    const helpTitle = document.getElementById('card-help-title');
    const helpBody = document.getElementById('card-help-body');
    const helpClose = document.getElementById('card-help-close');

    document.querySelectorAll('.card-help-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = btn.dataset.help;
            const info = CARD_HELP[key];
            if (!info || !helpModal) return;
            helpTitle.textContent = info.title;
            helpBody.innerHTML = info.body.replace(/\n/g, '<br>');
            helpModal.style.display = 'flex';
        });
    });

    if (helpClose) helpClose.addEventListener('click', () => { helpModal.style.display = 'none'; });
    if (helpModal) helpModal.addEventListener('click', (e) => { if (e.target === helpModal) helpModal.style.display = 'none'; });

    // --- API Key 彈窗邏輯 ---
    let _previousModel = null;

    function openApiKeyModal(model) {
        const info = AI_MODEL_INFO[model] || { name: model, hint: '' };
        dom.apikeyModalTitle.textContent = '設定 AI 模型';
        const modelNameEl = document.getElementById('apikey-modal-model-name');
        if (modelNameEl) modelNameEl.textContent = info.name;
        dom.apikeyModalDesc.textContent = info.hint || '請輸入您的 API Key 以啟用此 AI 模型。';
        dom.apikeyInput.value = getStoredApiKey(model) || '';
        dom.apikeyInput.style.webkitTextSecurity = 'disc';
        if (dom.apikeyToggleBtn) {
            dom.apikeyToggleBtn.querySelector('i').className = 'fas fa-eye';
        }
        dom.apikeyModal.classList.add('visible');
        dom.apikeyInput.focus();
    }

    function closeApiKeyModal() {
        dom.apikeyModal.classList.remove('visible');
        dom.apikeyInput.value = '';
    }

    if (dom.aiModelSelector) {
        restoreAiModelSelection(dom.aiModelSelector);
        _previousModel = dom.aiModelSelector.value;

        dom.aiModelSelector.addEventListener('change', () => {
            const selected = dom.aiModelSelector.value;
            if (needsUserApiKey(selected) && !getStoredApiKey(selected)) {
                // 沒有已儲存的 Key → 彈窗要求輸入
                openApiKeyModal(selected);
            } else {
                // 已有 Key 或不需要 Key → 直接切換
                _previousModel = selected;
                setStoredAiModel(selected);
            }
        });
    }

    // 儲存 API Key
    if (dom.apikeySaveBtn) {
        dom.apikeySaveBtn.addEventListener('click', () => {
            const model = dom.aiModelSelector.value;
            const key = dom.apikeyInput.value.trim();
            if (!key) {
                dom.apikeyInput.classList.add('shake');
                setTimeout(() => dom.apikeyInput.classList.remove('shake'), 400);
                return;
            }
            setStoredApiKey(model, key);
            setStoredAiModel(model);
            _previousModel = model;
            closeApiKeyModal();
        });
    }

    // 取消 → 還原為上一個模型
    if (dom.apikeyCancelBtn) {
        dom.apikeyCancelBtn.addEventListener('click', () => {
            if (_previousModel && dom.aiModelSelector) {
                dom.aiModelSelector.value = _previousModel;
            }
            closeApiKeyModal();
        });
    }

    // VIP 按鈕 → 輸入密碼啟用
    const vipBtn = document.getElementById('apikey-vip-btn');
    const cancelVipBtn = document.getElementById('cancel-vip-btn');

    function updateVipUI() {
        if (cancelVipBtn) cancelVipBtn.style.display = isVip() ? '' : 'none';
    }

    if (vipBtn) {
        vipBtn.addEventListener('click', () => {
            const pw = prompt('請輸入 VIP 驗證碼：');
            if (pw === null) return;
            if (verifyVipPassword(pw)) {
                activateVip();
                const model = dom.aiModelSelector.value;
                setStoredAiModel(model);
                _previousModel = model;
                closeApiKeyModal();
                updateVipUI();
                alert('VIP 已啟用！本次瀏覽期間所有 AI 模型皆可免費使用。');
            } else {
                alert('驗證碼錯誤。');
            }
        });
    }

    // 取消 VIP 按鈕
    if (cancelVipBtn) {
        cancelVipBtn.addEventListener('click', () => {
            if (confirm('確定取消 VIP？\n取消後需要自行輸入 API Key 才能使用非預設模型。')) {
                deactivateVip();
                updateVipUI();
                // 如果當前模型需要 key，切回 minimax
                const current = dom.aiModelSelector?.value;
                if (needsUserApiKey(current) && !getStoredApiKey(current)) {
                    dom.aiModelSelector.value = 'minimax';
                    setStoredAiModel('minimax');
                    _previousModel = 'minimax';
                }
                alert('VIP 已取消。');
            }
        });
    }

    updateVipUI();

    // 顯示/隱藏密碼（用 CSS -webkit-text-security 代替 type="password" 避免瀏覽器自動填入）
    if (dom.apikeyToggleBtn) {
        dom.apikeyToggleBtn.addEventListener('click', () => {
            const isHidden = dom.apikeyInput.style.webkitTextSecurity === 'disc';
            dom.apikeyInput.style.webkitTextSecurity = isHidden ? 'none' : 'disc';
            dom.apikeyToggleBtn.querySelector('i').className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
        });
    }

    // 點擊毛玻璃背景關閉彈窗
    if (dom.apikeyModal) {
        dom.apikeyModal.addEventListener('click', (e) => {
            if (e.target === dom.apikeyModal) {
                if (_previousModel && dom.aiModelSelector) {
                    dom.aiModelSelector.value = _previousModel;
                }
                closeApiKeyModal();
            }
        });
    }

    // 變更 API Key 按鈕
    const editApikeyBtn = document.getElementById('edit-apikey-btn');
    if (editApikeyBtn && dom.aiModelSelector) {
        editApikeyBtn.addEventListener('click', () => {
            const current = dom.aiModelSelector.value;
            if (needsUserApiKey(current)) {
                openApiKeyModal(current);
            } else {
                alert('此模型使用內建金鑰，無需手動設定。');
            }
        });
    }

    if (dom.playerInput) {
        dom.playerInput.value = '';
        dom.playerInput.placeholder = '本回劇情開放文字輸入';
    }

    // 備份提醒（頁面內 banner，不彈窗）
    const backupBanner = document.getElementById('backup-remind-banner');
    const backupExportBtn = document.getElementById('backup-remind-export');
    const backupDismissBtn = document.getElementById('backup-remind-dismiss');

    if (shouldRemindBackup() && backupBanner) {
        setTimeout(() => { backupBanner.style.display = ''; }, 3000);
    }
    if (backupExportBtn) {
        backupExportBtn.addEventListener('click', async () => {
            try {
                await exportSave(activeProfile.id);
                markBackupReminded();
                if (backupBanner) backupBanner.style.display = 'none';
            } catch (e) { console.error('匯出失敗:', e); }
        });
    }
    if (backupDismissBtn) {
        backupDismissBtn.addEventListener('click', () => {
            markBackupReminded();
            if (backupBanner) backupBanner.style.display = 'none';
        });
    }

    function setGameContainerHeight() {
        if (dom.gameContainer) {
            dom.gameContainer.style.height = `${window.innerHeight}px`;
        }
    }

    function initialize() {
        // 主題：localStorage > 系統偏好 > 預設淺色
        const savedTheme = localStorage.getItem('game_theme');
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        let currentTheme = savedTheme || (systemDark ? 'dark' : 'light');
        document.body.classList.remove('light-theme', 'dark-theme');
        document.body.classList.add(`${currentTheme}-theme`);

        if (dom.themeSwitcher) {
            dom.themeSwitcher.checked = currentTheme === 'dark';
            dom.themeSwitcher.addEventListener('change', () => {
                currentTheme = dom.themeSwitcher.checked ? 'dark' : 'light';
                localStorage.setItem('game_theme', currentTheme);
                document.body.classList.remove('light-theme', 'dark-theme');
                document.body.classList.add(`${currentTheme}-theme`);
            });
            // 監聽系統主題變化（使用者未手動選擇時跟隨）
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                if (!localStorage.getItem('game_theme')) {
                    currentTheme = e.matches ? 'dark' : 'light';
                    document.body.classList.remove('light-theme', 'dark-theme');
                    document.body.classList.add(`${currentTheme}-theme`);
                    dom.themeSwitcher.checked = e.matches;
                }
            });
        }

        if (dom.headerToggleButton) {
            dom.headerToggleButton.addEventListener('click', () => {
                const isCollapsed = dom.storyHeader.classList.toggle('collapsed');
                dom.headerToggleButton.setAttribute('aria-expanded', String(!isCollapsed));
                dom.headerToggleButton.title = isCollapsed ? '展開資訊欄' : '收起資訊欄';
                dom.headerToggleButton.setAttribute('aria-label', isCollapsed ? '展開日期與時辰資訊欄' : '收起日期與時辰資訊欄');
            });
        }

        const setSidebarOpenState = (isOpen) => {
            if (dom.gameContainer) dom.gameContainer.classList.toggle('sidebar-open', isOpen);
            if (dom.menuToggle) {
                dom.menuToggle.setAttribute('aria-expanded', String(isOpen));
                dom.menuToggle.title = isOpen ? '收起右側欄' : '展開右側欄';
                dom.menuToggle.setAttribute('aria-label', isOpen ? '收起右側欄' : '展開右側欄');
            }
        };
        if (dom.gameContainer) setSidebarOpenState(dom.gameContainer.classList.contains('sidebar-open'));

        if (dom.menuToggle) {
            dom.menuToggle.addEventListener('click', () => {
                const willOpen = !dom.gameContainer?.classList.contains('sidebar-open');
                setSidebarOpenState(willOpen);
            });
        }

        if (dom.mainContent) {
            dom.mainContent.addEventListener('click', (e) => {
                if (e.target !== dom.mainContent) return;
                if (window.innerWidth <= 1024 && dom.gameContainer?.classList.contains('sidebar-open')) {
                    setSidebarOpenState(false);
                }
            });
        }

        // 說明彈窗
        const helpBtn = document.getElementById('help-btn');
        const helpModal = document.getElementById('help-modal');
        const helpCloseBtn = document.getElementById('help-modal-close-btn');

        if (helpBtn && helpModal) {
            helpBtn.addEventListener('click', () => {
                helpModal.style.display = 'flex';
            });
            helpCloseBtn.addEventListener('click', () => {
                helpModal.style.display = 'none';
            });
            helpModal.addEventListener('click', (e) => {
                if (e.target === helpModal) helpModal.style.display = 'none';
            });
        }

        // 存檔按鈕
        const saveGameBtn = document.getElementById('save-game-btn');
        const exportSaveBtn = document.getElementById('export-save-btn');
        const importSaveBtn = document.getElementById('import-save-btn');

        if (saveGameBtn) {
            saveGameBtn.addEventListener('click', () => {
                alert('遊戲會在每次行動後自動儲存到瀏覽器本機。');
            });
        }
        if (exportSaveBtn) {
            exportSaveBtn.addEventListener('click', async () => {
                try {
                    const filename = await exportSave(gameEngine.getActiveProfileId());
                    alert(`存檔已匯出: ${filename}`);
                } catch (e) { alert('匯出失敗: ' + e.message); }
            });
        }
        if (importSaveBtn) {
            importSaveBtn.addEventListener('click', async () => {
                try {
                    const profileId = await importSave();
                    gameEngine.setActiveProfile(profileId);
                    localStorage.setItem('wenjiang_active_profile', profileId);
                    window.location.reload();
                } catch (e) { alert('載入失敗: ' + e.message); }
            });
        }

        // 故事回顧
        const storyArchiveBtn = document.getElementById('story-archive-btn');
        if (storyArchiveBtn) {
            storyArchiveBtn.addEventListener('click', async () => {
                try {
                    const chapters = await clientDB.novel.getAll(gameEngine.getActiveProfileId());
                    if (!chapters || chapters.length === 0) {
                        alert('尚無故事記錄。');
                        return;
                    }
                    const text = chapters
                        .sort((a, b) => a.round - b.round)
                        .map(ch => `【第 ${ch.round} 回】\n${ch.story}`)
                        .join('\n\n────────\n\n');
                    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `story_${localStorage.getItem('username') || 'archive'}_R${chapters.length}.txt`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (e) {
                    alert('匯出故事失敗: ' + e.message);
                }
            });
        }

        if (dom.suicideButton) dom.suicideButton.addEventListener('click', async () => {
            if (gameState.isRequesting) return;
            const suicideMsg = {
                wuxia: '你確定要了卻此生，讓名號永載史冊嗎？',
                school: '你確定要放棄這段校園生活嗎？',
                mecha: '你確定要終止同調，讓律體永遠沉睡嗎？',
                animal: '你確定要放棄這副獸軀嗎？',
                modern: '你確定要在這個錯頻的世界中消逝嗎？',
                hero: '你確定要放棄異能，從這個世界退場嗎？',
            };
            const loadingMsg = {
                wuxia: '英雄末路，傳奇落幕...',
                school: '校園生活的最後一頁...',
                mecha: '同調信號逐漸歸零...',
                animal: '靈魂從獸軀中抽離...',
                modern: '你的身影在城市中淡去...',
                hero: '共情連結斷裂中...',
            };
            const scnId = window.__activeScenario?.id || 'wuxia';
            if (window.confirm(suicideMsg[scnId] || suicideMsg.wuxia)) {
                gameLoop.setLoading(true, loadingMsg[scnId] || loadingMsg.wuxia);
                try {
                    // 死因 + 結局並行呼叫（速度快一倍）
                    const [deathData, epilogueData] = await Promise.all([
                        api.forceSuicide({ model: dom.aiModelSelector.value }),
                        api.getEpilogue().catch(() => ({ epilogue: null })),
                    ]);
                    gameLoop.processNewRoundData(deathData);
                    gameLoop.handlePlayerDeath(epilogueData);
                } catch (error) {
                    handleApiError(error);
                    gameLoop.setLoading(false);
                }
            }
        });


        // 結局彈窗「重新開始」按鈕 — 加 confirm 提醒
        const epilogueRestartBtn = document.getElementById('epilogue-restart-btn');
        if (epilogueRestartBtn) {
            epilogueRestartBtn.addEventListener('click', async () => {
                const epilogueStory = document.getElementById('epilogue-story');
                const isStillLoading = epilogueStory?.querySelector('.epilogue-loading');
                if (isStillLoading) {
                    if (!confirm('結局回顧還在載入中！\n確定要跳過嗎？你可能會錯過 AI 為你撰寫的精彩結局。')) return;
                } else {
                    if (!confirm('確定要重新開始嗎？\n（你可以先把結局截圖留念）')) return;
                }
                // 刪除死亡存檔再重新載入
                try {
                    const pid = localStorage.getItem('wenjiang_active_profile');
                    if (pid) {
                        await clientDB.resetProfile(pid);
                        await clientDB.profiles.delete(pid);
                        localStorage.removeItem('wenjiang_active_profile');
                    }
                } catch {}
                window.location.reload();
            });
        }

        initializeGmPanel(dom.gmPanel, dom.gmCloseBtn, dom.gmMenu, dom.gmContent);

        if (dom.submitButton) dom.submitButton.addEventListener('click', () => gameLoop.handlePlayerAction());
        if (dom.playerInput) dom.playerInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); gameLoop.handlePlayerAction(); } });

        // 選項按鈕點擊 → 直接送出（附帶善惡值）
        if (dom.actionOptionButtons) {
            dom.actionOptionButtons.forEach((btn, idx) => {
                btn.addEventListener('click', () => {
                    const textEl = btn.querySelector('.option-text');
                    const text = textEl ? textEl.textContent : btn.textContent;
                    if (text && !gameState.isRequesting) {
                        const morality = (gameState.currentActionMorality || [])[idx] || 0;
                        gameLoop.handlePlayerAction(text, morality);
                    }
                });
            });
        }

        // 字數計數器
        if (dom.playerInput && dom.charCounter) {
            dom.playerInput.addEventListener('input', () => {
                const len = dom.playerInput.value.length;
                dom.charCounter.textContent = `${len}/10`;
                dom.charCounter.classList.toggle('char-counter-warning', len >= 9);
                dom.charCounter.classList.toggle('char-counter-full', len >= 10);
            });
        }


        setGameContainerHeight();
        window.addEventListener('resize', setGameContainerHeight);

        gameLoop.loadInitialGame();
    }

    initialize();
});
