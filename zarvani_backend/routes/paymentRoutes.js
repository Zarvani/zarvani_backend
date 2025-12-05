const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect, authorize } = require('../middleware/authMiddleware');

// ============= PUBLIC ROUTES =============
// UPI Webhook (no authentication required for webhooks)
router.post('/webhook/upi', paymentController.upiPaymentWebhook);

// ============= PROTECTED ROUTES (All authenticated users) =============
router.use(protect);

// Basic Payment Routes
router.post('/create-order', paymentController.createOrder);
router.post('/verify', paymentController.verifyPayment);
router.post('/cash', paymentController.cashPayment);
router.post('/process', paymentController.processPayment);
router.post('/complete-service', paymentController.completeService);
router.post('/refund/:id', paymentController.initiateRefund);

// Payment History & Analytics
router.get('/history', paymentController.getPaymentHistory);
router.get('/details/:id', paymentController.getPaymentDetails);

// QR Payment Routes
router.post('/qr/generate-user', paymentController.generateUserQRPayment);
router.post('/qr/generate-collection', paymentController.generateCollectionQR);
router.get('/qr/status/:paymentId', paymentController.getQRPaymentStatus);

// Commission Summary for Providers/Shops
router.get('/commissions/summary', paymentController.getOwnerCommissionSummary);

// ============= SHOP-SPECIFIC ROUTES =============
router.get('/shop-earnings', authorize('shop', 'admin'), paymentController.getShopEarnings);

// ============= PROVIDER-SPECIFIC ROUTES =============
router.get('/provider-earnings', authorize('provider', 'admin'), paymentController.getProviderEarnings);

// ============= ADMIN-ONLY ROUTES =============
router.get('/analytics', authorize('admin'), paymentController.getPaymentAnalytics);
router.get('/all-earnings', authorize('admin'), paymentController.getAllEarningsOverview);
router.post('/qr/check-expired', authorize('admin'), paymentController.checkExpiredQRs);

// Commission Management Routes
router.get('/commissions/pending', authorize('admin'), paymentController.getPendingCommissions);
router.post('/commissions/mark-paid', authorize('admin'), paymentController.markCommissionPaid);
router.post('/commissions/send-reminders', authorize('admin'), paymentController.sendCommissionReminders);
router.get('/commissions/stats', authorize('admin'), paymentController.getCommissionStats);
router.get('/commissions/report', authorize('admin'), paymentController.generateCommissionReport);

module.exports = router;