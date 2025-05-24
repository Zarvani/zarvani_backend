const express = require('express');
const router = express.Router();
const { createOrder,
    getAvailableOrdersByCategory,
    acceptOrder,
    updateOrderStatus,
    getMyOrders,
    getUserOrders,
    getBatchOrderDetails,
    getServiceCategories,
    addProviderNote } = require('../Controller/OrderController');
const { Authentication, AuthorizeRole } = require("../Middleware/Authentication")

// CUSTOMER ROUTES
router.post('/create-order', Authentication, AuthorizeRole('customer'), createOrder);
router.get('/orders/my-orders', Authentication, AuthorizeRole('customer'), getUserOrders);
router.get('/ordersDetails/:orderId', Authentication, getBatchOrderDetails);

// SERVICE PROVIDER ROUTES
router.get('/orders/available/:category', Authentication, AuthorizeRole('serviceprovider'), getAvailableOrdersByCategory);
router.post('/orders/accept/:orderId', Authentication, AuthorizeRole('serviceprovider'), acceptOrder);
router.patch('/orders/status/:orderId', Authentication, AuthorizeRole('serviceprovider'), updateOrderStatus);
router.get('/orders/provider-orders', Authentication, AuthorizeRole('serviceprovider'), getMyOrders);

module.exports = router;
