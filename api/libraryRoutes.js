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
            
            // 從 lastChapterData 中提取更多資訊，並提供預設值以防出錯
            const lastChapterData = data.lastChapterData || {};
            const timeString = `${lastChapterData.yearName || '元祐'}${lastChapterData.year || 1}年${lastChapterData.month || 1}月${lastChapterData.day || 1}日`;

            return {
                id: doc.id, // 這就是作者的 userId
                playerName: data.playerName || '無名氏',
                novelTitle: data.lastChapterTitle || '開篇', // 直接將最新章節設為標題
                lastUpdated: data.lastUpdated.toDate(),
                isDeceased: data.isDeceased || false,
                time: timeString, // 新增：時間
                round: lastChapterData.R !== undefined ? lastChapterData.R : '未知', // 新增：回合數
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
        
        const title = novelData.lastChapterTitle || novelData.novelTitle || '未命名傳奇';

        res.json({
            playerName: novelData.playerName,
            novelTitle: title,
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
