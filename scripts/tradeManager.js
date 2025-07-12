// scripts/tradeManager.js
import { api } from './api.js';

// 全域變數，用於儲存當前交易的狀態
let state = {};
let onTradeCompleteCallback = null;
let closeTradeModalCallback = null;
let currentNpcName = '';

// DOM 元素快取
const DOMElements = {};
let areDOMsCached = false;

function cacheDOMElements() {
    if (areDOMsCached) return;
    DOMElements.tradeModal = document.getElementById('trade-modal');
    DOMElements.closeBtn = document.getElementById('close-trade-btn');
    DOMElements.playerInventory = document.querySelector('#trade-player-inventory');
    DOMElements.playerOffer = document.querySelector('#trade-player-offer');
    DOMElements.npcInventory = document.querySelector('#trade-npc-inventory');
    DOMElements.npcOffer = document.querySelector('#trade-npc-offer');
    DOMElements.playerMoney = document.getElementById('trade-player-money');
    DOMElements.npcMoney = document.getElementById('trade-npc-money');
    // 【核心新增】獲取金錢輸入框
    DOMElements.playerMoneyInput = document.getElementById('trade-player-money-input');
    DOMElements.npcMoneyInput = document.getElementById('trade-npc-money-input');
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

function render() {
    if (!DOMElements.playerInventory) return; 

    ['player', 'npc'].forEach(owner => {
        const inventoryEl = DOMElements[`${owner}Inventory`];
        const offerEl = DOMElements[`${owner}Offer`];
        inventoryEl.innerHTML = '';
        offerEl.innerHTML = '';
        state[owner].inventory.forEach(item => inventoryEl.appendChild(createItemElement(item, owner, 'inventory')));
        state[owner].offer.items.forEach(item => offerEl.appendChild(createItemElement(item, owner, 'offer')));
    });

    DOMElements.playerMoney.textContent = state.player.money;
    DOMElements.npcMoney.textContent = state.npc.money;
    DOMElements.npcHeaderName.textContent = currentNpcName;
    DOMElements.npcNameDisplay.textContent = `${currentNpcName} 的出價`;
    
    // 【核心新增】監聽輸入框變化
    DOMElements.playerMoneyInput.oninput = () => calculateSummary();
    DOMElements.npcMoneyInput.oninput = () => calculateSummary();
    
    calculateSummary();
}

function createItemElement(item, owner, area) {
    const li = document.createElement('li');
    li.className = 'bg-amber-50/50 border border-amber-200 p-1.5 rounded-md cursor-pointer flex justify-between items-center text-sm hover:border-amber-400 hover:bg-amber-50 transform hover:-translate-y-px transition-all';
    li.title = item.description || item.baseDescription || '一個神秘的物品';
    li.innerHTML = `<span class="font-semibold text-amber-900">${item.itemName}</span> <span class="text-xs text-amber-700">價:${item.value || 0}</span>`;
    li.addEventListener('click', () => moveItem(item.instanceId || item.templateId, owner, area));
    return li;
}

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

function calculateSummary() {
    if (!DOMElements.valueDiff) return;

    const playerItemValue = state.player.offer.items.reduce((sum, item) => sum + (item.value || 0), 0);
    const npcItemValue = state.npc.offer.items.reduce((sum, item) => sum + (item.value || 0), 0);
    
    // 【核心修正】將金錢也計入價值計算
    const playerMoneyValue = Number(DOMElements.playerMoneyInput.value) || 0;
    const npcMoneyValue = Number(DOMElements.npcMoneyInput.value) || 0;
    
    const playerOfferValue = playerItemValue + playerMoneyValue;
    const npcOfferValue = npcItemValue + npcMoneyValue;

    const diff = playerOfferValue - npcOfferValue;

    DOMElements.valueDiff.textContent = diff;
    
    DOMElements.valueDiff.classList.remove('text-green-400', 'text-red-400');
    DOMElements.playerPanel.classList.remove('glow-negative');
    DOMElements.npcPanel.classList.remove('glow-positive');
    DOMElements.playerOfferPanel.classList.remove('glow-negative');
    DOMElements.npcOfferPanel.classList.remove('glow-positive');

    if (diff < 0) { 
        DOMElements.valueDiff.classList.add('text-red-400');
        DOMElements.playerPanel.classList.add('glow-negative');
        DOMElements.playerOfferPanel.classList.add('glow-negative');
    } else if (diff > 0) { 
        DOMElements.valueDiff.classList.add('text-green-400');
        DOMElements.npcPanel.classList.add('glow-positive');
        DOMElements.npcOfferPanel.classList.add('glow-positive');
    }
    
    const isTradeable = playerOfferValue > 0 || npcOfferValue > 0;
    DOMElements.confirmBtn.disabled = !isTradeable;
}

async function handleConfirmTrade() {
    DOMElements.confirmBtn.disabled = true;
    DOMElements.confirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 交割中...`;

    // 【核心修正】獲取並驗證玩家輸入的金錢
    const playerMoneyOffer = Number(DOMElements.playerMoneyInput.value) || 0;
    const npcMoneyOffer = Number(DOMElements.npcMoneyInput.value) || 0;

    if (playerMoneyOffer > state.player.money) {
        alert('你的錢不夠！');
        DOMElements.confirmBtn.disabled = false;
        DOMElements.confirmBtn.innerHTML = `成交`;
        return;
    }
    if (npcMoneyOffer > state.npc.money) {
        alert('對方的錢不夠！');
        DOMElements.confirmBtn.disabled = false;
        DOMElements.confirmBtn.innerHTML = `成交`;
        return;
    }

    try {
        const finalTradeState = {
            player: {
                offer: {
                    items: state.player.offer.items.map(item => ({ id: item.instanceId || item.templateId, name: item.itemName, quantity: 1 })),
                    money: playerMoneyOffer
                }
            },
            npc: {
                offer: {
                    items: state.npc.offer.items.map(item => ({ id: item.instanceId || item.templateId, name: item.itemName, quantity: 1 })),
                    money: npcMoneyOffer
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

export function initializeTrade(tradeData, npcName, onTradeComplete, closeCallback) {
    cacheDOMElements();
    
    currentNpcName = npcName;
    onTradeCompleteCallback = onTradeComplete;
    closeTradeModalCallback = closeCallback; 

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
    
    // 【核心新增】重置金錢輸入框
    DOMElements.playerMoneyInput.value = '0';
    DOMElements.npcMoneyInput.value = '0';

    if (DOMElements.closeBtn) {
        DOMElements.closeBtn.onclick = closeTradeModalCallback;
    }
    if (DOMElements.tradeModal) {
        DOMElements.tradeModal.onclick = (event) => {
            if (event.target === DOMElements.tradeModal) {
                closeTradeModalCallback();
            }
        };
    }

    if (DOMElements.confirmBtn) {
        DOMElements.confirmBtn.onclick = handleConfirmTrade;
    }
    
    render();
}

export function closeTradeUI() {
    if (DOMElements.confirmBtn) DOMElements.confirmBtn.onclick = null;
    if (DOMElements.closeBtn) DOMElements.closeBtn.onclick = null;
    if (DOMElements.tradeModal) DOMElements.tradeModal.onclick = null;
    if (DOMElements.playerMoneyInput) DOMElements.playerMoneyInput.oninput = null;
    if (DOMElements.npcMoneyInput) DOMElements.npcMoneyInput.oninput = null;
}
