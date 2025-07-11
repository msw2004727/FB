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

        const subgraphs = [];
        const links = new Set();
        const locationNodeIds = new Map();

        // 第一次遍歷：定義所有節點和子圖
        locationsSnapshot.forEach(doc => {
            const data = doc.data();
            const locName = data.locationName || doc.id;
            const facilities = data.facilities || [];
            
            // 為每個地點名稱創建一個唯一的ID，避免特殊字元問題
            const locId = locName.replace(/[\s\W]/g, '_');
            locationNodeIds.set(locName, locId);

            let subgraphSyntax = `    subgraph ${locId} ["${locName}"]\n`;
            
            if (facilities.length > 0) {
                 facilities.forEach((facility, index) => {
                    const facilityId = `${locId}_facility_${index}`;
                    subgraphSyntax += `        ${facilityId}("${facility.facilityName}");\n`;
                });
            } else {
                // 如果沒有設施，則子圖內只有一個代表地點本身的節點
                // 為了能讓連結指向這個子圖，我們還是使用 locId 作為代表
            }
            subgraphSyntax += `    end\n`;
            subgraphs.push(subgraphSyntax);
        });

        // 第二次遍歷：建立所有連結
        locationsSnapshot.forEach(doc => {
            const data = doc.data();
            const currentLocationName = data.locationName || doc.id;
            const currentLocationId = locationNodeIds.get(currentLocationName);

            if (data.geography && Array.isArray(data.geography.nearbyLocations)) {
                data.geography.nearbyLocations.forEach(neighbor => {
                    if (neighbor.name && locationNodeIds.has(neighbor.name)) {
                        const neighborId = locationNodeIds.get(neighbor.name);
                        
                        // 為了避免重複連線 (A->B 和 B->A)，我們將ID排序後作為唯一鍵
                        const relationshipKey = [currentLocationId, neighborId].sort().join('<-->');
                        
                        if (!links.has(relationshipKey)) {
                            const travelTime = neighbor.travelTime || '路途未知';
                            // 使用 "---" 讓 Mermaid 自動決定最佳路徑
                            const linkSyntax = `    ${currentLocationId} -- "${travelTime}" --- ${neighborId};`;
                            links.add(relationshipKey); // 將鍵加入，用於檢查重複
                            links.add(linkSyntax);      // 將語法加入
                        }
                    }
                });
            }
        });
        
        // 從 links 集合中過濾掉我們用來檢查重複的鍵
        const finalLinks = [...links].filter(link => !link.includes('<-->'));

        // 組合最終的 Mermaid 語法
        const mermaidSyntax = `graph TD;\n${subgraphs.join('\n')}\n\n${finalLinks.join('\n')}`;

        res.json({ mermaidSyntax });

    } catch (error) {
        console.error('[世界地圖系統] 生成地圖時發生錯誤:', error);
        res.status(500).json({ message: '繪製世界輿圖時發生內部錯誤。' });
    }
});

module.exports = router;
