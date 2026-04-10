// /api/authRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateAndCacheLocation } = require('./worldEngine');
const { runDataHealthCheck } = require('./dataIntegrityService');
const { DEFAULT_USER_FIELDS } = require('./models/userModel');

const db = admin.firestore();

router.post('/register', async (req, res) => {
    try {
        const { username, gender, password } = req.body;
        if (!username || !gender || !password) {
            return res.status(400).json({ message: '所有欄位皆為必填。' });
        }

        const userSnapshot = await db.collection('users').where('username', '==', username).get();
        if (!userSnapshot.empty) {
            return res.status(400).json({ message: '此名號已被註冊。' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const newUserRef = db.collection('users').doc();
        await newUserRef.set({
            username,
            gender,
            passwordHash,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            timeOfDay: '上午',
            yearName: '元祐',
            year: 1,
            month: 1,
            day: 1,
            ...DEFAULT_USER_FIELDS,
        });
        
        // 【核心修正】直接在背包中創建初始的50兩銀子
        const inventoryRef = newUserRef.collection('inventory_items');
        await inventoryRef.doc('銀兩').set({
            templateId: '銀兩',
            itemType: '財寶',
            quantity: 50,
        });

        const skillsCollectionRef = newUserRef.collection('skills');
        await skillsCollectionRef.doc('現代搏擊').set({
            name: '現代搏擊',
            type: '拳腳',
            level: 1,
            exp: 0,
            cost: 0,
            description: '來自另一個世界的格鬥技巧，招式直接有效，講求一擊制敵，但似乎缺少內力運轉的法門。',
            acquiredAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[註冊流程] 正在為新玩家 ${username} 主動建立初始地點「無名村」...`);
        await generateAndCacheLocation(newUserRef.id, '無名村', '村莊', '玩家初入江湖，身在無名村。');
        console.log(`[註冊流程] 「無名村」建立完畢。`);

        const roundZeroData = {
            R: 0,
            playerState: 'alive',
            timeOfDay: '上午',
            powerChange: { internal: 0, external: 0, lightness: 0 },
            moralityChange: 0,
            // 【核心修正】移除 moneyChange，改為 itemChanges
            itemChanges: [{ action: 'add', itemName: '銀兩', quantity: 50 }],
            ATM: ['幽暗', '濃重藥草味', '一絲血腥味'],
            EVT: '從天旋地轉中醒來，靈魂墜入陌生的時代',
            LOC: ['無名村'],
            PSY: '頭痛欲裂...我不是在滑手機嗎？這身體不是我的！這裡是哪裡？這是什麼時代？',
            PC: '你身受重傷，氣息虛弱，似乎不久於人世。',
            story: '最後的印象，是指尖在冰冷螢幕上的飛速滑動，社交軟體的資訊流在眼前如瀑布般刷過。下一瞬，難以言喻的暈眩感猛然來襲，世界在你眼前扭曲、碎裂，一陣劇烈的天旋地轉後，意識如風中殘燭般徹底陷入黑暗。\n\n你在一股濃重刺鼻的藥草味中勉強睜開雙眼，映入眼簾的，不再是熟悉的螢幕光，而是一盞昏黃的油燈，照著四周斑駁的牆面與層層疊疊、標示著陌生藥名的木櫃。你正躺在一張簡陋的木板床上，每一次呼吸都牽動著撕心裂肺的劇痛，四肢百骸彷彿不屬於自己。\n\n「我不是在滑手機嗎？」這個念頭在你腦中一閃而過，卻顯得如此荒謬。關於這個世界的記憶一片空白，你是誰？為何在此？無從得知。你只清楚記得自己來自一個截然不同的世界。\n\n身旁，一位年逾五旬、留著山羊鬍的郎中正為你沉聲診脈，他眉頭緊鎖，那雙深邃的眼眸中，除了對你傷勢的憂慮，似乎還隱藏著一絲驚疑與不為人知的秘密。\n\n環顧這間陌生的藥鋪，遠方隱約傳來雞鳴犬吠，你意識到自己被困在了這個名為「無名村」的未知之地。過去已然斷裂，前路一片迷茫，你的人生，就從這副重傷的軀體與滿腹的疑問中，被迫展開了……',
            NPC: [{
                name: '王大夫',
                status: '憂心忡忡地為你把脈',
                friendliness: 'neutral',
                friendlinessValue: 10,
                isNew: true
            }],
            QST: '探查自身與周遭的處境。',
            WRD: '天色陰沉，細雨濛濛。',
            LOR: '你似乎被一位郎中所救。',
            CLS: '身上有多處不明的傷口，似乎經歷過一場惡鬥。',
            IMP: '你的靈魂穿越到這個陌生的時代，一段新的人生就此展開。',
            internalPower: 5,
            externalPower: 5,
            lightness: 5,
            stamina: 25,
            morality: 0,
            yearName: '元祐',
            year: 1,
            month: 1,
            day: 1
        };
        await newUserRef.collection('game_saves').doc('R0').set(roundZeroData);

        const token = jwt.sign(
            { userId: newUserRef.id, username: username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({ 
            message: '註冊成功，正在進入遊戲...', 
            token, 
            username 
        });

    } catch (error) {
        console.error("註冊失敗:", error);
        res.status(500).json({ message: '伺服器內部錯誤，註冊失敗。' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const userSnapshot = await db.collection('users').where('username', '==', username).get();

        if (userSnapshot.empty) {
            return res.status(401).json({ message: '姓名或密碼錯誤。' });
        }

        const userDoc = userSnapshot.docs[0];
        const userData = userDoc.data();
        const userId = userDoc.id;

        if (userData.isDeceased === true) {
            return res.status(403).json({ message: '此名號的主人已身故，其傳奇已載入史冊。請另創名號再戰江湖。' });
        }

        const isPasswordMatch = await bcrypt.compare(password, userData.passwordHash);
        if (!isPasswordMatch) {
            return res.status(401).json({ message: '姓名或密碼錯誤。' });
        }
        
        // 【核心修改】註解掉此行，取消登入時的健康檢查
        // runDataHealthCheck(userId, username).catch(err => {
        //     console.error(`[背景健康檢查] 為玩家 ${username} 執行時發生錯誤:`, err);
        // });
        
        const token = jwt.sign(
            { userId: userId, username: userData.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ message: '登入成功！', token, username: userData.username });
    } catch (error) {
        console.error("登入失敗:", error);
        res.status(500).json({ message: '伺服器內部錯誤，登入失敗。' });
    }
});

module.exports = router;
