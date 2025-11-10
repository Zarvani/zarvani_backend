// ============= routes/paymentRoutes.js =============
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/create-order', paymentController.createOrder);
router.post('/verify', paymentController.verifyPayment);
router.post('/cash', paymentController.cashPayment);
router.get('/history', paymentController.getPaymentHistory);
router.post('/refund/:id', paymentController.initiateRefund);

module.exports = router;
