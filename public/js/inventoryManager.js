// public/js/inventoryManager.js

class InventoryManager {
    constructor() {
        this.inventoryContainer = document.getElementById('inventory-container');
        this.equipmentContainer = document.getElementById('equipment-container');
        this.bulkContainer = document.getElementById('bulk-container');
        this.token = localStorage.getItem('token');
    }

    /**
     * 根據負重分數獲取對應的狀態描述和顏色
     * @param {number} bulkScore - 總負重分數
     * @returns {{text: string, colorClass: string}}
     */
    getBulkStatus(bulkScore) {
        if (bulkScore <= 10) return { text: '身輕如燕', colorClass: 'text-success' };
        if (bulkScore <= 25) return { text: '行囊充實', colorClass: 'text-info' };
        if (bulkScore <= 50) return { text: '步履沉重', colorClass: 'text-warning' };
        return { text: '不堪重負', colorClass: 'text-danger' };
    }
    
    /**
     * 渲染整個物品欄、裝備和負重狀態
     * @param {object} inventoryData - 包含 inventory, equipment, bulkScore 的對象
     */
    render(inventoryData) {
        this.renderInventory(inventoryData.inventory || []);
        this.renderEquipment(inventoryData.equipment || {});
        this.renderBulk(inventoryData.bulkScore || 0);
    }

    /**
     * 渲染負重狀態
     * @param {number} bulkScore - 總負重分數
     */
    renderBulk(bulkScore) {
        if (!this.bulkContainer) return;
        const status = this.getBulkStatus(bulkScore);
        this.bulkContainer.innerHTML = `
            <p class="mb-0"><strong>總負重:</strong> 
                <span class="${status.colorClass}">${bulkScore} (${status.text})</span>
            </p>
        `;
    }

    /**
     * 渲染裝備欄
     * @param {object} equipment - 玩家的裝備對象
     */
    renderEquipment(equipment) {
        if (!this.equipmentContainer) return;

        const slots = [
            { id: 'equipment-head', label: '頭部', slot: 'head' },
            { id: 'equipment-body', label: '身體', slot: 'body' },
            { id: 'equipment-hands', label: '手部', slot: 'hands' },
            { id: 'equipment-feet', label: '腳部', slot: 'feet' },
            { id: 'equipment-weapon_right', label: '右手', slot: 'weapon_right' },
            { id: 'equipment-weapon_left', label: '左手', slot: 'weapon_left' },
            { id: 'equipment-weapon_back', label: '背部', slot: 'weapon_back' },
            { id: 'equipment-accessory1', label: '飾品1', slot: 'accessory1' },
            { id: 'equipment-accessory2', label: '飾品2', slot: 'accessory2' },
            { id: 'equipment-manuscript', label: '秘笈', slot: 'manuscript' },
        ];

        let html = '<div class="row">';
        slots.forEach(s => {
            const item = equipment[s.slot];
            html += `
                <div class="col-md-6 col-lg-4 mb-2">
                    <div class="equipment-slot" id="${s.id}">
                        <small class="text-muted">${s.label}:</small>
                        ${item ? this.createItemHTML(item, 'equipment') : '<span class="text-secondary">無</span>'}
                    </div>
                </div>
            `;
        });
        html += '</div>';
        this.equipmentContainer.innerHTML = html;
        this.addEventListeners('equipment');
    }
    
    /**
     * 渲染物品欄列表
     * @param {Array<object>} inventory - 玩家的物品數組
     */
    renderInventory(inventory) {
        if (!this.inventoryContainer) return;

        if (inventory.length === 0) {
            this.inventoryContainer.innerHTML = '<p class="text-center text-muted">你的行囊空空如也。</p>';
            return;
        }

        let html = '<div class="list-group">';
        inventory.forEach(item => {
            html += this.createItemHTML(item, 'inventory');
        });
        html += '</div>';
        this.inventoryContainer.innerHTML = html;
        this.addEventListeners('inventory');
    }

    /**
     * 創建單個物品的 HTML 結構
     * @param {object} item - 物品數據
     * @param {string} type - 'inventory' 或 'equipment'
     * @returns {string} - HTML 字符串
     */
    createItemHTML(item, type) {
        const rarityColor = {
            '普通': 'text-white', '稀有': 'text-primary', '史詩': 'text-warning', '傳說': 'text-danger'
        };
        const actionButton = type === 'inventory'
            ? `<button class="btn btn-sm btn-outline-success action-btn" data-action="equip" data-item-id="${item.uid}">裝備</button>`
            : `<button class="btn btn-sm btn-outline-warning action-btn" data-action="unequip" data-slot="${item.equipSlot}">卸下</button>`;

        return `
            <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center item-card" data-item-id="${item.uid}">
                <div>
                    <h6 class="mb-1 ${rarityColor[item.rarity] || 'text-white'}">${item.itemName}</h6>
                    <small>類型: ${item.itemType} | 份量: ${item.bulk}</small>
                </div>
                <div>
                    ${actionButton}
                    <button class="btn btn-sm btn-outline-secondary action-btn" data-action="details" data-item-id="${item.uid}">詳情</button>
                    <button class="btn btn-sm btn-outline-danger action-btn" data-action="drop" data-item-id="${item.uid}">丟棄</button>
                </div>
            </div>
        `;
    }

    /**
     * 為容器內的按鈕添加事件監聽
     * @param {string} containerType - 'inventory' 或 'equipment'
     */
    addEventListeners(containerType) {
        const container = containerType === 'inventory' ? this.inventoryContainer : this.equipmentContainer;
        container.querySelectorAll('.action-btn').forEach(button => {
            button.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = e.target.dataset.action;
                const itemId = e.target.dataset.itemId;
                const slot = e.target.dataset.slot;

                switch (action) {
                    case 'equip':
                        this.handleAction(`/api/inventory/equip`, { itemId });
                        break;
                    case 'unequip':
                        this.handleAction(`/api/inventory/unequip`, { slot });
                        break;
                    case 'drop':
                        if (confirm(`你確定要丟棄「${itemId}」嗎？此操作無法復原。`)) {
                           this.handleAction(`/api/inventory/remove`, { itemId });
                        }
                        break;
                    case 'details':
                        // 此處可以調用一個顯示物品詳情彈出框的函數
                        alert(`顯示物品詳情: ${itemId}`);
                        break;
                }
            });
        });
    }

    /**
     * 處理與後端的交互
     * @param {string} endpoint - API 端點
     * @param {object} body - 請求體
     */
    async handleAction(endpoint, body) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(body)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || '操作失敗');
            }

            // 操作成功後，重新渲染整個物品欄
            if (result.inventoryData) {
                this.render(result.inventoryData);
            }
             // 顯示成功消息
            showToast(result.message || '操作成功');

        } catch (error) {
            console.error(`[物品欄操作失敗]`, error);
            showToast(error.message, 'error');
        }
    }
}

// 初始化管理器
document.addEventListener('DOMContentLoaded', () => {
    window.inventoryManager = new InventoryManager();
    // 初始加載數據的邏輯可以在主 game.js 中調用
});
