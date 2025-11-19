// ============= routes/paymentRoutes.js =============
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Public/User routes
router.use(protect);

// Payment operations
router.post('/create-order', paymentController.createOrder);
router.post('/verify', paymentController.verifyPayment);
router.post('/cash', paymentController.cashPayment);
router.post('/refund/:id', paymentController.initiateRefund);

// User payment history
router.get('/history', paymentController.getPaymentHistory);

// Shop earnings (for shop owners)
router.get('/shop/earnings', 
  authorize('shop', 'admin'), 
  paymentController.getShopEarnings
);

// Provider earnings (for service providers)
router.get('/provider/earnings', 
  authorize('provider', 'admin'), 
  paymentController.getProviderEarnings
);

// Superadmin routes
router.get('/admin/overview', 
  authorize('admin', 'superadmin'), 
  paymentController.getAllEarningsOverview
);

router.get('/admin/analytics', 
  authorize('admin', 'superadmin'), 
  paymentController.getPaymentAnalytics
);

module.exports = router;