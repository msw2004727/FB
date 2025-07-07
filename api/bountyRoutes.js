// api/bountyRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth');

const db = admin.firestore();

// 所有此路由下的請求都需要先經過身份驗證
router.use(authMiddleware);

/**
 * @route   GET /api/bounties
 * @desc    獲取當前玩家所有活躍的懸賞任務
 * @access  Private
 */
router.get('/', async (req, res) => {
    const userId = req.user.id;
    try {
        const now = admin.firestore.Timestamp.now();
        const bountiesRef = db.collection('users').doc(userId).collection('bounties');
        
        // 查詢所有狀態為 'active' 且尚未過期的懸賞
        const snapshot = await bountiesRef
            .where('status', '==', 'active')
            .where('expireAt', '>', now)
            .orderBy('expireAt', 'asc')
            .get();

        if (snapshot.empty) {
            return res.json([]);
        }

        const bountiesList = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                title: data.title,
                content: data.content,
                issuer: data.issuer,
                difficulty: data.difficulty,
                // 將 Firestore Timestamp 轉換為 JavaScript Date 物件，方便前端處理
                expireAt: data.expireAt.toDate() 
            };
        });

        res.json(bountiesList);

    } catch (error) {
        console.error(`[懸賞系統] 獲取玩家 ${userId} 的懸賞列表時發生錯誤:`, error);
        res.status(500).json({ message: '讀取懸賞告示時發生內部錯誤。' });
    }
});

module.exports = router;
