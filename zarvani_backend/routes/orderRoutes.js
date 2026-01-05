// ================================================
// Order Routes
// ================================================

const express = require('express');
const router = express.Router();

const orderController = require('../controllers/orderController');
const { protect, authorize } = require('../middleware/authMiddleware');

// =================================================
// =============== USER ROUTES =====================
// =================================================

// Create new order (User only)
router.post(
  '/create',
  protect,
  authorize('user'),
  orderController.createOrder
);
router.get(
  '/stats',
  protect,
  authorize('admin', 'super_admin', 'shop'),
  orderController.getOrderStats
);

// Get logged-in user's orders
router.get(
  '/user',
  protect,
  authorize('user'),
  orderController.getUserOrders
);

// Get order details (User, Shop, Admin, Delivery Boy)
router.get(
  '/:orderId',
  protect,
  authorize('user', 'shop', 'admin', 'delivery_boy'),
  orderController.getOrderDetails
);

// Track an order (User only)
router.get(
  '/:orderId/tracking',
  protect,
  authorize('user'),
  orderController.getOrderTracking
);

// Cancel order (User only)
router.put(
  '/:orderId/cancel',
  protect,
  authorize('user'),
  orderController.cancelOrder
);

// =================================================
// =============== SHOP ROUTES =====================
// =================================================

// Get orders assigned to the logged-in shop
router.get(
  '/shop/orders',
  protect,
  authorize('shop'),
  orderController.getShopOrders
);

// Accept order (Shop only)
router.put(
  '/:orderId/accept',
  protect,
  authorize('shop'),
  orderController.acceptOrder
);

// Reject order (Shop only)
router.put(
  '/:orderId/reject',
  protect,
  authorize('shop'),
  orderController.rejectOrder
);

// Update order status (preparing, ready, etc.)
router.put(
  '/:orderId/status',
  protect,
  authorize('shop'),
  orderController.updateOrderStatus
);

// Cancel order by shop
router.put(
  '/:orderId/shop-cancel',
  protect,
  authorize('shop'),
  orderController.shopCancelOrder
);

// =================================================
// ========== DELIVERY BOY ROUTES ==================
// =================================================

// Get delivery boy assigned orders
router.get(
  '/delivery-boy/orders',
  protect,
  authorize('delivery_boy'),
  orderController.getDeliveryBoyOrders
);

// Pickup an order
router.put(
  '/:orderId/pickup',
  protect,
  authorize('delivery_boy'),
  orderController.pickupOrder
);

// Update live delivery location
router.put(
  '/:orderId/delivery-location',
  protect,
  authorize('delivery_boy'),
  orderController.updateDeliveryLocation
);

// Mark order as delivered
router.put(
  '/:orderId/deliver',
  protect,
  authorize('delivery_boy'),
  orderController.markDelivered
);
router.put('/:id/mark-paid', authorize('shop','delivery_boy'), orderController.markOrderPaid);
router.get('/commissions/summary', authorize('shop'), orderController.getShopCommissionSummary);
// Update delivery boy online/offline status
router.put('/delivery-boy/status',protect,authorize('delivery_boy'),orderController.updateDeliveryBoyStatus);

// =================================================
// =============== PUBLIC ROUTES ===================
// =================================================
// List all available shops (no auth)
router.get('/shops/available', orderController.getAvailableShops);
// ==================== ADMIN ORDER MANAGEMENT ====================

// Get all orders with filters
router.get(
  '/',
  protect,
  authorize('admin', 'super_admin'),
  orderController.getAllOrders
);

// Get order details
router.get(
  '/:orderId',
  protect,
  authorize('admin', 'super_admin'),
  orderController.getOrderDetails
);

// Update order (admin override)
router.put(
  '/:orderId',
  protect,
  authorize('admin', 'super_admin'),
  orderController.updateOrder
);

// Cancel order as admin
router.put(
  '/:orderId/Admincancel',
  protect,
  authorize('admin', 'super_admin'),
  orderController.AdmincancelOrder
);

// Get order analytics
router.get(
  '/analytics/orders',
  protect,
  authorize('admin', 'super_admin'),
  orderController.getOrderAnalytics
);

// Export orders
router.get(
  '/export/orders',
  protect,
  authorize('admin', 'super_admin'),
  orderController.exportOrders
);

module.exports = router;
