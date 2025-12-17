const express = require('express');
const router = express.Router();
const commissionController = require('../controllers/commissionController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Provider routes
router.use(protect);
router.get('/provider/summary', authorize('provider'), commissionController.getProviderCommissionSummary);
router.post('/provider/mark-paid/:bookingId', authorize('provider'), commissionController.markBookingPaid);
router.get('/provider/dashboard', authorize('provider'), commissionController.getCommissionDashboard);
router.post('/provider/pay-commission/:paymentId', authorize('provider'), commissionController.payCommission);

// Shop routes
router.get('/shop/summary', authorize('shop'), commissionController.getShopCommissionSummary);
router.post('/shop/mark-paid/:orderId', authorize('shop'), commissionController.markOrderPaid);
router.get('/shop/dashboard', authorize('shop'), commissionController.getCommissionDashboard);
router.post('/shop/pay-commission/:paymentId', authorize('shop'), commissionController.payCommission);

// Admin routes
router.get('/admin/pending', authorize('admin'), commissionController.getAllPendingCommissions);
router.get('/admin/stats', authorize('admin'), commissionController.getCommissionStats);
router.post('/admin/mark-paid/:paymentId', authorize('admin'), commissionController.adminMarkCommissionPaid);

module.exports = router;