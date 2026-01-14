const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { validatePayment } = require('../middleware/paymentValidator');

// ============= PUBLIC ROUTES =============

// UPI Payment Webhook (no auth required, uses signature verification)
router.post('/webhook/upi', paymentController.upiPaymentWebhook);

// ============= USER ROUTES =============

// QR Payment Routes
router.post('/qr/create',
  protect,
  authorize('user'),
  validatePayment('createQR'),
  paymentController.createPaymentWithQR
);

router.get('/qr/status/:paymentId',
  protect,
  authorize('user', 'provider', 'shop', 'admin'),
  paymentController.getQRPaymentStatus
);

// UPI Deep Link
router.post('/upi/deeplink',
  protect,
  authorize('user', 'provider', 'shop'),
  paymentController.generateUPIDeepLink
);

// Payment History & Details
router.get('/history',
  protect,
  authorize('user'),
  paymentController.getPaymentHistory
);

router.get('/details/:id',
  protect,
  authorize('user', 'provider', 'shop', 'admin'),
  paymentController.getPaymentDetails
);
router.put('/update/:entityId', protect, paymentController.updatePaymentStatus);

router.get('/status/:paymentId', protect, paymentController.checkPaymentStatus);
router.post('/commission/pay/:paymentId', authorize('provider', 'shop'), paymentController.payCommission);
router.get('/commissions/pending', authorize('provider', 'shop'), paymentController.getMyPendingCommissions);
router.get('/admin/commissions/stats', authorize('admin'), paymentController.getCommissionStats);
router.get('/admin/commissions/pending', authorize('admin'), paymentController.getPendingCommissions);
// Razorpay Integration
router.post('/razorpay/create',
  protect,
  authorize('user'),
  validatePayment('createRazorpayOrder'),
  paymentController.createOrder
);

router.post('/razorpay/verify',
  protect,
  authorize('user'),
  validatePayment('verifyPayment'),
  paymentController.verifyPayment
);

// Cash Payment
router.post('/cash',
  protect,
  authorize('user'),
  validatePayment('cashPayment'),
  paymentController.cashPayment
);

// Refund Request
router.post('/:id/refund',
  protect,
  authorize('user'),
  validatePayment('refund'),
  paymentController.initiateRefund
);

// ============= PROVIDER ROUTES =============

// Collection QR
router.post('/provider/qr/collection',
  protect,
  authorize('provider'),
  validatePayment('collectionQR'),
  paymentController.generateCollectionQR
);

// Provider Earnings
router.get('/provider/earnings',
  protect,
  authorize('provider'),
  paymentController.getProviderEarnings
);

// Provider Commission Summary
router.get('/provider/commission/summary',
  protect,
  authorize('provider'),
  paymentController.getOwnerCommissionSummary
);

// ============= SHOP ROUTES =============

// Collection QR
router.post('/shop/qr/collection',
  protect,
  authorize('shop'),
  validatePayment('collectionQR'),
  paymentController.generateCollectionQR
);

// Shop Earnings
router.get('/shop/earnings',
  protect,
  authorize('shop'),
  paymentController.getShopEarnings
);

// Shop Commission Summary
router.get('/shop/commission/summary',
  protect,
  authorize('shop'),
  paymentController.getOwnerCommissionSummary
);

// Unified Owner Earnings (for both provider/shop)
router.get('/owner/earnings',
  protect,
  authorize('provider', 'shop'),
  paymentController.getOwnerEarnings
);

// ============= ADMIN ROUTES =============

// Commission Management
router.get('/admin/commissions/pending',
  protect,
  authorize('admin'),
  paymentController.getPendingCommissions
);

router.get('/admin/commissions/overdue',
  protect,
  authorize('admin'),
  paymentController.getOverdueCommissions
);

router.post('/admin/commissions/mark-paid',
  protect,
  authorize('admin'),
  validatePayment('markCommissionPaid'),
  paymentController.markCommissionPaid
);

// Manual Payment Verification
router.post('/admin/verify/manual',
  protect,
  authorize('admin'),
  validatePayment('manualVerification'),
  paymentController.verifyManualUPIPayment
);

// Analytics & Reports
router.get('/admin/analytics',
  protect,
  authorize('admin'),
  paymentController.getPaymentAnalytics
);

router.get('/admin/commission/stats',
  protect,
  authorize('admin'),
  paymentController.getCommissionStats
);

router.get('/admin/commission/report',
  protect,
  authorize('admin'),
  paymentController.generateCommissionReport
);

// All Earnings Overview
router.get('/admin/earnings/overview',
  protect,
  authorize('admin'),
  paymentController.getAllEarningsOverview
);

// ============= CRON JOB ROUTES (Protected by API Key) =============

// Expire old QR codes (run every 10 minutes)
router.post('/cron/expire-qr',
  paymentController.checkExpiredQRs
);

// Send commission reminders (run daily at 10 AM)
router.post('/cron/commission-reminders',
  paymentController.sendCommissionReminders
);

module.exports = router;