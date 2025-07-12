// scripts/tradeManager.js
import { api } from './api.js';

let state = {};
let onTradeCompleteCallback = null;
let closeTradeModalCallback = null;
let currentNpcName = '';

const DOMElements = {};
let areDOMsCached = false;

function cacheDOMElements() {
    if (areDOMsCached) return;
    DOMElements.tradeModal = document.getElementById('trade-modal');
    DOMElements.closeBtn = document.getElementById('close-trade-btn');
    
    // Player elements
    DOMElements.playerInventory = document.querySelector('#trade-player-inventory');
    DOMElements.playerOffer = document.querySelector('#trade-player-offer');
    DOMElements.playerMoneyDisplay = document.getElementById('trade-player-money');
    DOMElements.playerMoneyInput = document.getElementById('trade-player-money-input');
    
    // NPC elements
    DOMElements.npcInventory = document.querySelector('#trade-npc-inventory');
    DOMElements.npcOffer = document.querySelector('#trade-npc-offer');
    DOMElements.npcMoneyDisplay = document.getElementById('trade-npc-money');
    DOMElements.npcMoneyInput = document.getElementById('trade-npc-money-input');

    DOMElements.npcHeaderName = document.getElementById('trade-npc-header-name');
    DOMElements.npcNameDisplay = document.getElementById('trade-npc-name');
    
    // Summary elements
    DOMElements.valueDiff = document.getElementById('trade-value-diff');
    DOMElements.confirmBtn = document.getElementById('confirm-trade-btn');
    
    areDOMsCached = true;
}

function render() {
    if (!DOMElements.playerInventory) return; 

    // 渲染雙方的物品欄和出價區
    ['player', 'npc'].forEach(owner => {
        const inventoryEl = DOMElements[`${owner}Inventory`];
        const offerEl = DOMElements[`${owner}Offer`];
        inventoryEl.innerHTML = '';
        offerEl.innerHTML = '';

        if (state[owner].inventory.length === 0) {
            inventoryEl.innerHTML = `<p class="text-xs text-center text-gray-400 italic mt-4">行囊空空</p>`;
        } else {
            state[owner].inventory.forEach(item => inventoryEl.appendChild(createItemElement(item, owner, 'inventory')));
        }

        if (state[owner].offer.items.length === 0) {
            offerEl.innerHTML = `<p class="text-xs text-center text-gray-400 italic mt-4">尚未出價</p>`;
        } else {
            state[owner].offer.items.forEach(item => offerEl.appendChild(createItemElement(item, owner, 'offer')));
        }
    });

    // 渲染金錢
    DOMElements.playerMoneyDisplay.textContent = state.player.money;
    DOMElements.npcMoneyDisplay.textContent = state.npc.money;
    
    // 渲染NPC名稱
    DOMElements.npcHeaderName.textContent = currentNpcName;
    DOMElements.npcNameDisplay.textContent = `${currentNpcName} 的出價`;
    
    // 添加監聽器
    DOMElements.playerMoneyInput.oninput = () => calculateSummary();
    DOMElements.npcMoneyInput.oninput = () => calculateSummary(); // NPC出價也應觸發計算
    
    calculateSummary();
}

function createItemElement(item, owner, area) {
    const li = document.createElement('li');
    // 【核心修正】統一使用 instanceId 作為點擊事件的依據
    const uniqueId = item.instanceId || item.templateId;
    const quantityText = item.quantity > 1 ? ` (x${item.quantity})` : '';

    li.className = 'bg-amber-50/50 border border-amber-200 p-1.5 rounded-md cursor-pointer flex justify-between items-center text-sm hover:border-amber-400 hover:bg-amber-50 transform hover:-translate-y-px transition-all';
    li.title = item.description || item.baseDescription || '一個神秘的物品';
    li.innerHTML = `<span class="font-semibold text-amber-900">${item.itemName}${quantityText}</span> <span class="text-xs text-amber-700">價:${item.value || 0}</span>`;
    li.addEventListener('click', () => moveItem(uniqueId, owner, area));
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
    
    const playerItemValue = state.player.offer.items.reduce((sum, item) => sum + ((item.value || 0) * item.quantity), 0);
    const npcItemValue = state.npc.offer.items.reduce((sum, item) => sum + ((item.value || 0) * item.quantity), 0);
    
    const playerMoneyValue = Number(DOMElements.playerMoneyInput.value) || 0;
    const npcMoneyValue = Number(DOMElements.npcMoneyInput.value) || 0;

    const playerOfferValue = playerItemValue + playerMoneyValue;
    const npcOfferValue = npcItemValue + npcMoneyValue;

    const diff = playerOfferValue - npcOfferValue;
    DOMElements.valueDiff.textContent = diff;
    DOMElements.valueDiff.className = diff > 0 ? 'text-2xl font-bold text-green-500' : diff < 0 ? 'text-2xl font-bold text-red-500' : 'text-2xl font-bold text-white';
    
    const isTradeable = playerOfferValue > 0 || npcOfferValue > 0;
    DOMElements.confirmBtn.disabled = !isTradeable;
}

async function handleConfirmTrade() {
    DOMElements.confirmBtn.disabled = true;
    DOMElements.confirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 交割中...`;

    const playerMoneyOffer = Number(DOMElements.playerMoneyInput.value) || 0;
    const npcMoneyOffer = Number(DOMElements.npcMoneyInput.value) || 0;

    if (playerMoneyOffer > state.player.money) {
        alert('你的文錢不夠！');
        DOMElements.confirmBtn.disabled = false;
        DOMElements.confirmBtn.innerHTML = `成交`;
        return;
    }
    if (npcMoneyOffer > state.npc.money) {
        alert(`${currentNpcName} 的文錢不夠！`);
        DOMElements.confirmBtn.disabled = false;
        DOMElements.confirmBtn.innerHTML = `成交`;
        return;
    }


    try {
        const finalTradeState = {
            player: {
                offer: {
                    items: state.player.offer.items.map(item => ({ id: item.instanceId || item.templateId, name: item.itemName, quantity: item.quantity })),
                    money: playerMoneyOffer,
                }
            },
            npc: {
                offer: {
                    items: state.npc.offer.items.map(item => ({ id: item.instanceId || item.templateId, name: item.itemName, quantity: item.quantity })),
                    money: npcMoneyOffer,
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

    // 【核心修正】直接使用後端傳來的完整資料
    state = {
        player: {
            inventory: tradeData.player.items.filter(item => item.itemType !== '財寶'), // 過濾掉錢
            offer: { items: [], money: 0 },
            money: tradeData.player.money,
        },
        npc: {
            inventory: tradeData.npc.items, // 直接使用合併後的列表
            offer: { items: [], money: 0 },
            money: tradeData.npc.money,
        }
    };
    
    DOMElements.playerMoneyInput.value = '0';
    DOMElements.npcMoneyInput.value = '0';
    DOMElements.npcMoneyInput.setAttribute('max', state.npc.money); // 設定NPC最大出價金額
    DOMElements.playerMoneyInput.setAttribute('max', state.player.money); // 設定玩家最大出價金額

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
