// ============= routes/payment.js =============
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Public/User routes
router.use(protect);
// Public routes
router.post('/create-order', protect, paymentController.createOrder);
router.post('/verify', protect, paymentController.verifyPayment);
router.post('/cash', protect, paymentController.cashPayment);
router.post('/process', protect, paymentController.processPayment);

// User routes
router.get('/history', protect, paymentController.getPaymentHistory);
router.post('/complete-service', protect, paymentController.completeService);

// Provider/Shop routes
router.get('/earnings', protect, paymentController.getProviderEarnings);
router.get('/shop-earnings', protect, paymentController.getShopEarnings);

// Admin routes
router.get('/admin/commissions/pending', 
  protect, 
  authorize('admin'), 
  paymentController.getPendingCommissions
);
router.post('/admin/commissions/collect', 
  protect, 
  authorize('admin'), 
  paymentController.collectCommission
);
router.get('/admin/analytics', 
  protect, 
  authorize('admin'), 
  paymentController.getPaymentAnalytics
);
router.get('/admin/earnings', 
  protect, 
  authorize('admin'), 
  paymentController.getAllEarningsOverview
);

module.exports = router;