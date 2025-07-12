// /scripts/populateRulers.js

/**
 * 說明：
 * 這是一個一次性執行的維護腳本。
 * 目的：掃描 Firestore 資料庫中的 `locations` 集合，為所有沒有 'ruler' (統治者) 欄位的地點，
 * 自動生成一個符合中文語境的統治者姓名並填充該欄位。
 * * 如何使用：
 * 1. 將此檔案放置在您的後端專案的 `/scripts` 資料夾中。
 * 2. 確保您的環境已安裝 `firebase-admin`。
 * 3. 確保您的 Firebase 服務帳戶金鑰 (serviceAccountKey.json) 位於正確的路徑。
 * 4. 在您的伺服器或本地環境中，透過終端機執行此腳本: `node scripts/populateRulers.js`
 * 5. 腳本會自動連接到您的資料庫，完成檢查與更新，並在控制台輸出執行日誌。
 * * 注意：此腳本只會對缺少 `ruler` 欄位的地點進行添加，不會覆蓋已有的統治者資訊。
 */

const admin = require('firebase-admin');
// 重要：請確保您的服務帳號金鑰路徑正確
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// 用於生成隨機統治者姓名的詞庫
const SURNAMES = [
  '趙', '錢', '孫', '李', '周', '吳', '鄭', '王', '馮', '陳', '褚', '衛', '蔣', '沈', '韓', '楊', 
  '朱', '秦', '尤', '許', '何', '呂', '施', '張', '孔', '曹', '嚴', '華', '金', '魏', '陶', '姜',
  '戚', '謝', '鄒', '喻', '柏', '水', '竇', '章', '雲', '蘇', '潘', '葛', '奚', '范', '彭', '郎',
  '魯', '韋', '昌', '馬', '苗', '鳳', '花', '方', '俞', '任', '袁', '柳', '酆', '鮑', '史', '唐'
];
const GIVEN_NAMES = [
  '霸', '天', '龍', '傲', '風', '雲', '海', '山', '河', '川', '林', '森', '武', '文', '斌', '哲',
  '威', '雄', '傑', '豪', '英', '毅', '誠', '信', '義', '仁', '禮', '智', '輝', '光', '明', '遠',
  '博', '淵', '瀚', '軒', '宇', '寰', '峰', '巒', '泰', '然', '安', '邦', '定', '國', '平', '章'
];

// 生成一個隨機名字
function generateRulerName() {
  const surname = SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
  const givenName1 = GIVEN_NAMES[Math.floor(Math.random() * GIVEN_NAMES.length)];
  const givenName2 = GIVEN_NAMES[Math.floor(Math.random() * GIVEN_NAMES.length)];
  // 避免生成如 "趙霸霸" 這樣的重複名字
  return givenName1 === givenName2 ? `${surname}${givenName1}` : `${surname}${givenName1}${givenName2}`;
}

async function populateRulers() {
  console.log('腳本啟動：開始檢查並填充各地統治者...');
  const locationsRef = db.collection('locations');
  const snapshot = await locationsRef.get();

  if (snapshot.empty) {
    console.log('找不到任何地點資料。');
    return;
  }

  const batch = db.batch();
  let updatesCount = 0;

  snapshot.forEach(doc => {
    const locationData = doc.data();
    const locationName = locationData.name || doc.id;

    // 檢查是否需要填充統治者
    // 條件：地點類型是人造設施，且沒有 ruler 欄位或 ruler 欄位為空字串
    const isGovernable = ['村莊', '城鎮', '城市', '都府', '山寨', '門派', '堡壘'].includes(locationData.locationType);
    const hasRuler = locationData.ruler && locationData.ruler.trim() !== '';

    if (isGovernable && !hasRuler) {
      const newRulerName = generateRulerName();
      batch.update(doc.ref, { ruler: newRulerName });
      console.log(`[新增] 地點「${locationName}」的統治者設定為：${newRulerName}`);
      updatesCount++;
    } else if (isGovernable && hasRuler) {
      console.log(`[跳過] 地點「${locationName}」已有統治者：${locationData.ruler}`);
    } else {
      console.log(`[跳過] 地點「${locationName}」(${locationData.locationType}) 無需設定統治者。`);
    }
  });

  if (updatesCount > 0) {
    await batch.commit();
    console.log(`\n任務完成！共為 ${updatesCount} 個地點新增了統治者。`);
  } else {
    console.log('\n任務完成！所有需要統治者的地點都已有資料，無需更新。');
  }
}

populateRulers().catch(console.error);
