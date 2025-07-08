// api/mapRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * @route   GET /api/map/world-map
 * @desc    獲取整個遊戲世界的地圖資料
 * @access  Public
 */
router.get('/world-map', async (req, res) => {
    try {
        const locationsSnapshot = await db.collection('locations').get();

        if (locationsSnapshot.empty) {
            return res.json({ mermaidSyntax: 'graph TD;\nA[世界混沌初開，尚無人踏足];' });
        }
        
        const nodes = new Set();
        const links = new Set();

        locationsSnapshot.forEach(doc => {
            const data = doc.data();
            const currentLocation = data.locationName || doc.id;
            nodes.add(currentLocation); // 將當前地點加入節點

            if (data.geography && Array.isArray(data.geography.nearbyLocations)) {
                data.geography.nearbyLocations.forEach(neighbor => {
                    if (neighbor.name) {
                        nodes.add(neighbor.name); // 將相鄰地點也加入節點
                        
                        // 為了避免重複連線 (A->B 和 B->A)，我們將地點名稱排序後作為唯一鍵
                        const relationshipKey = [currentLocation, neighbor.name].sort().join('<-->');
                        
                        // 只有當這個關係尚未被記錄時，才新增連線
                        if (!links.has(relationshipKey)) {
                            const travelTime = neighbor.travelTime || '路途未知';
                            const linkSyntax = `    ${currentLocation} -- "${travelTime}" --- ${neighbor.name};`;
                            links.add(linkSyntax);
                            links.add(relationshipKey); // 將鍵也加入，用於檢查重複
                        }
                    }
                });
            }
        });
        
        // 從 links 集合中過濾掉我們用來檢查重複的鍵
        const finalLinks = [...links].filter(link => !link.includes('<-->'));

        // 組合最終的 Mermaid 語法
        const mermaidSyntax = `graph TD;\n${[...nodes].map(node => `    ${node};`).join('\n')}\n\n${finalLinks.join('\n')}`;

        res.json({ mermaidSyntax });

    } catch (error) {
        console.error('[世界地圖系統] 生成地圖時發生錯誤:', error);
        res.status(500).json({ message: '繪製世界輿圖時發生內部錯誤。' });
    }
});

module.exports = router;
