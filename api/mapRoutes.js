// api/mapRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * @route   GET /api/map/world-map
 * @desc    獲取整個遊戲世界的地圖資料 (重構版)
 * @access  Public
 */
router.get('/world-map', async (req, res) => {
    try {
        const locationsSnapshot = await db.collection('locations').get();

        if (locationsSnapshot.empty) {
            return res.json({ mermaidSyntax: 'graph TD;\n    A["世界混沌初開"];' });
        }

        const locations = new Map();
        const idMap = new Map();
        let mermaidIdCounter = 0;

        // 步驟一：遍歷所有地點，為每個地點創建一個安全的內部ID
        locationsSnapshot.forEach(doc => {
            const originalId = doc.id;
            const safeId = `loc${mermaidIdCounter++}`;
            idMap.set(originalId, safeId);
            locations.set(originalId, {
                safeId: safeId,
                ...doc.data()
            });
        });

        // 步驟二：開始建構Mermaid語法
        let mermaidSyntax = 'graph TD;\n';

        // 步驟三：使用安全ID定義所有節點和樣式
        mermaidSyntax += '    %% --- Node Definitions & Styles ---\n';
        const typeStyles = {
            '城市': 'fill:#ffe8d6,stroke:#8c6f54,stroke-width:2px,color:#3a2d21',
            '村莊': 'fill:#f0fff0,stroke:#28a745,stroke-width:1px,color:#000',
            '建築': 'fill:#e7f5ff,stroke:#0d6efd,stroke-width:1px,color:#000',
            '門派': 'fill:#f8f0ff,stroke:#845ef7,stroke-width:2px,color:#000',
            '山寨': 'fill:#fff5f5,stroke:#dc3545,stroke-width:2px,color:#000',
            '自然景觀': 'fill:#e6fcf5,stroke:#20c997,stroke-width:1px,color:#000',
        };

        locations.forEach((loc) => {
            // 正確的節點定義語法： safeId["中文名稱"]
            mermaidSyntax += `    ${loc.safeId}["${loc.locationName}"];\n`;
            if (typeStyles[loc.locationType]) {
                mermaidSyntax += `    style ${loc.safeId} ${typeStyles[loc.locationType]};\n`;
            }
        });

        // 步驟四：使用安全ID定義所有連結
        mermaidSyntax += '\n    %% --- Link Definitions ---\n';
        const definedLinks = new Set();
        locations.forEach((loc, originalId) => {
            // 層級關係連結
            if (loc.parentLocation && idMap.has(loc.parentLocation)) {
                const parentSafeId = idMap.get(loc.parentLocation);
                const childSafeId = loc.safeId;
                const linkKey = `${parentSafeId}-->${childSafeId}`;
                if (!definedLinks.has(linkKey)) {
                    mermaidSyntax += `    ${parentSafeId} -->|包含| ${childSafeId};\n`;
                    definedLinks.add(linkKey);
                }
            }
            // 鄰近地點連結
            if (loc.geography && Array.isArray(loc.geography.nearbyLocations)) {
                loc.geography.nearbyLocations.forEach(neighbor => {
                    if (neighbor.name && idMap.has(neighbor.name)) {
                        const sourceSafeId = loc.safeId;
                        const targetSafeId = idMap.get(neighbor.name);
                        const sortedIds = [sourceSafeId, targetSafeId].sort();
                        const linkKey = `${sortedIds[0]}---${sortedIds[1]}`;

                        if (!definedLinks.has(linkKey)) {
                            const travelTime = neighbor.travelTime || '...';
                            mermaidSyntax += `    ${sourceSafeId} -.-|"${travelTime}"| ${targetSafeId};\n`;
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
