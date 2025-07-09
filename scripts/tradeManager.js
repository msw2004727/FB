// scripts/tradeManager.js

// 用於儲存當前交易狀態的全域變數
let tradeState = {};

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

    // 只有在雙方出價都不為零，且價值差距在可接受範圍內時，才啟用確認按鈕
    const isTradeSubstantial = playerTotalValue > 0 || npcTotalValue > 0;
    // 允許一定程度的不等價交換，例如價值差距在500以內
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

    // 重新渲染UI
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
 * 初始化交易管理器
 * @param {object} tradeData - 從後端獲取的完整交易數據
 */
export function initializeTrade(tradeData) {
    console.log("交易管理器已初始化，收到的數據：", tradeData);

    // 1. 初始化內部狀態
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

    // 2. 渲染初始UI
    renderInventory('player');
    renderInventory('npc');
    renderOffer('player');
    renderOffer('npc');

    // 3. 綁定金錢輸入事件
    const playerOfferMoneyInput = document.getElementById('player-offer-money');
    const npcOfferMoneyInput = document.getElementById('npc-offer-money');
    
    playerOfferMoneyInput.addEventListener('input', (e) => {
        let amount = parseInt(e.target.value) || 0;
        const maxAmount = tradeData.player.money;
        if (amount > maxAmount) {
            amount = maxAmount;
            e.target.value = amount;
        }
        tradeState.player.offer.money = amount;
        updateTradeSummary();
    });

    npcOfferMoneyInput.addEventListener('input', (e) => {
        let amount = parseInt(e.target.value) || 0;
        const maxAmount = tradeData.npc.money;
        if (amount > maxAmount) {
            amount = maxAmount;
            e.target.value = amount;
        }
        tradeState.npc.offer.money = amount;
        updateTradeSummary();
    });

    // 4. 為確認按鈕綁定事件 (目前僅為框架)
    const confirmTradeBtn = document.getElementById('confirm-trade-btn');
    confirmTradeBtn.onclick = () => {
        // TODO: 在下一步中，我們將在這裡呼叫後端API來完成交易
        alert('交易已鎖定！下一步將實作與後端的最終數據交換。');
        console.log("最終交易方案:", tradeState);
    };

    // 5. 初始更新一次匯總
    updateTradeSummary();
}
