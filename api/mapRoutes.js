// api/mapRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * @route   GET /api/map/world-map
 * @desc    獲取整個遊戲世界的地圖資料 (支援多層級結構)
 * @access  Public
 */
router.get('/world-map', async (req, res) => {
    try {
        const locationsSnapshot = await db.collection('locations').get();

        if (locationsSnapshot.empty) {
            return res.json({ mermaidSyntax: 'graph TD;\n    A["世界混沌初開"];' });
        }

        const locations = new Map();
        locationsSnapshot.forEach(doc => {
            const data = doc.data();
            const id = (data.locationId || doc.id).replace(/[^a-zA-Z0-9_]/g, ''); // 淨化ID，避免特殊字元
            locations.set(doc.id, { id: id, originalId: doc.id, ...data });
        });

        // 1. 開始建構語法
        let mermaidSyntax = 'graph TD;\n';

        // 2. 定義所有節點及其樣式
        mermaidSyntax += '    %% --- Node Definitions & Styles ---\n';
        const typeStyles = {
            '城市': 'fill:#ffe8d6,stroke:#8c6f54,stroke-width:2px,color:#3a2d21',
            '村莊': 'fill:#f0fff0,stroke:#28a745,stroke-width:1px,color:#000',
            '建築': 'fill:#e7f5ff,stroke:#0d6efd,stroke-width:1px,color:#000',
            '門派': 'fill:#f8f0ff,stroke:#845ef7,stroke-width:2px,color:#000',
            '山寨': 'fill:#fff5f5,stroke:#dc3545,stroke-width:2px,color:#000',
            '自然景觀': 'fill:#e6fcf5,stroke:#20c997,stroke-width:1px,color:#000',
        };

        locations.forEach(loc => {
            mermaidSyntax += `    ${loc.id}["${loc.locationName}"];\n`;
            if (typeStyles[loc.locationType]) {
                mermaidSyntax += `    style ${loc.id} ${typeStyles[loc.locationType]};\n`;
            }
        });

        // 3. 定義所有連結
        mermaidSyntax += '\n    %% --- Link Definitions ---\n';
        const definedLinks = new Set();
        locations.forEach(loc => {
            // 層級關係連結
            if (loc.parentLocation && locations.has(loc.parentLocation)) {
                const parentId = locations.get(loc.parentLocation).id;
                const childId = loc.id;
                const linkKey = `${parentId}-->${childId}`;
                if (!definedLinks.has(linkKey)) {
                    mermaidSyntax += `    ${parentId} -->|包含| ${childId};\n`;
                    definedLinks.add(linkKey);
                }
            }
            // 鄰近地點連結
            if (loc.geography && Array.isArray(loc.geography.nearbyLocations)) {
                loc.geography.nearbyLocations.forEach(neighbor => {
                    if (neighbor.name && locations.has(neighbor.name)) {
                        const sourceId = loc.id;
                        const targetId = locations.get(neighbor.name).id;
                        const sortedIds = [sourceId, targetId].sort();
                        const linkKey = `${sortedIds[0]}---${sortedIds[1]}`;

                        if (!definedLinks.has(linkKey)) {
                            const travelTime = neighbor.travelTime || '...';
                            mermaidSyntax += `    ${sourceId} -.-|"${travelTime}"| ${targetId};\n`; // 使用虛線表示鄰近
                            definedLinks.add(linkKey);
                        }
                    }
                });
            }
        });

        res.json({ mermaidSyntax });

    } catch (error) {
        console.error('[世界地圖系統] 生成地圖時發生錯誤:', error);
        res.status(500).json({ message: '繪製世界輿圖時發生內部錯誤。' });
    }
});

module.exports = router;
