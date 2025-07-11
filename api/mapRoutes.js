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
        const allNodes = new Set();

        locationsSnapshot.forEach(doc => {
            const data = doc.data();
            const id = data.locationId || doc.id;
            locations.set(id, { id, children: [], ...data });
            allNodes.add(id);
        });

        // 建立父子關係樹
        const locationTree = [];
        locations.forEach(loc => {
            if (loc.parentLocation && locations.has(loc.parentLocation)) {
                const parent = locations.get(loc.parentLocation);
                if (parent) {
                    parent.children.push(loc);
                }
            } else {
                // 沒有父級的，視為頂層節點
                locationTree.push(loc);
            }
        });

        // 遞迴生成 Mermaid 子圖語法
        function buildMermaidSubgraph(location, level) {
            const indent = '    '.repeat(level);
            let subgraphSyntax = `${indent}subgraph ${location.id} ["${location.locationName}"]\n`;
            
            // 如果沒有子節點，添加一個隱藏的方向，確保子圖正確渲染
            if (!location.children || location.children.length === 0) {
                 subgraphSyntax += `${indent}    direction TB\n`;
                 // 為了讓它顯示出來，加一個代表自身的隱藏節點
                 subgraphSyntax += `${indent}    ${location.id}_self(( ))\n`;
                 subgraphSyntax += `${indent}    style ${location.id}_self fill:none,stroke:none\n`;
            } else {
                 location.children.forEach(child => {
                    subgraphSyntax += buildMermaidSubgraph(child, level + 1);
                });
            }
            
            subgraphSyntax += `${indent}end\n`;
            return subgraphSyntax;
        }
        
        // 樣式定義
        let styleSyntax = '    %% --- 樣式定義 ---\n';
        const typeStyles = {
            '城市': 'fill:#ffe8d6,stroke:#8c6f54,stroke-width:2px,color:#3a2d21',
            '村莊': 'fill:#f0fff0,stroke:#28a745,stroke-width:1px,color:#000',
            '建築': 'fill:#e7f5ff,stroke:#0d6efd,stroke-width:1px,color:#000',
            '門派': 'fill:#f8f0ff,stroke:#845ef7,stroke-width:2px,color:#000',
            '山寨': 'fill:#fff5f5,stroke:#dc3545,stroke-width:2px,color:#000',
            '自然景觀': 'fill:#e6fcf5,stroke:#20c997,stroke-width:1px,color:#000',
        };

        locations.forEach(loc => {
            if (typeStyles[loc.locationType]) {
                styleSyntax += `    style ${loc.id} ${typeStyles[loc.locationType]};\n`;
            }
        });

        let mermaidSyntax = 'graph TD;\n';
        mermaidSyntax += styleSyntax + '\n';

        locationTree.forEach(rootLocation => {
            mermaidSyntax += buildMermaidSubgraph(rootLocation, 1);
        });

        // 處理跨越父級的連結 (nearbyLocations)
        const links = new Set();
        locations.forEach(loc => {
             if (loc.geography && Array.isArray(loc.geography.nearbyLocations)) {
                loc.geography.nearbyLocations.forEach(neighbor => {
                    if (neighbor.name && locations.has(neighbor.name)) {
                        const sourceId = loc.id;
                        const targetId = neighbor.name;
                        
                        const relationshipKey = [sourceId, targetId].sort().join('<-->');
                        if (!links.has(relationshipKey)) {
                            const travelTime = neighbor.travelTime || '...';
                            const linkSyntax = `    ${sourceId} -- "${travelTime}" --- ${targetId};\n`;
                            links.add(relationshipKey);
                            links.add(linkSyntax);
                        }
                    }
                });
            }
        });

        const finalLinks = [...links].filter(link => !link.includes('<-->'));
        mermaidSyntax += '\n    %% --- 地點連結 ---\n' + finalLinks.join('');

        res.json({ mermaidSyntax });

    } catch (error) {
        console.error('[世界地圖系統] 生成地圖時發生錯誤:', error);
        res.status(500).json({ message: '繪製世界輿圖時發生內部錯誤。' });
    }
});

module.exports = router;
