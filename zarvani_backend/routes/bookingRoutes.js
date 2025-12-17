// routes/bookingRoutes.js
const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { validateSchema, schemas } = require('../middleware/validateRequest');

router.use(protect);

// User routes
router.post('/',  authorize('user'), bookingController.createBooking);
router.get('/my-bookings',  authorize('user'), bookingController.getUserBookings);
router.get('/:id',  bookingController.getBookingDetails);
router.get('/:id/tracking',  bookingController.getTrackingInfo);
router.get('/:id/acceptance-status',  authorize('user'), bookingController.getBookingAcceptanceStatus);
router.post('/:id/cancel',  authorize('user'), bookingController.cancelBooking);
router.post('/:id/resend-notifications',  authorize('user'), bookingController.resendProviderNotifications);
router.put('/:id/mark-paid', authorize('provider'), bookingController.markBookingPaid);
router.get('/commissions/summary', authorize('provider'), bookingController.getProviderCommissionSummary);
// Provider routes
router.get('/provider/pending-requests',  authorize('provider'), bookingController.getPendingRequests);
router.get('/provider/stats',  authorize('provider'), bookingController.getProviderStats);
router.get('/provider/bookings',  authorize('provider'), bookingController.getProviderBookings);
router.post('/:id/accept',  authorize('provider'), bookingController.acceptBooking);
router.post('/:id/reject',  authorize('provider'), bookingController.rejectBooking);
router.post('/:id/update-location',  authorize('provider'), bookingController.updateProviderLocation);
router.post('/:id/update-status',  authorize('provider'), bookingController.updateBookingStatus);

// Admin routes
router.get('/admin/all',  authorize('admin'), bookingController.getAllBookings);
router.post('/admin/:id/update-status',  authorize('admin'), bookingController.adminUpdateBookingStatus);

// Analytics routes (all roles)
router.get('/analytics',  bookingController.getBookingAnalytics);

module.exports = router;