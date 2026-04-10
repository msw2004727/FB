// scripts/main.js

import * as gameLoop from './gameLoop.js';
import * as interaction from './interactionHandlers.js';
import * as modal from './modalManager.js';
import { initializeGmPanel } from './gmManager.js';
import { gameState } from './gameState.js';
import { initializeDOM, dom } from './dom.js';
import { api } from './api.js';
import { handleApiError, appendMessageToStory } from './uiUpdater.js';
import { restoreAiModelSelection, setStoredAiModel, needsUserApiKey, getStoredApiKey, setStoredApiKey, AI_MODEL_INFO } from './aiModelPreference.js';
import clientDB from '../client/db/clientDB.js';
import * as gameEngine from '../client/engine/gameEngine.js';
import { exportSave, importSave, shouldRemindBackup, markBackupReminded, isIOSSafari } from '../client/utils/exportImport.js';


interaction.setGameLoop(gameLoop);

document.addEventListener('DOMContentLoaded', async () => {
    // 初始化 IndexedDB
    await clientDB.init();

    // 註冊 Service Worker (PWA)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(err => {
            console.warn('[SW] Service Worker 註冊失敗:', err);
        });
    }

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
        dom.apikeyModalTitle.textContent = `設定 ${info.name} API Key`;
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

    const username = activeProfile.username;
    if (dom.playerInput && username) {
        dom.playerInput.placeholder = `${username}接下來...`;
    } else if (dom.playerInput) {
        dom.playerInput.placeholder = '接下來...';
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
        // ... (initialize 函式中的其他事件綁定保持不變) ...
        let currentTheme = localStorage.getItem('game_theme') || 'light';
        const themeIcon = dom.themeSwitcher.querySelector('i');
        document.body.className = `${currentTheme}-theme`;
        themeIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';

        dom.themeSwitcher.addEventListener('click', () => {
            currentTheme = (document.body.classList.contains('light-theme')) ? 'dark' : 'light';
            localStorage.setItem('game_theme', currentTheme);
            document.body.className = `${currentTheme}-theme`;
            themeIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        });

        dom.headerToggleButton.addEventListener('click', () => {
            const isCollapsed = dom.storyHeader.classList.toggle('collapsed');
            dom.headerToggleButton.setAttribute('aria-expanded', String(!isCollapsed));
            dom.headerToggleButton.title = isCollapsed ? '展開資訊欄' : '收起資訊欄';
            dom.headerToggleButton.setAttribute('aria-label', isCollapsed ? '展開日期與時辰資訊欄' : '收起日期與時辰資訊欄');
        });

        const menuToggleIcon = dom.menuToggle?.querySelector('i');
        const setSidebarOpenState = (isOpen) => {
            dom.gameContainer.classList.toggle('sidebar-open', isOpen);
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
        setSidebarOpenState(dom.gameContainer.classList.contains('sidebar-open'));

        dom.menuToggle.addEventListener('click', () => {
            const willOpen = !dom.gameContainer.classList.contains('sidebar-open');
            setSidebarOpenState(willOpen);
        });

        dom.mainContent.addEventListener('click', (e) => {
            if (e.target !== dom.mainContent) return;
            if (window.innerWidth <= 1024 && dom.gameContainer.classList.contains('sidebar-open')) {
                setSidebarOpenState(false);
            }
        });

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

        dom.suicideButton.addEventListener('click', async () => {
            interaction.hideNpcInteractionMenu();
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


        document.addEventListener('click', (e) => {
            const locationBtn = e.target.closest('#view-location-details-btn');
            if (locationBtn) {
                if (gameState.currentLocationData) {
                    modal.openLocationDetailsModal(gameState.currentLocationData);
                } else {
                    alert("當前地區的詳細情報尚未載入。");
                }
            }
        });

        initializeGmPanel(dom.gmPanel, dom.gmCloseBtn, dom.gmMenu, dom.gmContent);

        dom.submitButton.addEventListener('click', gameLoop.handlePlayerAction);
        dom.playerInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); gameLoop.handlePlayerAction(); } });
        
        document.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'combat-confirm-btn') {
                interaction.handleConfirmCombatAction();
            }
        });

        dom.storyPanel.addEventListener('click', interaction.handleNpcClick);

        dom.chatActionBtn.addEventListener('click', interaction.sendChatMessage);
        dom.chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); interaction.sendChatMessage(); } });
        
        dom.closeChatBtn.addEventListener('click', () => {
             gameState.isInChat = false;
             gameState.currentChatNpc = null;
             gameState.chatHistory = [];
             modal.closeChatModal();
             gameLoop.setLoading(false); 
        });
        dom.endChatBtn.addEventListener('click', interaction.endChatSession);

        if (dom.closeLocationDetailsBtn) {
            dom.closeLocationDetailsBtn.addEventListener('click', modal.closeLocationDetailsModal);
        }
        if (dom.locationDetailsModal) {
            dom.locationDetailsModal.addEventListener('click', (e) => {
                if (e.target === dom.locationDetailsModal) {
                    modal.closeLocationDetailsModal();
                }
            });
        }


        setGameContainerHeight();
        window.addEventListener('resize', setGameContainerHeight);

        gameLoop.loadInitialGame();
    }

    initialize();
});
