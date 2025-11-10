// ============= routes/adminRoutes.js =============
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);
router.use(authorize('admin', 'superadmin'));

// User Management
router.get('/users', adminController.getAllUsers);
router.get('/users/:id', adminController.getUserDetails);
router.put('/users/:id/status', adminController.updateUserStatus);

// Provider Management
router.get('/providers', adminController.getAllProviders);
router.get('/providers/:id', adminController.getProviderDetails);
router.put('/providers/:id/verify', adminController.verifyProvider);
router.put('/providers/:id/reject', adminController.rejectProvider);

// Shop Management
router.get('/shops', adminController.getAllShops);
router.get('/shops/:id', adminController.getShopDetails);
router.put('/shops/:id/verify', adminController.verifyShop);
router.put('/shops/:id/reject', adminController.rejectShop);

// Booking Management
router.get('/bookings', adminController.getAllBookings);
router.get('/bookings/:id', adminController.getBookingDetails);

// Analytics
router.get('/analytics/dashboard', adminController.getDashboardStats);
router.get('/analytics/revenue', adminController.getRevenueStats);
router.get('/analytics/top-services', adminController.getTopServices);
router.get('/analytics/top-providers', adminController.getTopProviders);

// Service Categories
router.post('/services', adminController.addService);
router.get('/services', adminController.getServices);
router.get('/services/categories', adminController.getServiceCategories);
router.get('/services/:id', adminController.getServiceDetails);
router.put('/services/:id', adminController.updateService);
router.put('/services/:id/toggle-status', adminController.toggleServiceStatus);
router.delete('/services/:id', adminController.deleteService);


// Notifications
router.post('/notifications/send', adminController.sendBulkNotification);

module.exports = router;