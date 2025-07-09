// scripts/tradeManager.js
import { api } from './api.js';

// 用於儲存當前交易狀態的全域變數
let tradeState = {};
let currentNpcName = '';
let onTradeSuccessCallback = null;

/**
 * 更新交易匯總區域，計算價值差異並更新按鈕狀態
 */
function updateTradeSummary() {
    const playerTotalValue = tradeState.player.offer.items.reduce((sum, item) => sum + (item.value * item.quantity), 0) + tradeState.player.offer.money;
    const npcTotalValue = tradeState.npc.offer.items.reduce((sum, item) => sum + (item.value * item.quantity), 0) + tradeState.npc.offer.money;

    const valueDiff = playerTotalValue - npcTotalValue;

    const tradeValueDiff = document.getElementById('trade-value-diff');
    const confirmTradeBtn = document.getElementById('confirm-trade-btn');

    tradeValueDiff.textContent = `價值差: ${valueDiff}`;
    tradeValueDiff.className = 'trade-value-display'; // Reset class

    if (valueDiff > 0) {
        tradeValueDiff.classList.add('positive'); // 玩家有利
    } else if (valueDiff < 0) {
        tradeValueDiff.classList.add('negative'); // 玩家不利
    }

    const isTradeSubstantial = tradeState.player.offer.items.length > 0 || tradeState.npc.offer.items.length > 0 || tradeState.player.offer.money > 0 || tradeState.npc.offer.money > 0;
    const isBalanced = Math.abs(valueDiff) <= 500; 

    confirmTradeBtn.disabled = !(isTradeSubstantial && isBalanced);
}


/**
 * 將物品從一個列表移動到另一個列表
 * @param {string} itemId - 物品的唯一ID
 * @param {'player' | 'npc'} owner - 物品的當前擁有者
 * @param {'inventory' | 'offer'} from - 來源區域
 * @param {'inventory' | 'offer'} to - 目標區域
 */
function moveItem(itemId, owner, from, to) {
    const fromList = tradeState[owner][from].items;
    const toList = tradeState[owner][to].items;

    const itemIndex = fromList.findIndex(item => item.id === itemId);
    if (itemIndex === -1) return;

    const [itemToMove] = fromList.splice(itemIndex, 1);
    toList.push(itemToMove);

    renderInventory(owner);
    renderOffer(owner);
    updateTradeSummary();
}


/**
 * 渲染指定所有者的背包UI
 * @param {'player' | 'npc'} owner - 'player' 或 'npc'
 */
function renderInventory(owner) {
    const inventoryContainer = document.getElementById(`${owner}-trade-inventory`);
    inventoryContainer.innerHTML = '';

    if (tradeState[owner].inventory.items.length === 0) {
        inventoryContainer.innerHTML = `<p class="empty-inventory">${owner === 'player' ? '你的行囊空空如也' : '對方身無長物'}</p>`;
    } else {
        tradeState[owner].inventory.items.forEach(item => {
            const itemEl = createTradeItemElement(item.id, item, () => moveItem(item.id, owner, 'inventory', 'offer'));
            inventoryContainer.appendChild(itemEl);
        });
    }
}

/**
 * 渲染指定所有者的出價區域UI
 * @param {'player' | 'npc'} owner - 'player' 或 'npc'
 */
function renderOffer(owner) {
    const offerContainer = document.getElementById(`${owner}-offer-area`).querySelector('.offer-items-list');
    offerContainer.innerHTML = '';

    tradeState[owner].offer.items.forEach(item => {
        const itemEl = createTradeItemElement(item.id, item, () => moveItem(item.id, owner, 'offer', 'inventory'));
        offerContainer.appendChild(itemEl);
    });
}

/**
 * 建立一個可交易物品的DOM元素，並為其附加點擊事件
 * @param {string} itemId - 物品的唯一ID
 * @param {object} itemData - 物品的詳細資料
 * @param {function} onClickCallback - 點擊後的回調函式
 * @returns {HTMLElement}
 */
function createTradeItemElement(itemId, itemData, onClickCallback) {
    const itemEl = document.createElement('div');
    itemEl.className = 'trade-item';
    itemEl.dataset.itemId = itemId;
    itemEl.title = `${itemData.itemName}\n類型: ${itemData.itemType}\n價值: ${itemData.value || 0}文\n${itemData.baseDescription || ''}`;
    
    itemEl.innerHTML = `
        <span class="trade-item-name">${itemData.itemName}</span>
        <span class="trade-item-quantity">x${itemData.quantity || 1}</span>
    `;
    itemEl.addEventListener('click', onClickCallback);
    return itemEl;
}

/**
 * 執行交易確認的邏輯
 */
async function handleConfirmTrade() {
    const confirmTradeBtn = document.getElementById('confirm-trade-btn');
    confirmTradeBtn.disabled = true;
    confirmTradeBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 交易中...`;

    try {
        const result = await api.confirmTrade({
            tradeState,
            npcName: currentNpcName
        });
        
        if (result.newRound && typeof onTradeSuccessCallback === 'function') {
            onTradeSuccessCallback(result.newRound);
        }

    } catch (error) {
        alert(`交易失敗: ${error.message}`);
        confirmTradeBtn.disabled = false;
    } finally {
        confirmTradeBtn.innerHTML = `確認交易`;
    }
}


/**
 * 初始化交易管理器
 * @param {object} tradeData - 從後端獲取的完整交易數據
 * @param {string} npcName - 正在交易的NPC名稱
 * @param {function} onTradeComplete - 交易成功後的回調函式
 */
export function initializeTrade(tradeData, npcName, onTradeComplete) {
    console.log("交易管理器已初始化，收到的數據：", tradeData);
    currentNpcName = npcName;
    onTradeSuccessCallback = onTradeComplete;

    tradeState = {
        player: {
            inventory: { items: Object.entries(tradeData.player.items).map(([id, data]) => ({ id, ...data })) },
            offer: { items: [], money: 0 }
        },
        npc: {
            inventory: { items: Object.entries(tradeData.npc.items).map(([id, data]) => ({ id, ...data })) },
            offer: { items: [], money: 0 }
        }
    };

    renderInventory('player');
    renderInventory('npc');
    renderOffer('player');
    renderOffer('npc');

    const playerOfferMoneyInput = document.getElementById('player-offer-money');
    const npcOfferMoneyInput = document.getElementById('npc-offer-money');
    
    playerOfferMoneyInput.addEventListener('input', (e) => {
        let amount = parseInt(e.target.value) || 0;
        const maxAmount = tradeData.player.money;
        if (amount > maxAmount || amount < 0) {
            amount = Math.max(0, Math.min(amount, maxAmount));
            e.target.value = amount;
        }
        tradeState.player.offer.money = amount;
        updateTradeSummary();
    });

    npcOfferMoneyInput.addEventListener('input', (e) => {
        let amount = parseInt(e.target.value) || 0;
        const maxAmount = tradeData.npc.money;
        if (amount > maxAmount || amount < 0) {
            amount = Math.max(0, Math.min(amount, maxAmount));
            e.target.value = amount;
        }
        tradeState.npc.offer.money = amount;
        updateTradeSummary();
    });

    const confirmTradeBtn = document.getElementById('confirm-trade-btn');
    confirmTradeBtn.onclick = handleConfirmTrade;

    updateTradeSummary();
}
