// api/gcpRoutes.js
const express = require('express');
const router = express.Router();
const { CloudBillingClient } = require('@google-cloud/billing');

// 初始化Billing Client
// SDK會自動從環境變數(FIREBASE_SERVICE_ACCOUNT)中讀取您的金鑰
const billingClient = new CloudBillingClient();

/**
 * @route   GET /api/gcp/billing-info
 * @desc    獲取GCP帳單帳戶資訊
 * @access  Private (Admin)
 */
router.get('/billing-info', async (req, res) => {
    // !!!【請務必替換成您自己的帳單ID】!!!
    const billingAccountId = 'XXXXXX-XXXXXX-XXXXXX'; 

    if (billingAccountId === 'XXXXXX-XXXXXX-XXXXXX') {
        return res.status(400).json({ 
            error: '後端尚未設定GCP帳單帳戶ID。',
            message: '請在 api/gcpRoutes.js 中填入您的Billing Account ID。'
        });
    }

    const name = `billingAccounts/${billingAccountId}`;

    try {
        const [account] = await billingClient.getBillingAccount({ name });
        res.json({
            displayName: account.displayName,
            open: account.open,
            masterBillingAccount: account.masterBillingAccount
        });
    } catch (error) {
        console.error('GCP Billing API 錯誤:', error);
        res.status(500).json({ 
            error: '無法從GCP獲取帳單資訊。',
            message: '請確認：1. 帳單ID是否正確。 2. 服務帳號是否擁有「Billing Account Viewer」權限。 3. Cloud Billing API是否已啟用。'
        });
    }
});

module.exports = router;
