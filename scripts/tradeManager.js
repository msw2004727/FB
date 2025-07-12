// scripts/tradeManager.js
import { api } from './api.js';

let state = {};
let onTradeCompleteCallback = null;
let closeTradeModalCallback = null;
let currentNpcName = '';

const DOMElements = {};
let areDOMsCached = false;

// 【核心修正】移除所有不存在的 "silver" 相關元素ID
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

    // Render inventories and offers
    ['player', 'npc'].forEach(owner => {
        const inventoryEl = DOMElements[`${owner}Inventory`];
        const offerEl = DOMElements[`${owner}Offer`];
        inventoryEl.innerHTML = '';
        offerEl.innerHTML = '';
        state[owner].inventory.forEach(item => inventoryEl.appendChild(createItemElement(item, owner, 'inventory')));
        state[owner].offer.items.forEach(item => offerEl.appendChild(createItemElement(item, owner, 'offer')));
    });

    // 【核心修正】移除對 "silver" 元素的渲染
    DOMElements.playerMoneyDisplay.textContent = state.player.money;
    DOMElements.npcMoneyDisplay.textContent = state.npc.money;
    
    DOMElements.npcHeaderName.textContent = currentNpcName;
    DOMElements.npcNameDisplay.textContent = `${currentNpcName} 的出價`;
    
    // Add input listeners
    DOMElements.playerMoneyInput.oninput = () => calculateSummary();
    
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
    
    const playerMoneyValue = Number(DOMElements.playerMoneyInput.value) || 0;
    const npcMoneyValue = Number(DOMElements.npcMoneyInput.value) || 0;

    // 【核心修正】移除所有 "silver" 相關的計算
    const playerOfferValue = playerItemValue + playerMoneyValue;
    const npcOfferValue = npcItemValue + npcMoneyValue;

    const diff = playerOfferValue - npcOfferValue;
    DOMElements.valueDiff.textContent = diff;
    
    const isTradeable = playerOfferValue > 0 || npcOfferValue > 0;
    DOMElements.confirmBtn.disabled = !isTradeable;
}

async function handleConfirmTrade() {
    DOMElements.confirmBtn.disabled = true;
    DOMElements.confirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 交割中...`;

    const playerMoneyOffer = Number(DOMElements.playerMoneyInput.value) || 0;

    if (playerMoneyOffer > state.player.money) {
        alert('你的文錢不夠！');
        DOMElements.confirmBtn.disabled = false;
        DOMElements.confirmBtn.innerHTML = `成交`;
        return;
    }

    try {
        // 【核心修正】提交給後端的數據中，不再包含 silver
        const finalTradeState = {
            player: {
                offer: {
                    items: state.player.offer.items.map(item => ({ id: item.instanceId || item.templateId, name: item.itemName, quantity: 1 })),
                    money: playerMoneyOffer,
                    silver: 0 // 保留欄位但值為0，以符合後端期望
                }
            },
            npc: {
                offer: {
                    items: state.npc.offer.items.map(item => ({ id: item.instanceId || item.templateId, name: item.itemName, quantity: 1 })),
                    money: Number(DOMElements.npcMoneyInput.value) || 0,
                    silver: 0 // 保留欄位但值為0
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
            inventory: Object.values(tradeData.player.items).filter(item => item.itemType !== '財寶'), // 過濾掉錢
            offer: { items: [], money: 0, silver: 0 },
            money: tradeData.player.money,
            silver: 0 // 預設為0
        },
        npc: {
            inventory: Object.values(tradeData.npc.items).filter(item => item.itemType !== '財寶'), // 過濾掉錢
            offer: { items: [], money: 0, silver: 0 },
            money: tradeData.npc.money,
            silver: 0 // 預設為0
        }
    };
    
    // 【核心修正】移除對 "silver" 元素的重置
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
    DOMElements.playerMoneyInput.oninput = null;
}
