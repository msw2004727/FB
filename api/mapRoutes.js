// api/mapRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * @route   GET /api/map/world-map
 * @desc    獲取玩家個人探索過的地圖資料 (重構版)
 * @access  Private
 */
router.get('/world-map', async (req, res) => {
    const userId = req.user.id;
    try {
        const playerLocationsRef = db.collection('users').doc(userId).collection('location_states');
        const playerLocationsSnapshot = await playerLocationsRef.get();

        if (playerLocationsSnapshot.empty) {
            return res.json({ mermaidSyntax: 'graph TD;\n    A["你的足跡尚未踏出第一步"];' });
        }

        const discoveredLocationNames = playerLocationsSnapshot.docs.map(doc => doc.id);
        
        const locationsRef = db.collection('locations');
        const knownLocationsSnapshot = await locationsRef.where(admin.firestore.FieldPath.documentId(), 'in', discoveredLocationNames).get();

        if (knownLocationsSnapshot.empty) {
            return res.json({ mermaidSyntax: 'graph TD;\n    A["輿圖遺失，無法繪製"];' });
        }
        
        const locations = new Map();
        const idMap = new Map();
        let mermaidIdCounter = 0;

        knownLocationsSnapshot.forEach(doc => {
            const originalId = doc.id;
            const safeId = `loc${mermaidIdCounter++}`;
            idMap.set(originalId, safeId);
            locations.set(originalId, {
                safeId: safeId,
                ...doc.data()
            });
        });

        let mermaidSyntax = 'graph TD;\n';
        mermaidSyntax += '    %% --- Node Definitions & Styles ---\n';
        const typeStyles = {
            '城市': 'fill:#ffe8d6,stroke:#8c6f54,stroke-width:2px,color:#3a2d21',
            '縣城': 'fill:#ffe8d6,stroke:#8c6f54,stroke-width:2px,color:#3a2d21',
            '村莊': 'fill:#f0fff0,stroke:#28a745,stroke-width:1px,color:#000',
            '建築': 'fill:#e7f5ff,stroke:#0d6efd,stroke-width:1px,color:#000',
            '門派': 'fill:#f8f0ff,stroke:#845ef7,stroke-width:2px,color:#000',
            '山寨': 'fill:#fff5f5,stroke:#dc3545,stroke-width:2px,color:#000',
            '自然景觀': 'fill:#e6fcf5,stroke:#20c997,stroke-width:1px,color:#000',
        };

        locations.forEach((loc) => {
            mermaidSyntax += `    ${loc.safeId}["${loc.locationName}"];\n`;
            if (typeStyles[loc.locationType]) {
                mermaidSyntax += `    style ${loc.safeId} ${typeStyles[loc.locationType]};\n`;
            }
        });

        mermaidSyntax += '\n    %% --- Link Definitions ---\n';
        const definedLinks = new Set();
        locations.forEach((loc) => {
            // 【核心修改】增加從 address 推斷 parent 的後備邏輯
            let parentName = loc.parentLocation;
            if (!parentName && loc.address) {
                if(loc.address.town && loc.address.district) parentName = loc.address.district;
                else if(loc.address.district && loc.address.city) parentName = loc.address.city;
                else if(loc.address.city && loc.address.region) parentName = loc.address.region;
                else if(loc.address.region && loc.address.country) parentName = loc.address.country;
            }

            // 處理父子層級關係
            if (parentName && idMap.has(parentName)) {
                const parentSafeId = idMap.get(parentName);
                const childSafeId = loc.safeId;
                const linkKey = `${parentSafeId}-->${childSafeId}`;
                if (!definedLinks.has(linkKey)) {
                    mermaidSyntax += `    ${parentSafeId} -->|包含| ${childSafeId};\n`;
                    definedLinks.add(linkKey);
                }
            }

            // 【核心新增】處理同級地點連接關係
            if (loc.geography && Array.isArray(loc.geography.nearbyLocations)) {
                loc.geography.nearbyLocations.forEach(neighbor => {
                    if (neighbor.name && idMap.has(neighbor.name)) {
                        const sourceSafeId = loc.safeId;
                        const targetSafeId = idMap.get(neighbor.name);
                        
                        // 確保連接線不重複繪製 (A-B 和 B-A 視為同一條)
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
