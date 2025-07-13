// /api/authRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateAndCacheLocation } = require('./worldEngine');
const { generateNpcTemplateData } = require('../services/npcCreationService');
const { getOrGenerateItemTemplate } = require('./playerStateHelpers');
const { v4: uuidv4 } = require('uuid');


const db = admin.firestore();

// --- 統治者名稱生成器 (從populateRulers.js移植過來) ---
const SURNAMES = [
  '趙', '錢', '孫', '李', '周', '吳', '鄭', '王', '馮', '陳', '褚', '衛', '蔣', '沈', '韓', '楊', 
  '朱', '秦', '尤', '許', '何', '呂', '施', '張', '孔', '曹', '嚴', '華', '金', '魏', '陶', '姜'
];
const GIVEN_NAMES = [
  '霸', '天', '龍', '傲', '風', '雲', '海', '山', '河', '川', '林', '武', '文', '斌', '哲', '威', 
  '雄', '傑', '豪', '英', '毅', '誠', '信', '義', '輝', '光', '明', '遠', '博', '軒', '宇', '峰'
];
function generateRulerName() {
  const surname = SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
  const givenName1 = GIVEN_NAMES[Math.floor(Math.random() * GIVEN_NAMES.length)];
  const givenName2 = GIVEN_NAMES[Math.floor(Math.random() * GIVEN_NAMES.length)];
  return givenName1 === givenName2 ? `${surname}${givenName1}` : `${surname}${givenName1}${givenName2}`;
}
// --- 統治者名稱生成器結束 ---


const DEFAULT_USER_FIELDS = {
    money: 50,
    internalPower: 5,
    externalPower: 5,
    lightness: 5,
    morality: 0,
    stamina: 100, // 修正：新玩家初始精力應為100
    bulkScore: 0,
    isDeceased: false,
    equipment: {
        head: null,
        body: null,
        hands: null,
        feet: null,
        weapon_right: null,
        weapon_left: null,
        weapon_back: null,
        accessory1: null,
        accessory2: null,
        manuscript: null,
    },
    maxInternalPowerAchieved: 5,
    maxExternalPowerAchieved: 5,
    maxLightnessAchieved: 5,
    customSkillsCreated: {
        internal: 0,
        external: 0,
        lightness: 0,
        none: 0
    },
    shortActionCounter: 0,
};

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
        
        // 為新玩家創建初始銀兩物品
        await newUserRef.collection('inventory_items').doc('銀兩').set({
            templateId: '銀兩',
            quantity: 50,
            itemType: '財寶'
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
            moneyChange: 0, // moneyChange 應為0, 因為初始金錢已在 inventory_items 中
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
            itemChanges: [],
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
            money: 50,
            silver: 0,
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
        
        // --- 【核心】登入時的資料完整性健康檢查 ---
        // 這個函式會在背景執行，不會延遲登入回應
        runDataHealthCheck(userId, username).catch(err => {
            console.error(`[背景健康檢查] 為玩家 ${username} 執行時發生錯誤:`, err);
        });
        
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


/**
 * 【***最終修復版 v4.0***】資料健康檢查與遷移函式
 * @param {string} userId - 玩家ID
 * @param {string} username - 玩家名稱
 */
async function runDataHealthCheck(userId, username) {
    console.log(`[健康檢查 v4.0] 開始為玩家 ${username} 執行登入後資料健康檢查與遷移...`);
    const userDocRef = db.collection('users').doc(userId);
    let playerProfile;
    try {
        playerProfile = (await userDocRef.get()).data();
        if (!playerProfile) {
            console.error(`[健康檢查 v4.0] 嚴重錯誤：找不到玩家 ${username} 的檔案！`);
            return;
        }
    } catch (e) {
        console.error(`[健康檢查 v4.0] 讀取玩家 ${username} 檔案時發生錯誤:`, e);
        return;
    }
    
    // --- 檢查點 1: 修補核心欄位與【資料類型】---
    console.log(`[健康檢查 v4.0] 階段1: 檢查並修復玩家核心欄位...`);
    const fieldsToEnsureNumber = ['internalPower', 'externalPower', 'lightness', 'morality', 'stamina', 'money', 'bulkScore', 'R', 'shortActionCounter', 'year', 'month', 'day'];
    const updates = {};
    let needsUpdate = false;

    // 補全缺失的欄位
    for (const [field, defaultValue] of Object.entries(DEFAULT_USER_FIELDS)) {
        if (playerProfile[field] === undefined) {
            needsUpdate = true;
            updates[field] = defaultValue;
            console.log(`[健康檢查 v4.0] 補齊缺失欄位: ${field} ->`, defaultValue);
        }
    }

    // 修正錯誤的資料類型
    for (const field of fieldsToEnsureNumber) {
        if (playerProfile[field] !== undefined && typeof playerProfile[field] !== 'number') {
            needsUpdate = true;
            const parsedValue = Number(playerProfile[field]);
            // 如果無法轉換為數字，則使用預設值；否則使用轉換後的值
            updates[field] = isNaN(parsedValue) ? (DEFAULT_USER_FIELDS[field] || 0) : parsedValue;
            console.log(`[健康檢查 v4.0] 修正類型錯誤: ${field} 從 "${playerProfile[field]}" (${typeof playerProfile[field]}) 修復為 ${updates[field]} (number)。`);
        }
    }

    if (needsUpdate) {
        await userDocRef.update(updates);
        console.log(`[健康檢查 v4.0] 核心欄位與類型修復完成，已更新資料庫。`);
        // 重新獲取最新的玩家資料以供後續檢查使用
        playerProfile = (await userDocRef.get()).data();
    } else {
        console.log(`[健康檢查 v4.0] 核心欄位健康，無需修復。`);
    }

    // --- 檢查點 2: 處理舊版物品資料遷移 ---
    const oldInventoryDocRef = userDocRef.collection('game_state').doc('inventory');
    const oldInventoryDoc = await oldInventoryDocRef.get();

    if(oldInventoryDoc.exists) {
        console.log(`[資料遷移] 偵測到玩家 ${username} 存在舊版 inventory 資料，開始遷移...`);
        const oldInventoryData = oldInventoryDoc.data();
        const newInventoryCollectionRef = db.collection('users').doc(userId).collection('inventory_items');
        const migrationBatch = db.batch();
        let migratedCount = 0;

        for (const [itemName, itemData] of Object.entries(oldInventoryData)) {
            // 跳過無效的項目
            if (!itemName || !itemData || typeof itemData.quantity !== 'number' || itemData.quantity <= 0) continue;

            const templateResult = await getOrGenerateItemTemplate(itemName);
            if (templateResult?.template) {
                 const isStackable = !['武器', '裝備'].includes(templateResult.template.itemType);
                 if (isStackable) {
                     migrationBatch.set(newInventoryCollectionRef.doc(itemName), {
                         templateId: itemName,
                         quantity: itemData.quantity,
                         itemType: templateResult.template.itemType
                     }, { merge: true });
                 } else {
                     for(let i = 0; i < itemData.quantity; i++) {
                         migrationBatch.set(newInventoryCollectionRef.doc(uuidv4()), { 
                             templateId: itemName, 
                             quantity: 1, 
                             itemType: templateResult.template.itemType, 
                             isEquipped: false, 
                             equipSlot: null 
                         });
                     }
                 }
                 migratedCount++;
            }
        }
        // 遷移成功後，刪除舊的 inventory 文檔
        migrationBatch.delete(oldInventoryDocRef);
        await migrationBatch.commit();
        console.log(`[資料遷移] 成功為玩家 ${username} 遷移了 ${migratedCount} 種物品到新的 inventory_items 集合，並已刪除舊資料。`);
    }

    // --- 檢查點 3: 確保所有接觸過的NPC、物品、技能、地點都有模板 ---
    console.log(`[健康檢查 v4.0] 階段2: 檢查模板完整性...`);
    const allSavesData = (await userDocRef.collection('game_saves').orderBy('R', 'asc').get()).docs.map(doc => doc.data());
    
    // 檢查NPC
    const npcStatesSnapshot = await userDocRef.collection('npc_states').get();
    for (const doc of npcStatesSnapshot.docs) {
        const npcTemplateRef = db.collection('npcs').doc(doc.id);
        const templateDoc = await npcTemplateRef.get();
        if (!templateDoc.exists) {
            console.log(`[健康檢查 v4.0] NPC模板缺失: ${doc.id}，嘗試重建...`);
            const firstMentionRound = allSavesData.find(round => round.NPC?.some(npc => npc.name === doc.id));
            if(firstMentionRound) {
                const genData = await generateNpcTemplateData(username, { name: doc.id }, firstMentionRound, playerProfile);
                if(genData) {
                    await npcTemplateRef.set(genData.templateData, { merge: true });
                }
            } else {
                 console.warn(`[健康檢查 v4.0] 警告：在存檔中找不到NPC「${doc.id}」的初見情境，無法為其生成模板。`);
            }
        }
    }

    // 檢查物品
    const itemStatesSnapshot = await userDocRef.collection('inventory_items').get();
     for (const doc of itemStatesSnapshot.docs) {
        const itemData = doc.data();
        if(itemData.templateId) await getOrGenerateItemTemplate(itemData.templateId);
    }
    
    console.log(`[健康檢查 v4.0] 玩家 ${username} 的資料完整性檢查與遷移全部完成。`);
}


module.exports = router;
