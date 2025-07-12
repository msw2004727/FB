// scripts/tradeManager.js
import { api } from './api.js';

// 全域變數，用於儲存當前交易的狀態
let state = {};
let onTradeCompleteCallback = null;
let currentNpcName = '';

// DOM 元素快取
const DOMElements = {};
let areDOMsCached = false; // 添加一個標誌來判斷是否已快取

/**
 * 【核心修正】首次獲取或更新DOM元素引用
 * 只在第一次初始化時執行
 */
function cacheDOMElements() {
    if (areDOMsCached) return;
    DOMElements.playerInventory = document.querySelector('#trade-player-inventory');
    DOMElements.playerOffer = document.querySelector('#trade-player-offer');
    DOMElements.npcInventory = document.querySelector('#trade-npc-inventory');
    DOMElements.npcOffer = document.querySelector('#trade-npc-offer');
    DOMElements.playerMoney = document.getElementById('trade-player-money');
    DOMElements.npcMoney = document.getElementById('trade-npc-money');
    DOMElements.npcHeaderName = document.getElementById('trade-npc-header-name');
    DOMElements.npcNameDisplay = document.getElementById('trade-npc-name');
    DOMElements.valueDiff = document.getElementById('trade-value-diff');
    DOMElements.confirmBtn = document.getElementById('confirm-trade-btn');
    DOMElements.playerPanel = document.getElementById('trade-player-panel');
    DOMElements.npcPanel = document.getElementById('trade-npc-panel');
    DOMElements.playerOfferPanel = document.getElementById('trade-player-offer-panel');
    DOMElements.npcOfferPanel = document.getElementById('trade-npc-offer-panel');
    areDOMsCached = true;
}

/**
 * 渲染整個交易介面
 */
function render() {
    if (!DOMElements.playerInventory) return; // 如果元素不存在則不執行

    // 渲染玩家和NPC的背包與出價區
    ['player', 'npc'].forEach(owner => {
        const inventoryEl = DOMElements[`${owner}Inventory`];
        const offerEl = DOMElements[`${owner}Offer`];
        inventoryEl.innerHTML = '';
        offerEl.innerHTML = '';
        state[owner].inventory.forEach(item => inventoryEl.appendChild(createItemElement(item, owner, 'inventory')));
        state[owner].offer.items.forEach(item => offerEl.appendChild(createItemElement(item, owner, 'offer')));
    });

    // 更新介面上的文字資訊
    DOMElements.playerMoney.textContent = state.player.money;
    DOMElements.npcMoney.textContent = state.npc.money;
    DOMElements.npcHeaderName.textContent = currentNpcName;
    DOMElements.npcNameDisplay.textContent = `${currentNpcName} 的出價`;
    
    calculateSummary();
}

/**
 * 創建單個物品的HTML元素
 * @param {object} item - 物品資料
 * @param {string} owner - 擁有者 ('player' or 'npc')
 * @param {string} area - 當前區域 ('inventory' or 'offer')
 * @returns {HTMLLIElement}
 */
function createItemElement(item, owner, area) {
    const li = document.createElement('li');
    li.className = 'bg-amber-50/50 border border-amber-200 p-1.5 rounded-md cursor-pointer flex justify-between items-center text-sm hover:border-amber-400 hover:bg-amber-50 transform hover:-translate-y-px transition-all';
    li.title = item.description || item.baseDescription || '一個神秘的物品';
    li.innerHTML = `<span class="font-semibold text-amber-900">${item.itemName}</span> <span class="text-xs text-amber-700">價:${item.value || 0}</span>`;
    li.addEventListener('click', () => moveItem(item.instanceId || item.templateId, owner, area));
    return li;
}

/**
 * 移動物品的邏輯
 * @param {string} itemId - 物品的唯一ID
 * @param {string} owner - 擁有者
 * @param {string} currentArea - 當前區域
 */
function moveItem(itemId, owner, currentArea) {
    const sourceList = currentArea === 'inventory' ? state[owner].inventory : state[owner].offer.items;
    const targetList = currentArea === 'inventory' ? state[owner].offer.items : state[owner].inventory;
    
    const itemIndex = sourceList.findIndex(i => (i.instanceId || i.templateId) === itemId);
    
    if (itemIndex > -1) {
        const [item] = sourceList.splice(itemIndex, 1);
        targetList.push(item);
        render();
    }
}

/**
 * 計算價值差並更新UI
 */
function calculateSummary() {
    if (!DOMElements.valueDiff) return;

    const playerOfferValue = state.player.offer.items.reduce((sum, item) => sum + (item.value || 0), 0);
    const npcOfferValue = state.npc.offer.items.reduce((sum, item) => sum + (item.value || 0), 0);
    const diff = playerOfferValue - npcOfferValue;

    DOMElements.valueDiff.textContent = diff;
    
    // 重置樣式和光暈
    DOMElements.valueDiff.classList.remove('text-green-400', 'text-red-400');
    DOMElements.playerPanel.classList.remove('glow-negative');
    DOMElements.npcPanel.classList.remove('glow-positive');
    DOMElements.playerOfferPanel.classList.remove('glow-negative');
    DOMElements.npcOfferPanel.classList.remove('glow-positive');

    if (diff < 0) { // 玩家虧了 (需補償的價值為正)
        DOMElements.valueDiff.classList.add('text-red-400');
        DOMElements.playerPanel.classList.add('glow-negative');
        DOMElements.playerOfferPanel.classList.add('glow-negative');
    } else if (diff > 0) { // 玩家賺了
        DOMElements.valueDiff.classList.add('text-green-400');
        DOMElements.npcPanel.classList.add('glow-positive');
        DOMElements.npcOfferPanel.classList.add('glow-positive');
    }
    
    const isTradeable = state.player.offer.items.length > 0 || state.npc.offer.items.length > 0;
    DOMElements.confirmBtn.disabled = !isTradeable;
}

/**
 * 處理最終交易確認
 */
async function handleConfirmTrade() {
    DOMElements.confirmBtn.disabled = true;
    DOMElements.confirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 交割中...`;

    try {
        const finalTradeState = {
            player: {
                offer: {
                    items: state.player.offer.items.map(item => ({ id: item.instanceId || item.templateId, name: item.itemName, quantity: 1 })),
                    money: 0 // 當前模型不處理金錢，設為0
                }
            },
            npc: {
                offer: {
                    items: state.npc.offer.items.map(item => ({ id: item.instanceId || item.templateId, name: item.itemName, quantity: 1 })),
                    money: 0
                }
            }
        };

        const result = await api.confirmTrade({
            tradeState: finalTradeState,
            npcName: currentNpcName
        });
        
        if (result.newRound && typeof onTradeCompleteCallback === 'function') {
            onTradeCompleteCallback(result.newRound);
        }

    } catch (error) {
        alert(`交易失敗: ${error.message}`);
        DOMElements.confirmBtn.disabled = false;
    } finally {
        DOMElements.confirmBtn.innerHTML = `成交`;
    }
}


/**
 * 交易系統的總入口和初始化函式
 * @param {object} tradeData - 從API獲取的初始交易數據
 * @param {string} npcName - 正在交易的NPC名稱
 * @param {function} onTradeComplete - 交易成功後的回調
 */
export function initializeTrade(tradeData, npcName, onTradeComplete) {
    cacheDOMElements();
    
    currentNpcName = npcName;
    onTradeCompleteCallback = onTradeComplete;
    
    // 重置交易狀態
    state = {
        player: {
            inventory: Object.values(tradeData.player.items),
            offer: { items: [], money: 0 },
            money: tradeData.player.money
        },
        npc: {
            inventory: Object.values(tradeData.npc.items),
            offer: { items: [], money: 0 },
            money: tradeData.npc.money
        }
    };
    
    // 綁定事件監聽器
    if (DOMElements.confirmBtn) {
        DOMElements.confirmBtn.onclick = handleConfirmTrade;
    }
    
    // 初始渲染
    render();
}

/**
 * 【新增】在關閉彈窗時，清理事件監聽器
 */
export function closeTradeUI() {
    if (DOMElements.confirmBtn) {
        DOMElements.confirmBtn.onclick = null;
    }
}
