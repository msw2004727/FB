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
            const id = data.locationId || doc.id;
            locations.set(id, { id, children: [], ...data });
        });

        // 建立父子關係樹
        const locationTree = [];
        locations.forEach(loc => {
            if (loc.parentLocation && locations.has(loc.parentLocation)) {
                const parent = locations.get(loc.parentLocation);
                parent.children.push(loc);
            } else {
                // 沒有父級的，視為頂層節點
                locationTree.push(loc);
            }
        });

        // 遞迴生成 Mermaid 語法
        function buildMermaidSubgraph(location, level) {
            const indent = '    '.repeat(level);
            let subgraphSyntax = `${indent}subgraph ${location.id} ["${location.locationName}"]\n`;
            
            // 為不同類型的地點定義樣式
            subgraphSyntax += `${indent}    style ${location.id} fill:#f9f9f9,stroke:#333,stroke-width:2px\n`;
            
            if (location.children && location.children.length > 0) {
                location.children.forEach(child => {
                    subgraphSyntax += buildMermaidSubgraph(child, level + 1);
                });
            } else {
                 // 如果沒有子節點，添加一個隱藏的方向，確保子圖正確渲染
                 subgraphSyntax += `${indent}    direction TB\n`;
            }
            
            subgraphSyntax += `${indent}end\n`;
            return subgraphSyntax;
        }
        
        let mermaidSyntax = 'graph TD;\n';
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
        mermaidSyntax += '\n' + finalLinks.join('');

        res.json({ mermaidSyntax });

    } catch (error) {
        console.error('[世界地圖系統] 生成地圖時發生錯誤:', error);
        res.status(500).json({ message: '繪製世界輿圖時發生內部錯誤。' });
    }
});

module.exports = router;
