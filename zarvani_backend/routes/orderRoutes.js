// ============= routes/orderRoutes.js (NEW) =============
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);

// User routes
router.post('/', authorize('user'), orderController.createOrder);
router.get('/:orderId/tracking', authorize('user'), orderController.getOrderTracking);
router.put('/:orderId/cancel', authorize('user'), orderController.cancelOrder);

// Shop routes
router.post('/:orderId/accept', authorize('shop'), orderController.acceptOrder);
router.post('/:orderId/reject', authorize('shop'), orderController.rejectOrder);
router.put('/:orderId/status', authorize('shop'), orderController.updateOrderStatus);
router.get('/shop/pending', authorize('shop'), orderController.getShopPendingOrders);

// Delivery Partner routes
router.get('/delivery/pending', authorize('provider'), orderController.getPendingDeliveries);
router.post('/:orderId/accept-delivery', authorize('provider'), orderController.acceptDelivery);
router.put('/:orderId/delivery-location', authorize('provider'), orderController.updateDeliveryLocation);
router.post('/:orderId/delivered', authorize('provider'), orderController.markDelivered);

module.exports = router;