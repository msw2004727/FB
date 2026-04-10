// api/libraryRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * @route   GET /api/library/novels
 * @desc    獲取所有已發布小說的列表 (已修改為讀取最新章節回合數)
 * @access  Public
 */
router.get('/novels', async (req, res) => {
    try {
        const novelsRef = db.collection('library_novels');
        const snapshot = await novelsRef.orderBy('lastUpdated', 'desc').get();

        if (snapshot.empty) {
            return res.json([]);
        }

        // 使用 Promise.all 來並行處理所有小說的最新章節查詢
        const novelsListPromises = snapshot.docs.map(async (doc) => {
            const data = doc.data();
            let finalRoundNumber = '未知';

            // 【核心修正】為每本小說查詢其最新的章節
            const lastChapterSnapshot = await db.collection('library_novels')
                .doc(doc.id)
                .collection('chapters')
                .orderBy('round', 'desc')
                .limit(1)
                .get();

            if (!lastChapterSnapshot.empty) {
                finalRoundNumber = lastChapterSnapshot.docs[0].data().round;
            } else {
                // 如果章節不存在，作為備用方案，嘗試讀取主文件上的數字
                finalRoundNumber = data.lastRoundNumber !== undefined ? data.lastRoundNumber : '未知';
            }
            
            const timeString = `${data.lastYearName || '元祐'}${data.lastYear || 1}年${data.lastMonth || 1}月${data.lastDay || 1}日`;

            return {
                id: doc.id,
                playerName: data.playerName || '無名氏',
                novelTitle: data.lastChapterTitle || '開篇',
                lastUpdated: data.lastUpdated.toDate(),
                isDeceased: data.isDeceased || false,
                time: timeString,
                round: finalRoundNumber,
            };
        });

        const novelsList = await Promise.all(novelsListPromises);

        res.json(novelsList);

    } catch (error) {
        console.error('[圖書館系統] 獲取小說列表時發生錯誤:', error);
        res.status(500).json({ message: '讀取圖書館書庫時發生內部錯誤。' });
    }
});

/**
 * @route   GET /api/library/novel/:userId
 * @desc    根據使用者ID獲取單本小說的完整內容 (已修改為分片讀取)
 * @access  Public
 */
router.get('/novel/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) {
            return res.status(400).json({ message: '未提供使用者ID。' });
        }

        const novelDocRef = db.collection('library_novels').doc(userId);
        const novelDoc = await novelDocRef.get();

        if (!novelDoc.exists) {
            return res.status(404).json({ message: '找不到這本江湖傳奇。' });
        }
        
        const novelData = novelDoc.data();

        // 讀取 chapters 子集合
        const chaptersSnapshot = await novelDocRef.collection('chapters').orderBy('round', 'asc').get();
        
        if (chaptersSnapshot.empty) {
             return res.json({
                playerName: novelData.playerName,
                novelTitle: novelData.novelTitle || '未命名傳奇',
                storyHTML: '<p>這本傳奇空無一字。</p>',
                lastUpdated: novelData.lastUpdated.toDate(),
                isDeceased: novelData.isDeceased
            });
        }

        // 在伺服器端拼接所有章節的HTML
        const storyChapters = chaptersSnapshot.docs.map(doc => {
            const chapter = doc.data();
            const title = chapter.title || `第 ${chapter.round} 回`;
            const content = chapter.content || "這段往事，已淹沒在時間的長河中。";
            return `<div class="chapter"><h2>${title}</h2><p>${content.replace(/\n/g, '<br>')}</p></div>`;
        });
        const fullStoryHTML = storyChapters.join('');

        res.json({
            playerName: novelData.playerName,
            novelTitle: novelData.novelTitle || '未命名傳奇',
            storyHTML: fullStoryHTML,
            lastUpdated: novelData.lastUpdated.toDate(),
            isDeceased: novelData.isDeceased
        });

    } catch (error) {
        console.error(`[圖書館系統] 獲取單本小說(ID: ${req.params.userId})時發生錯誤:`, error);
        res.status(500).json({ message: '讀取這本江湖傳奇時發生內部錯誤。' });
    }
});


module.exports = router;
