const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

console.log("【偵錯日誌 1】: 伺服器檔案開始讀取...");

// 根路由
app.get('/', (req, res) => {
    console.log("【偵錯日誌 2】: 根路由 '/' 被成功訪問。");
    res.send('偵錯伺服器運行中！根路由正常！');
});

console.log("【偵錯日誌 3】: 根路由 '/' 已註冊。");

// 讀取進度路由
app.get('/latest-game', (req, res) => {
    console.log("【偵錯日誌 4】: '/latest-game' 路由被成功訪問。");
    // 回傳一個前端能處理的假資料
    res.json({
        story: "[偵錯模式] 成功連接到 /latest-game！如果看到此訊息，代表路由正常！",
        roundData: { R: 0, LOC: ["偵錯地點"], EVT: "路由測試成功" }
    });
});

console.log("【偵錯日誌 5】: '/latest-game' 路由已註冊。");

// 互動路由
app.post('/interact', (req, res) => {
    console.log("【偵錯日誌 6】: '/interact' 路由被成功訪問。");
    // 回傳一個前端能處理的假資料
    res.json({
        story: "[偵錯模式] 成功連接到 /interact！",
        roundData: { R: 1, LOC: ["偵錯地點"] }
    });
});

console.log("【偵錯日誌 7】: '/interact' 路由已註冊。");

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`【偵錯日誌 8】: 伺服器成功啟動於 Port: ${PORT}`);
});

console.log("【偵錯日誌 9】: 伺服器檔案讀取完畢，已設定監聽。");
