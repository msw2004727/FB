// scripts/gmManager.js
import { api } from './api.js';

// --- 【新增】物品生成頁面渲染函式 ---
function loadItemSpawnerData(page) {
    page.innerHTML = `
        <h3><i class="fa-solid fa-box-archive"></i> 物品模板生成</h3>
        <div class="gm-form-section">
            <h4><i class="fa-solid fa-lightbulb"></i> AI 創世</h4>
            <p class="gm-note">輸入一個物品的名稱，AI將會為其生成一套完整的屬性、外觀和背景故事，並將其加入遊戲的公用模板庫中。如果該物品已存在，則不會重複創建。</p>
            <div class="gm-input-group">
                <label for="gm-new-item-name">物品名稱</label>
                <input type="text" id="gm-new-item-name" class="gm-input" placeholder="例如：玄鐵重劍、九轉還魂丹...">
                <button id="gm-create-item-btn" class="gm-button rebuild"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成</button>
            </div>
        </div>
    `;
    document.getElementById('gm-create-item-btn').addEventListener('click', gmHandleCreateItem);
}

// --- 【新增】NPC生成頁面渲染函式 ---
function loadNpcCreatorData(page) {
    page.innerHTML = `
        <h3><i class="fa-solid fa-user-plus"></i> 創建新人物</h3>
        <div class="gm-form-section">
            <h4><i class="fa-solid fa-hat-wizard"></i> AI 捏臉</h4>
            <p class="gm-note">輸入一個您想創建的人物姓名，AI將會為其生成獨特的背景故事、個性、人際關係等，並將其加入遊戲世界的公用角色池中，未來可在故事中登場。</p>
            <div class="gm-input-group">
                <label for="gm-new-npc-name">人物姓名</label>
                <input type="text" id="gm-new-npc-name" class="gm-input" placeholder="例如：東方未明、沈湘芸...">
                <button id="gm-create-npc-btn" class="gm-button rebuild"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成</button>
            </div>
        </div>
    `;
    document.getElementById('gm-create-npc-btn').addEventListener('click', gmHandleCreateNpc);
}


// --- 玩家屬性頁面 ---
async function loadPlayerStatsData(page) {
    page.innerHTML = '<h3><i class="fa-solid fa-user-pen"></i> 玩家屬性編輯</h3><p class="loading-text">正在載入數據...</p>';
    try {
        const [playerState, itemTemplates] = await Promise.all([
            api.getPlayerStateForGM(),
            api.getItemTemplatesForGM()
        ]);
        
        let optionsHtml = '<option value="">-- 請選擇物品 --</option>';
        itemTemplates.forEach(item => {
            optionsHtml += `<option value="${item.itemName}">${item.itemName}</option>`;
        });

        page.innerHTML = `
            <h3><i class="fa-solid fa-user-pen"></i> 玩家屬性編輯</h3>
            <div class="gm-form-section">
                <h4><i class="fa-solid fa-user-ninja"></i> 核心屬性</h4>
                <div class="gm-grid-container stat-grid">
                    <div class="gm-input-group">
                        <label for="gm-internal">內功</label>
                        <input type="number" id="gm-internal" class="gm-input" value="${playerState.internalPower}">
                    </div>
                     <div class="gm-input-group">
                        <label for="gm-external">外功</label>
                        <input type="number" id="gm-external" class="gm-input" value="${playerState.externalPower}">
                    </div>
                     <div class="gm-input-group">
                        <label for="gm-lightness">輕功</label>
                        <input type="number" id="gm-lightness" class="gm-input" value="${playerState.lightness}">
                    </div>
                     <div class="gm-input-group">
                        <label for="gm-morality">立場</label>
                        <input type="number" id="gm-morality" class="gm-input" value="${playerState.morality}">
                    </div>
                </div>
                 <button id="gm-save-stats" class="gm-button save"><i class="fa-solid fa-floppy-disk"></i> 儲存核心屬性</button>
            </div>
            <div class="gm-form-section">
                <h4><i class="fa-solid fa-coins"></i> 金錢修改</h4>
                <div class="gm-input-group">
                    <label for="gm-money">持有金錢</label>
                    <input type="number" id="gm-money" class="gm-input" value="${playerState.money}">
                    <button id="gm-save-money" class="gm-button save">設定</button>
                </div>
            </div>
            <div class="gm-form-section">
                <h4><i class="fa-solid fa-box-archive"></i> 物品增減</h4>
                <div class="gm-input-group">
                    <label for="gm-item-select">選擇物品</label>
                    <select id="gm-item-select" class="gm-select">${optionsHtml}</select>
                    <input type="number" id="gm-item-quantity" class="gm-input" value="1" min="1">
                    <div class="gm-button-group">
                        <button id="gm-add-item" class="gm-button save">增加</button>
                        <button id="gm-remove-item" class="gm-button" style="background-color:#e03131;">移除</button>
                    </div>
                </div>
            </div>
        `;
        
        document.getElementById('gm-save-stats').addEventListener('click', gmSavePlayerStats);
        document.getElementById('gm-save-money').addEventListener('click', gmSavePlayerMoney);
        document.getElementById('gm-add-item').addEventListener('click', () => gmHandleItemChange('add'));
        document.getElementById('gm-remove-item').addEventListener('click', () => gmHandleItemChange('remove'));

    } catch (error) {
         page.innerHTML = `<h3>玩家屬性編輯</h3><p class="error-message">載入數據失敗: ${error.message}</p>`;
    }
}

// --- 地區編輯頁面 ---
async function loadLocationManagementData(page) {
    page.innerHTML = '<h3><i class="fa-solid fa-map-location-dot"></i> 地區編輯與瞬移</h3><p class="loading-text">正在從後端獲取地區列表...</p>';
    try {
        const locList = await api.getLocationsForGM();
        let optionsHtml = '<option value="">-- 請選擇目標地點 --</option>';
        locList.forEach(loc => {
            optionsHtml += `<option value="${loc.name}">${loc.name}</option>`;
        });

        page.innerHTML = `
             <h3><i class="fa-solid fa-map-location-dot"></i> 地區編輯與瞬移</h3>
            <div class="gm-form-section">
                 <h4><i class="fa-solid fa-person-falling-burst"></i> 乾坤大挪移</h4>
                 <div class="gm-input-group">
                    <label for="gm-location-select">選擇地點</label>
                    <select id="gm-location-select" class="gm-select">${optionsHtml}</select>
                     <input type="text" id="gm-new-location-name" class="gm-input" placeholder="或手動輸入新地點名稱...">
                    <button id="gm-teleport-btn" class="gm-button save"><i class="fa-solid fa-bolt"></i> 瞬移</button>
                </div>
                <p class="gm-note">注意：瞬移後，遊戲將會自動存檔，建議您在操作後重新載入遊戲頁面以同步最新狀態。</p>
            </div>
            <div class="gm-grid-container" id="gm-location-grid">
            </div>
        `;
        
        const gridContainer = document.getElementById('gm-location-grid');
        locList.forEach(loc => {
            const card = document.createElement('div');
            card.className = 'gm-control-card';
            let cardBody;
             if (loc.isGhost) {
                cardBody = `
                    <div class="gm-card-header"><h4>${loc.name}</h4><span class="gm-status-tag ghost"><i class="fa-solid fa-map-pin"></i> 未知地區</span></div>
                    <div class="gm-card-body"><p style="font-size: 0.9rem; color: #a0a0c0; text-align: center; flex-grow: 1;">此地區存在於存檔中，但沒有詳細檔案。請重建檔案以進行管理。</p><button class="gm-button rebuild" data-location-name="${loc.name}"><i class="fa-solid fa-map-location-dot"></i> 重建檔案</button></div>
                `;
            } else {
                cardBody = `
                    <div class="gm-card-header"><h4>${loc.name}</h4></div>
                    <div class="gm-card-body"><p style="font-size: 0.9rem; color: #a0a0c0; text-align: center; flex-grow: 1;">詳細編輯功能開發中...</p></div>
                    <button class="gm-button save" disabled><i class="fa-solid fa-pen-to-square"></i> 編輯</button>
                `;
            }
            card.innerHTML = cardBody;
            gridContainer.appendChild(card);
        });
        
        bindGmCardEvents(gridContainer);
        document.getElementById('gm-teleport-btn').addEventListener('click', gmTeleport);

    } catch (error) {
        page.innerHTML = `<h3>地區編輯</h3><p class="error-message">獲取資料失敗: ${error.message}</p>`;
    }
}

// --- NPC管理頁面 ---
async function loadNpcManagementData(page) {
    page.innerHTML = '<h3><i class="fa-solid fa-users-gear"></i> NPC關係管理</h3><p class="loading-text">正在獲取人物數據...</p>';
    try {
        const [npcList, characterList] = await Promise.all([
            api.getNpcsForGM(),
            api.getCharactersForGM()
        ]);

        const container = document.createElement('div');
        container.className = 'gm-grid-container';

        if (npcList.length === 0) {
            page.innerHTML = '<h3>NPC關係管理</h3><p>資料庫中尚無任何NPC檔案。</p>';
            return;
        }

        const characterOptionsHtml = characterList.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

        npcList.forEach(npc => {
            const card = document.createElement('div');
            card.className = 'gm-control-card';
            let cardBody;

            if (npc.isGhost) {
                cardBody = `<div class="gm-card-header"><h4>${npc.name}</h4><span class="gm-status-tag ghost"><i class="fa-solid fa-ghost"></i> 黑戶檔案</span></div><div class="gm-card-body"><p class="gm-note">此NPC存在於存檔中，但沒有詳細檔案。</p><button class="gm-button rebuild" data-npc-name="${npc.name}"><i class="fa-solid fa-user-check"></i> 重建檔案</button></div>`;
            } else {
                let avatarHtml = '';
                if (npc.avatarUrl) {
                    avatarHtml = `<img src="${npc.avatarUrl}" alt="${npc.name}" class="gm-npc-avatar">`;
                } else {
                    avatarHtml = `<div class="gm-npc-avatar-placeholder">${npc.name.charAt(0)}</div>`;
                }

                cardBody = `
                    <div class="gm-card-header">
                        ${avatarHtml}
                        <h4>${npc.name}</h4>
                    </div>
                    <div class="gm-card-body">
                        <div class="gm-control-group"><label><span>友好度</span><span class="value-display" id="friend-val-${npc.id}">${npc.friendlinessValue}</span></label><input type="range" class="gm-slider" id="friend-slider-${npc.id}" min="-100" max="100" value="${npc.friendlinessValue}"></div>
                        <div class="gm-control-group"><label><span>心動值</span><span class="value-display" id="romance-val-${npc.id}">${npc.romanceValue}</span></label><input type="range" class="gm-slider" id="romance-slider-${npc.id}" min="0" max="100" value="${npc.romanceValue}"></div>
                        <div class="gm-control-group relationship-group">
                            <label><span>設定關係</span></label>
                            <div class="relationship-inputs">
                                <select class="gm-select rel-type" id="rel-type-${npc.id}">
                                    <option value="lover">戀人</option>
                                    <option value="spouse">夫妻</option>
                                    <option value="parent">父母</option>
                                    <option value="child">子女</option>
                                    <option value="sibling">兄弟姊妹</option>
                                    <option value="master">師父</option>
                                    <option value="apprentice">徒弟</option>
                                </select>
                                <select class="gm-select rel-target" id="rel-target-${npc.id}">
                                    <option value="">-- 解除關係 --</option>
                                    ${characterOptionsHtml}
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="gm-button-group">
                        <button class="gm-button save" data-npc-id="${npc.id}"><i class="fa-solid fa-floppy-disk"></i> 儲存變更</button>
                        <button class="gm-button generate-avatar" data-npc-name="${npc.id}"><i class="fa-solid fa-palette"></i> 繪製肖像</button>
                    </div>
                `;
            }
            card.innerHTML = cardBody;
            
            setTimeout(() => {
                if (!npc.isGhost && npc.relationships) {
                    const relTypeSelect = card.querySelector(`#rel-type-${npc.id}`);
                    const relTargetSelect = card.querySelector(`#rel-target-${npc.id}`);
                    
                    const relType = Object.keys(npc.relationships)[0];
                    if (relType) {
                        const targetName = npc.relationships[relType];
                        relTypeSelect.value = relType;
                        relTargetSelect.value = targetName;
                    }
                }
            }, 0);

            container.appendChild(card);
        });

        page.innerHTML = '<h3><i class="fa-solid fa-users-gear"></i> NPC關係管理</h3>';
        page.appendChild(container);
        
        bindGmCardEvents(container);

    } catch (error) {
        page.innerHTML = `<h3>NPC關係管理</h3><p class="error-message">獲取資料失敗: ${error.message}</p>`;
    }
}


// --- 事件處理函式 ---

async function gmHandleGenerateAvatar(e) {
    const button = e.target.closest('button');
    const npcName = button.dataset.npcName;
    if (!npcName) return;

    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 繪製中...`;
    button.disabled = true;

    try {
        const result = await api.generateNpcAvatar(npcName);
        alert(result.message);
        loadPageContent('npc-management');
    } catch (error) {
        alert(`繪製失敗: ${error.message}`);
        button.innerHTML = `<i class="fa-solid fa-palette"></i> 繪製肖像`;
        button.disabled = false;
    }
}

async function gmSavePlayerStats(e) {
    const button = e.target.closest('button');
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 儲存中...`;
    button.disabled = true;
    try {
        const payload = {
            internalPower: document.getElementById('gm-internal').value,
            externalPower: document.getElementById('gm-external').value,
            lightness: document.getElementById('gm-lightness').value,
            morality: document.getElementById('gm-morality').value
        };
        const result = await api.updatePlayerStateForGM(payload);
        alert(result.message);
        button.innerHTML = `<i class="fa-solid fa-check"></i> 儲存成功!`;
    } catch (error) {
        alert(`儲存失敗: ${error.message}`);
        button.innerHTML = `<i class="fa-solid fa-xmark"></i> 儲存失敗`;
    } finally {
        setTimeout(() => {
            button.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> 儲存核心屬性`;
            button.disabled = false;
        }, 2000);
    }
}

async function gmSavePlayerMoney(e) {
    const button = e.target.closest('button');
    const money = document.getElementById('gm-money').value;
    if (money === '' || isNaN(money)) { alert('請輸入有效的數字'); return; }

    button.textContent = '設定中...';
    button.disabled = true;
    try {
        const result = await api.updatePlayerResourcesForGM({ money: Number(money) });
        alert(result.message);
        button.textContent = '設定成功!';
    } catch (error) {
        alert(`設定失敗: ${error.message}`);
        button.textContent = '錯誤';
    } finally {
        setTimeout(() => { button.textContent = '設定'; button.disabled = false; }, 2000);
    }
}

async function gmHandleItemChange(action) {
    const itemName = document.getElementById('gm-item-select').value;
    const quantity = document.getElementById('gm-item-quantity').value;
    if (!itemName) { alert('請選擇一個物品'); return; }
    if (!quantity || isNaN(quantity) || Number(quantity) <= 0) { alert('請輸入有效的數量'); return; }

    const buttonId = action === 'add' ? 'gm-add-item' : 'gm-remove-item';
    const button = document.getElementById(buttonId);
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 處理中...`;
    button.disabled = true;

    try {
        const result = await api.updatePlayerResourcesForGM({
            itemChange: { action, itemName, quantity: Number(quantity) }
        });
        alert(result.message);
        button.innerHTML = `<i class="fa-solid fa-check"></i> 操作成功!`;
    } catch (error) {
        alert(`操作失敗: ${error.message}`);
        button.innerHTML = `<i class="fa-solid fa-xmark"></i> 錯誤`;
    } finally {
        setTimeout(() => { 
            button.innerHTML = action === 'add' ? '增加' : '移除';
            button.disabled = false; 
        }, 2000);
    }
}

async function gmTeleport(e) {
    const button = e.target.closest('button');
    const locationName = document.getElementById('gm-new-location-name').value.trim() || document.getElementById('gm-location-select').value;
    if (!locationName) {
        alert('請選擇或輸入一個目標地點！');
        return;
    }

    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 正在傳送...`;
    button.disabled = true;
    try {
        const result = await api.teleportPlayer({ locationName });
        button.innerHTML = `<i class="fa-solid fa-check"></i> ${result.message}`;
         setTimeout(() => {
            alert('瞬移成功！建議您重新載入遊戲以確保所有狀態同步。');
            window.location.reload();
        }, 1000);
    } catch (error) {
        button.innerHTML = `<i class="fa-solid fa-xmark"></i> 傳送失敗`;
        alert(`傳送失敗: ${error.message}`);
    } finally {
         setTimeout(() => {
            button.innerHTML = `<i class="fa-solid fa-bolt"></i> 瞬移`;
            button.disabled = false;
        }, 3000);
    }
}

function bindGmCardEvents(container) {
    container.querySelectorAll('.gm-button.save').forEach(button => {
        button.addEventListener('click', async (e) => {
            const cardButton = e.target.closest('button');
            const npcId = cardButton.dataset.npcId;
            if (!npcId) return;

            cardButton.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 儲存中...`;
            cardButton.disabled = true;
            
            try {
                const promises = [];
                
                const friendliness = document.getElementById(`friend-slider-${npcId}`).value;
                const romance = document.getElementById(`romance-slider-${npcId}`).value;
                promises.push(api.updateNpcForGM({ npcId, friendlinessValue: friendliness, romanceValue: romance }));

                const relType = document.getElementById(`rel-type-${npcId}`).value;
                const relTarget = document.getElementById(`rel-target-${npcId}`).value;
                promises.push(api.updateNpcRelationship({ npcId, relationshipType: relType, targetName: relTarget }));
                
                const results = await Promise.all(promises);
                cardButton.innerHTML = `<i class="fa-solid fa-check"></i> 儲存成功`;
                alert(results.map(r => r.message).join('\n'));

            } catch (error) {
                cardButton.innerHTML = `<i class="fa-solid fa-xmark"></i> 儲存失敗`;
                alert(`儲存失敗: ${error.message}`);
            } finally {
                setTimeout(() => {
                   cardButton.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> 儲存所有變更`;
                   cardButton.disabled = false;
                }, 2000);
            }
        });
    });

    container.querySelectorAll('.gm-button.rebuild').forEach(button => {
        button.addEventListener('click', async (e) => {
            const cardButton = e.target.closest('button');
            cardButton.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 重建中...`;
            cardButton.disabled = true;
            try {
                let result;
                if (cardButton.dataset.npcName) {
                    result = await api.rebuildNpcForGM({ npcName: cardButton.dataset.npcName });
                } else if (cardButton.dataset.locationName) {
                    result = await api.rebuildLocationForGM({ locationName: cardButton.dataset.locationName });
                }
                alert(result.message);
                cardButton.innerHTML = `<i class="fa-solid fa-check"></i> ${result.message}`;
            } catch (error) {
                 cardButton.innerHTML = `<i class="fa-solid fa-xmark"></i> 錯誤`;
                 alert(`重建失敗: ${error.message}`);
            } finally {
                 setTimeout(() => {
                    const activeMenu = document.querySelector('#gm-menu a.active');
                    if(activeMenu) {
                       const pageId = activeMenu.getAttribute('href').substring(1);
                       loadPageContent(pageId);
                    }
                 }, 2000);
            }
        });
    });
    
    container.querySelectorAll('.gm-button.generate-avatar').forEach(button => {
        button.addEventListener('click', gmHandleGenerateAvatar);
    });
}

async function gmHandleCreateItem(e) {
    const button = e.target.closest('button');
    const itemName = document.getElementById('gm-new-item-name').value.trim();
    if (!itemName) {
        alert('請輸入物品名稱！');
        return;
    }
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 生成中...`;
    button.disabled = true;
    try {
        const result = await api.gmCreateItemTemplate({ itemName });
        alert(result.message);
        document.getElementById('gm-new-item-name').value = '';
    } catch (error) {
        alert(`生成失敗: ${error.message}`);
    } finally {
        button.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成`;
        button.disabled = false;
    }
}

async function gmHandleCreateNpc(e) {
    const button = e.target.closest('button');
    const npcName = document.getElementById('gm-new-npc-name').value.trim();
    if (!npcName) {
        alert('請輸入人物姓名！');
        return;
    }
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 生成中...`;
    button.disabled = true;
    try {
        const result = await api.gmCreateNpcTemplate({ npcName });
        alert(result.message);
        document.getElementById('gm-new-npc-name').value = '';
    } catch (error) {
        alert(`生成失敗: ${error.message}`);
    } finally {
        button.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成`;
        button.disabled = false;
    }
}


// --- 頁面載入與初始化 ---

const pageLoaders = {
    'player-stats': loadPlayerStatsData,
    'npc-management': loadNpcManagementData,
    'location-editor': loadLocationManagementData,
    'item-spawner': loadItemSpawnerData,
    'npc-creator': loadNpcCreatorData,
};

function loadPageContent(pageId) {
    const targetPage = document.getElementById(`page-${pageId}`);
    const loader = pageLoaders[pageId];
    if (targetPage && loader) {
        loader(targetPage);
    }
}

export function initializeGmPanel(gmPanel, gmCloseBtn, gmMenu, gmContent) {
    if (!gmPanel || !gmCloseBtn || !gmMenu || !gmContent) return;

    gmCloseBtn.addEventListener('click', () => gmPanel.classList.remove('visible'));
    
    gmPanel.addEventListener('click', (e) => {
        if (e.target === gmPanel) {
            gmPanel.classList.remove('visible');
        }
    });

    gmMenu.addEventListener('click', (e) => {
        e.preventDefault();
        const link = e.target.closest('a');
        if (!link) return;

        gmMenu.querySelectorAll('a').forEach(a => a.classList.remove('active'));
        link.classList.add('active');

        const targetPageId = link.getAttribute('href').substring(1);
        
        gmContent.querySelectorAll('.gm-page').forEach(page => page.style.display = 'none');
        
        const targetPage = document.getElementById(`page-${targetPageId}`);
        if (targetPage) {
            targetPage.style.display = 'block';
            loadPageContent(targetPageId);
        }
    });
}
