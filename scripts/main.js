// scripts/main.js

import * as gameLoop from './gameLoop.js';
import * as interaction from './interactionHandlers.js';
import * as modal from './modalManager.js';
import { initializeGmPanel } from './gmManager.js';
import { gameState } from './gameState.js';
import { initializeDOM, dom } from './dom.js';
import { api } from './api.js';
import { handleApiError, appendMessageToStory } from './uiUpdater.js';
import { restoreAiModelSelection, setStoredAiModel } from './aiModelPreference.js';
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

    if (dom.aiModelSelector) {
        restoreAiModelSelection(dom.aiModelSelector);
        dom.aiModelSelector.addEventListener('change', () => {
            setStoredAiModel(dom.aiModelSelector.value);
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

    // 【核心修改】重新獲取閉關彈窗的所有元素
    const cultivationModal = document.getElementById('cultivation-modal');
    const openCultivationBtn = document.getElementById('open-cultivation-btn');
    const closeCultivationBtn = document.getElementById('close-cultivation-btn');
    const skillSelect = document.getElementById('cultivation-skill-select');
    const daysInput = document.getElementById('cultivation-days-input'); // 現在是 range slider
    const daysDisplay = document.getElementById('cultivation-days-display'); // 新增的天數顯示標籤
    const startCultivationBtn = document.getElementById('start-cultivation-btn');
    const reqLocation = document.getElementById('req-location');
    const reqStamina = document.getElementById('req-stamina');

    function setGameContainerHeight() {
        if (dom.gameContainer) {
            dom.gameContainer.style.height = `${window.innerHeight}px`;
        }
    }

    // --- 【核心修改 v2.0】閉關系統相關函式 ---
    function updateCultivationConditions() {
        if (!gameState.roundData || !cultivationModal.classList.contains('visible')) return;

        const { currentLocationData, roundData } = gameState;
        const days = parseInt(daysInput.value, 10);

        // 更新天數顯示
        if(daysDisplay) daysDisplay.textContent = `${days} 天`;

        // 條件1: 私密地點
        const isPrivate = currentLocationData?.isPrivate === true;
        reqLocation.innerHTML = `<i class="fas ${isPrivate ? 'fa-check-circle' : 'fa-times-circle'}"></i> 需身處私密地點 (${isPrivate ? '達成' : '未達成'})`;

        // 條件2: 精力
        const staminaSufficient = roundData.stamina >= 80;
        reqStamina.innerHTML = `<i class="fas ${staminaSufficient ? 'fa-check-circle' : 'fa-times-circle'}"></i> 精力需高於80% (${roundData.stamina}%)`;

        // 最終判斷
        startCultivationBtn.disabled = !(isPrivate && staminaSufficient);
    }

    async function openCultivationModal() {
        modal.closeSkillsModal();
        cultivationModal.classList.add('visible');
        skillSelect.innerHTML = '<option>載入武學中...</option>';
        startCultivationBtn.disabled = true;

        try {
            const skills = await api.getSkills();
            if (skills && skills.length > 0) {
                skillSelect.innerHTML = skills.map(s => `<option value="${s.skillName}">${s.skillName} (Lv.${s.level})</option>`).join('');
            } else {
                skillSelect.innerHTML = '<option value="">無任何可修練的武學</option>';
            }
        } catch (error) {
            handleApiError(error);
            skillSelect.innerHTML = '<option value="">讀取武學失敗</option>';
        } finally {
            daysInput.value = 1; // 每次打開時重置為1天
            updateCultivationConditions();
        }
    }
    
    async function handleStartCultivation() {
        if (startCultivationBtn.disabled || gameState.isRequesting) return;

        const skillName = skillSelect.value;
        const days = parseInt(daysInput.value, 10);

        if (!skillName) {
            alert('請選擇一門要修練的武學。');
            return;
        }
        if (!days || days <= 0) {
            alert('請選擇有效的閉關天數。');
            return;
        }

        cultivationModal.classList.remove('visible');
        gameLoop.setLoading(true, `正在閉關修練 ${skillName}，預計耗時${days}日...`);
        
        try {
            const result = await api.startCultivation({ skillName, days, model: dom.aiModelSelector?.value });
            if (result.success) {
                gameLoop.processNewRoundData(result);
            } else {
                throw new Error(result.message);
            }
        } catch (error) {
            handleApiError(error);
        } finally {
            gameLoop.setLoading(false);
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

        dom.logoutButton.addEventListener('click', async () => {
            const choice = prompt(
                '存檔管理：\n1 = 匯出存檔\n2 = 匯入存檔\n3 = 新建角色\n4 = 切換存檔\n\n請輸入數字：'
            );
            if (choice === '1') {
                try {
                    const filename = await exportSave(gameEngine.getActiveProfileId());
                    alert(`存檔已匯出: ${filename}`);
                } catch (e) { alert('匯出失敗: ' + e.message); }
            } else if (choice === '2') {
                try {
                    const profileId = await importSave();
                    gameEngine.setActiveProfile(profileId);
                    localStorage.setItem('wenjiang_active_profile', profileId);
                    window.location.reload();
                } catch (e) { alert('匯入失敗: ' + e.message); }
            } else if (choice === '3') {
                const name = prompt('角色名稱：');
                if (name) {
                    const gender = prompt('性別（男/女）：') || '男';
                    const result = await gameEngine.createNewGame(name, gender);
                    gameEngine.setActiveProfile(result.profile.id);
                    localStorage.setItem('wenjiang_active_profile', result.profile.id);
                    localStorage.setItem('username', name);
                    window.location.reload();
                }
            } else if (choice === '4') {
                const profiles = await clientDB.profiles.list();
                if (profiles.length <= 1) { alert('目前只有一個存檔。'); return; }
                const list = profiles.map((p, i) => `${i + 1}. ${p.username} (${p.isDeceased ? '已故' : '存活'})`).join('\n');
                const idx = parseInt(prompt(`選擇存檔：\n${list}\n\n請輸入數字：`));
                if (idx >= 1 && idx <= profiles.length) {
                    const selected = profiles[idx - 1];
                    gameEngine.setActiveProfile(selected.id);
                    localStorage.setItem('wenjiang_active_profile', selected.id);
                    localStorage.setItem('username', selected.username);
                    window.location.reload();
                }
            }
        });

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

        if (dom.skillsBtn) {
            dom.skillsBtn.addEventListener('click', async () => {
                interaction.hideNpcInteractionMenu();
                if (gameState.isRequesting) return;
                gameLoop.setLoading(true, '獲取武學資料...');
                try {
                    const skills = await api.getSkills();
                    modal.openSkillsModal(skills);
                } catch (error) {
                    handleApiError(error);
                } finally {
                    gameLoop.setLoading(false);
                }
            });
        }

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

        dom.closeSkillsBtn.addEventListener('click', modal.closeSkillsModal);

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

        // --- 【核心修改 v2.0】為閉關系統綁定事件 ---
        if (openCultivationBtn) openCultivationBtn.addEventListener('click', openCultivationModal);
        if (closeCultivationBtn) closeCultivationBtn.addEventListener('click', () => cultivationModal.classList.remove('visible'));
        if (skillSelect) skillSelect.addEventListener('change', updateCultivationConditions);
        if (daysInput) { // 現在監聽 slider 的 input 事件
            daysInput.addEventListener('input', updateCultivationConditions);
        }
        if (startCultivationBtn) startCultivationBtn.addEventListener('click', handleStartCultivation);

        setGameContainerHeight();
        window.addEventListener('resize', setGameContainerHeight);

        gameLoop.loadInitialGame();
    }

    initialize();
});
