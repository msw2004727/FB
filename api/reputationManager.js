// api/reputationManager.js
const admin = require('firebase-admin');
const db = admin.firestore();

// 定義哪些關係類型是正面的
const POSITIVE_RELATIONSHIP_TYPES = ['父親', '母親', '兒子', '女兒', '妻子', '丈夫', '兄弟', '姊妹', '師父', '徒弟', '摯友', '愛人', '盟友', '恩人', '祖父', '祖母', '孫子', '孫女', '外公', '外婆', '外孫', '外孫女', '堂兄弟', '表兄弟', '堂姊妹', '表姊妹', '族人'];
// 定義哪些關係類型是負面的
const NEGATIVE_RELATIONSHIP_TYPES = ['殺父仇人', '殺母仇人', '宿敵', '仇人', '死敵', '叛徒'];

/**
 * 【核心修改 2.0】處理NPC死亡後的連鎖聲譽變化，現在可以處理複數死者
 * @param {string} userId - 玩家ID
 * @param {Array<string>} deceasedNpcNames - 本次戰鬥中所有死去NPC的姓名陣列
 * @param {string} murderLocation - 謀殺發生的地點
 * @param {Array<string>} alliesInCombat - 戰鬥中玩家的盟友名字列表
 * @param {string|null} killerName - 兇手的名字
 * @returns {Promise<string>} 一段描述聲譽變化的文字摘要
 */
async function processReputationChangesAfterDeath(userId, deceasedNpcNames, murderLocation, alliesInCombat = [], killerName = null) {
    if (!deceasedNpcNames || deceasedNpcNames.length === 0) {
        return '';
    }

    console.log(`[關係引擎] 啟動！處理NPC ${deceasedNpcNames.join('、')} 死亡後的連鎖反應...`);
    const batch = db.batch();
    const userNpcStatesRef = db.collection('users').doc(userId).collection('npc_states');
    let reputationChangeSummary = [];
    const processedNpcs = new Set(); // 防止重複處理同一個NPC的關係

    try {
        for (const deceasedNpcName of deceasedNpcNames) {
            // 1. 獲取死者的通用模板，以了解其人際關係
            const deceasedNpcTemplateDoc = await db.collection('npcs').doc(deceasedNpcName).get();
            if (!deceasedNpcTemplateDoc.exists) {
                console.warn(`[關係引擎] 找不到死者「${deceasedNpcName}」的模板，跳過其關係鏈處理。`);
                continue;
            }
            const deceasedNpcData = deceasedNpcTemplateDoc.data();
            const deceasedRelationships = deceasedNpcData.relationships || {};

            // 2. 找出所有與死者有關係的NPC
            const relatedNpcs = {};
            for (const type of POSITIVE_RELATIONSHIP_TYPES) {
                if (deceasedRelationships[type]) {
                    // 如果一個關係類型有多個NPC（例如多個'兒子'），則處理陣列
                    const names = Array.isArray(deceasedRelationships[type]) ? deceasedRelationships[type] : [deceasedRelationships[type]];
                    for (const name of names) {
                        relatedNpcs[name] = { type: 'friend', relationship: type, source: deceasedNpcName };
                    }
                }
            }
            for (const type of NEGATIVE_RELATIONSHIP_TYPES) {
                if (deceasedRelationships[type]) {
                    const names = Array.isArray(deceasedRelationships[type]) ? deceasedRelationships[type] : [deceasedRelationships[type]];
                     for (const name of names) {
                        relatedNpcs[name] = { type: 'enemy', relationship: type, source: deceasedNpcName };
                    }
                }
            }

            // 3. 處理這些有直接關係的NPC
            for (const [npcName, relation] of Object.entries(relatedNpcs)) {
                if (processedNpcs.has(npcName)) continue; // 如果已經處理過，就跳過
                processedNpcs.add(npcName);

                const npcStateRef = userNpcStatesRef.doc(npcName);
                if (relation.type === 'friend' && killerName) {
                    const revengeReason = `殺害我${relation.relationship}「${relation.source}」之仇`;
                    batch.set(npcStateRef, {
                        friendlinessValue: -100,
                        revengeInfo: {
                            target: killerName,
                            reason: revengeReason,
                            timestamp: admin.firestore.FieldValue.serverTimestamp()
                        }
                    }, { merge: true });
                    reputationChangeSummary.push(`身為${relation.source}至親的「${npcName}」已將你視為血海深仇的敵人。`);
                } else if (relation.type === 'enemy') {
                    batch.set(npcStateRef, { friendlinessValue: admin.firestore.FieldValue.increment(50) }, { merge: true });
                    reputationChangeSummary.push(`${relation.source}的宿敵「${npcName}」對你的行為頗為讚賞，對你的好感大幅提升。`);
                }
            }
        }

        // 4. 處理現場目擊者 (這個邏輯保持不變，因為是針對地點的)
        const witnessesSnapshot = await userNpcStatesRef.where('currentLocation', '==', murderLocation).get();
        if (!witnessesSnapshot.empty) {
            for (const doc of witnessesSnapshot.docs) {
                const witnessName = doc.id;

                // 跳過玩家本人、死者、盟友、以及已經處理過的直接關係人
                if (deceasedNpcNames.includes(witnessName) || alliesInCombat.includes(witnessName) || processedNpcs.has(witnessName)) {
                    continue;
                }

                const witnessData = doc.data();
                if (witnessData.friendlinessValue >= 0) {
                    const penalty = -(Math.floor(Math.random() * 16) + 15); // -15 to -30
                    batch.update(doc.ref, { friendlinessValue: admin.firestore.FieldValue.increment(penalty) });
                    reputationChangeSummary.push(`在場的「${witnessName}」目睹了你的暴行，對你產生了恐懼與厭惡。`);
                }
            }
        }

        await batch.commit();
        console.log(`[關係引擎] 已成功處理 ${deceasedNpcNames.join('、')} 死亡的連鎖反應。`);

        return reputationChangeSummary.join(' ');

    } catch (error) {
        console.error(`[關係引擎] 在處理NPC死亡時發生嚴重錯誤:`, error);
        return '江湖的反應，似乎超出了預料...';
    }
}

module.exports = {
    processReputationChangesAfterDeath,
};
