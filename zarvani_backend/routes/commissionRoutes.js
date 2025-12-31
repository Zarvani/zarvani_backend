const express = require('express');
const router = express.Router();
const commissionController = require('../controllers/commissionController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Apply authentication middleware to all routes
router.use(protect);

// ==================== PROVIDER ROUTES ====================
router.get('/provider/summary', authorize('provider'), commissionController.getProviderCommissionSummary);
router.get('/provider/dashboard', authorize('provider'), commissionController.getCommissionDashboard);
router.post('/provider/pay-commission/:paymentId', authorize('provider'), commissionController.payCommission);
router.get('/provider/earnings-summary', authorize('provider'), commissionController.getEarningsSummary);

// ==================== SHOP ROUTES ====================
router.get('/shop/summary', authorize('shop'), commissionController.getShopCommissionSummary);
router.get('/shop/dashboard', authorize('shop'), commissionController.getCommissionDashboard);
router.post('/shop/pay-commission/:paymentId', authorize('shop'), commissionController.payCommission);
router.get('/shop/earnings-summary', authorize('shop'), commissionController.getEarningsSummary);

// ==================== ADMIN ROUTES ====================
router.get('/admin/pending', authorize('admin'), commissionController.getAllPendingCommissions);
router.get('/admin/stats', authorize('admin'), commissionController.getCommissionStats);
router.post('/admin/mark-paid/:paymentId', authorize('admin'), commissionController.adminMarkCommissionPaid);
router.post('/admin/send-reminders', authorize('admin'), commissionController.sendCommissionReminders);
router.get('/admin/overdue', authorize('admin'), commissionController.getOverdueCommissions);

// ==================== COMMON ROUTES (Provider & Shop) ====================
router.get('/my-pending', authorize('provider', 'shop'), commissionController.getMyPendingCommissions);
router.get('/payment/:id', authorize('provider', 'shop'), commissionController.getCommissionPaymentDetails);

module.exports = router;