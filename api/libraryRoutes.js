const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * @route   GET /api/library/novels
 * @desc    獲取所有已發布小說的列表
 * @access  Public
 */
router.get('/novels', async (req, res) => {
    try {
        const novelsRef = db.collection('library_novels');
        // 根據最後更新時間排序，最新的排在最前面
        const snapshot = await novelsRef.orderBy('lastUpdated', 'desc').get();

        if (snapshot.empty) {
            return res.json([]);
        }

        const novelsList = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id, // 這就是作者的 userId
                playerName: data.playerName || '無名氏',
                novelTitle: data.novelTitle || '未命名故事',
                lastUpdated: data.lastUpdated.toDate(), // 轉換為可讀日期格式
                isDeceased: data.isDeceased || false,
                lastChapterTitle: data.lastChapterTitle || '開篇'
            };
        });

        res.json(novelsList);

    } catch (error) {
        console.error('[圖書館系統] 獲取小說列表時發生錯誤:', error);
        res.status(500).json({ message: '讀取圖書館書庫時發生內部錯誤。' });
    }
});

/**
 * @route   GET /api/library/novel/:userId
 * @desc    根據使用者ID獲取單本小說的完整內容
 * @access  Public
 */
router.get('/novel/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) {
            return res.status(400).json({ message: '未提供使用者ID。' });
        }

        const novelDocRef = db.collection('library_novels').doc(userId);
        const doc = await novelDocRef.get();

        if (!doc.exists) {
            return res.status(404).json({ message: '找不到這本江湖傳奇。' });
        }

        const novelData = doc.data();
        
        // 只回傳小說需要顯示的公開資訊
        res.json({
            playerName: novelData.playerName,
            novelTitle: novelData.novelTitle,
            storyHTML: novelData.storyHTML,
            lastUpdated: novelData.lastUpdated.toDate(),
            isDeceased: novelData.isDeceased
        });

    } catch (error) {
        console.error(`[圖書館系統] 獲取單本小說(ID: ${req.params.userId})時發生錯誤:`, error);
        res.status(500).json({ message: '讀取這本江湖傳奇時發生內部錯誤。' });
    }
});


module.exports = router;
