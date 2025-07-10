// api/reputationManager.js
const admin = require('firebase-admin');
const db = admin.firestore();

// 定義哪些關係類型是正面的
const POSITIVE_RELATIONSHIP_TYPES = ['父親', '母親', '兒子', '女兒', '妻子', '丈夫', '兄弟', '姊妹', '師父', '徒弟', '摯友', '愛人', '盟友', '恩人'];
// 定義哪些關係類型是負面的
const NEGATIVE_RELATIONSHIP_TYPES = ['殺父仇人', '殺母仇人', '宿敵', '仇人', '死敵', '叛徒'];

/**
 * 處理NPC死亡後的連鎖聲譽變化
 * @param {string} userId - 玩家ID
 * @param {string} deceasedNpcName - 死去NPC的姓名
 * @param {string} murderLocation - 謀殺發生的地點
 * @param {Array<string>} alliesInCombat - 戰鬥中玩家的盟友名字列表
 * @returns {Promise<string>} 一段描述聲譽變化的文字摘要
 */
async function processReputationChangesAfterDeath(userId, deceasedNpcName, murderLocation, alliesInCombat = []) {
    console.log(`[關係引擎] 啟動！處理NPC「${deceasedNpcName}」死亡後的連鎖反應...`);
    const batch = db.batch();
    const userNpcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    let reputationChangeSummary = [];

    try {
        // 1. 獲取死者的通用模板，以了解其人際關係
        const deceasedNpcTemplateDoc = await db.collection('npcs').doc(deceasedNpcName).get();
        if (!deceasedNpcTemplateDoc.exists) {
            console.warn(`[關係引擎] 找不到死者「${deceasedNpcName}」的模板，無法處理關係鏈。`);
            return '';
        }
        const deceasedNpcData = deceasedNpcTemplateDoc.data();
        const deceasedRelationships = deceasedNpcData.relationships || {};

        // 2. 找出所有與死者有關係的NPC
        const relatedNpcs = {};
        for (const type of POSITIVE_RELATIONSHIP_TYPES) {
            if (deceasedRelationships[type]) {
                relatedNpcs[deceasedRelationships[type]] = 'friend';
            }
        }
        for (const type of NEGATIVE_RELATIONSHIP_TYPES) {
            if (deceasedRelationships[type]) {
                relatedNpcs[deceasedRelationships[type]] = 'enemy';
            }
        }

        // 3. 處理這些有直接關係的NPC
        for (const [npcName, relationType] of Object.entries(relatedNpcs)) {
            const npcStateRef = userNpcStatesRef.doc(npcName);
            if (relationType === 'friend') {
                // 親友變世仇
                batch.set(npcStateRef, { friendlinessValue: -100 }, { merge: true });
                reputationChangeSummary.push(`身為死者至親的「${npcName}」已將你視為血海深仇的敵人。`);
            } else if (relationType === 'enemy') {
                // 宿敵變友好
                batch.set(npcStateRef, { friendlinessValue: admin.firestore.FieldValue.increment(50) }, { merge: true });
                reputationChangeSummary.push(`死者的宿敵「${npcName}」對你的行為頗為讚賞，對你的好感大幅提升。`);
            }
        }

        // 4. 處理現場目擊者
        const witnessesSnapshot = await userNpcStatesRef.where('currentLocation', '==', murderLocation).get();
        if (!witnessesSnapshot.empty) {
            for (const doc of witnessesSnapshot.docs) {
                const witnessName = doc.id;
                const witnessData = doc.data();

                // 跳過玩家本人、死者、盟友、以及已經處理過的直接關係人
                if (witnessName === deceasedNpcName || alliesInCombat.includes(witnessName) || relatedNpcs[witnessName]) {
                    continue;
                }
                
                // 只影響中立或友好的目擊者
                if (witnessData.friendlinessValue >= 0) {
                    const penalty = -(Math.floor(Math.random() * 16) + 15); // -15 to -30
                    batch.update(doc.ref, { friendlinessValue: admin.firestore.FieldValue.increment(penalty) });
                    reputationChangeSummary.push(`在場的「${witnessName}」目睹了你的暴行，對你產生了恐懼與厭惡。`);
                }
            }
        }

        await batch.commit();
        console.log(`[關係引擎] 已成功處理「${deceasedNpcName}」死亡的連鎖反應。`);
        
        return reputationChangeSummary.join(' ');

    } catch (error) {
        console.error(`[關係引擎] 在處理「${deceasedNpcName}」死亡時發生嚴重錯誤:`, error);
        return '江湖的反應，似乎超出了預料...'; // 返回一個安全的預設值
    }
}

module.exports = {
    processReputationChangesAfterDeath,
};
