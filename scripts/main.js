// scripts/main.js

import * as gameLoop from './gameLoop.js';
import { initializeGmPanel } from './gmManager.js';
import { gameState } from './gameState.js';
import { initializeDOM, dom } from './dom.js';
import { api } from './api.js';
import { handleApiError } from './uiUpdater.js';
import { restoreAiModelSelection, setStoredAiModel, needsUserApiKey, getStoredApiKey, setStoredApiKey, AI_MODEL_INFO } from './aiModelPreference.js';
import clientDB from '../client/db/clientDB.js';
import * as gameEngine from '../client/engine/gameEngine.js';
import { exportSave, importSave, shouldRemindBackup, markBackupReminded, isIOSSafari } from '../client/utils/exportImport.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 初始化 IndexedDB
    await clientDB.init();

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

    // 檢查是否有活躍檔案
    const savedProfileId = localStorage.getItem('wenjiang_active_profile');
    let activeProfile = null;

    if (savedProfileId) {
        activeProfile = await clientDB.profiles.get(savedProfileId);
    }

    if (!activeProfile) {
        // 檢查是否有任何存檔
        const allProfiles = await clientDB.profiles.list();
        if (allProfiles.length > 0) {
            activeProfile = allProfiles[0];
        } else {
            // 第一次遊玩：自動建立新角色
            const result = await gameEngine.createNewGame('無名俠客', '男');
            activeProfile = result.profile;
        }
    }

    // 設定活躍檔案
    gameEngine.setActiveProfile(activeProfile.id);
    localStorage.setItem('wenjiang_active_profile', activeProfile.id);
    localStorage.setItem('username', activeProfile.username);
    // 為了向後相容，設定一個假的 jwt_token
    if (!localStorage.getItem('jwt_token')) {
        localStorage.setItem('jwt_token', 'local-pwa-token');
    }

    initializeDOM();

    // --- API Key 彈窗邏輯 ---
    let _previousModel = null;

    function openApiKeyModal(model) {
        const info = AI_MODEL_INFO[model] || { name: model, hint: '' };
        dom.apikeyModalTitle.textContent = '設定 AI 模型';
        const modelNameEl = document.getElementById('apikey-modal-model-name');
        if (modelNameEl) modelNameEl.textContent = info.name;
        dom.apikeyModalDesc.textContent = info.hint || '請輸入您的 API Key 以啟用此 AI 模型。';
        dom.apikeyInput.value = getStoredApiKey(model) || '';
        dom.apikeyInput.type = 'password';
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

    // 顯示/隱藏密碼
    if (dom.apikeyToggleBtn) {
        dom.apikeyToggleBtn.addEventListener('click', () => {
            const isPassword = dom.apikeyInput.type === 'password';
            dom.apikeyInput.type = isPassword ? 'text' : 'password';
            dom.apikeyToggleBtn.querySelector('i').className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
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
        dom.playerInput.placeholder = '在此輸入文字即可';
    }

    // 備份提醒
    if (shouldRemindBackup()) {
        const iosWarning = isIOSSafari() ? '\n\n⚠️ 您正在使用 iOS Safari，長時間未使用可能導致存檔被系統清除！' : '';
        setTimeout(() => {
            if (confirm(`建議定期匯出存檔以防資料遺失。${iosWarning}\n\n是否現在匯出存檔？`)) {
                exportSave(activeProfile.id).then(filename => {
                    alert(`存檔已匯出: ${filename}`);
                });
            }
            markBackupReminded();
        }, 3000);
    }

    function setGameContainerHeight() {
        if (dom.gameContainer) {
            dom.gameContainer.style.height = `${window.innerHeight}px`;
        }
    }

    function initialize() {
        let currentTheme = localStorage.getItem('game_theme') || 'light';
        document.body.className = `${currentTheme}-theme`;

        if (dom.themeSwitcher) {
            const themeIcon = dom.themeSwitcher.querySelector('i');
            if (themeIcon) themeIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            dom.themeSwitcher.addEventListener('click', () => {
                currentTheme = (document.body.classList.contains('light-theme')) ? 'dark' : 'light';
                localStorage.setItem('game_theme', currentTheme);
                document.body.className = `${currentTheme}-theme`;
                if (themeIcon) themeIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
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

        const menuToggleIcon = dom.menuToggle?.querySelector('i');
        const setSidebarOpenState = (isOpen) => {
            if (dom.gameContainer) dom.gameContainer.classList.toggle('sidebar-open', isOpen);
            if (dom.menuToggle) {
                dom.menuToggle.setAttribute('aria-expanded', String(isOpen));
                dom.menuToggle.title = isOpen ? '收起右側欄' : '展開右側欄';
                dom.menuToggle.setAttribute('aria-label', isOpen ? '收起右側欄' : '展開右側欄');
            }
            if (menuToggleIcon) {
                menuToggleIcon.classList.toggle('fa-bars', !isOpen);
                menuToggleIcon.classList.toggle('fa-xmark', isOpen);
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

        if (dom.suicideButton) dom.suicideButton.addEventListener('click', async () => {
            if (gameState.isRequesting) return;
            if (window.confirm("你確定要了卻此生，讓名號永載史冊嗎？")) {
                gameLoop.setLoading(true, '英雄末路，傳奇落幕...');
                try {
                    const data = await api.forceSuicide({ model: dom.aiModelSelector.value });
                    gameLoop.processNewRoundData(data);
                    gameLoop.handlePlayerDeath();
                } catch (error) {
                    handleApiError(error);
                    gameLoop.setLoading(false);
                }
            }
        });


        initializeGmPanel(dom.gmPanel, dom.gmCloseBtn, dom.gmMenu, dom.gmContent);

        if (dom.submitButton) dom.submitButton.addEventListener('click', () => gameLoop.handlePlayerAction());
        if (dom.playerInput) dom.playerInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); gameLoop.handlePlayerAction(); } });

        // 選項按鈕點擊 → 直接送出
        if (dom.actionOptionButtons) {
            dom.actionOptionButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const text = btn.textContent;
                    if (text && !gameState.isRequesting) {
                        gameLoop.handlePlayerAction(text);
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
