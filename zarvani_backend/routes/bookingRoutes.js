// ============= routes/bookingRoutes.js (COMPLETE - ONLY REQUIRED ROUTES) =============
const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { validateSchema, schemas } = require('../middleware/validateRequest');

router.use(protect);

// ============= USER ROUTES =============
router.post('/', authorize('user'), validateSchema(schemas.createBooking), bookingController.createBooking);
router.get('/:id', bookingController.getBookingDetails);
router.put('/:id/cancel', authorize('user'), bookingController.cancelBooking);
router.get('/:id/tracking', authorize('user'), bookingController.getTrackingInfo);
router.get('/user/my-bookings',authorize('user'),bookingController.getUserBookings
);
// ============= PROVIDER ROUTES =============
router.get('/provider/pending-requests', authorize('provider'), bookingController.getPendingRequests);
router.post('/:bookingId/accept', authorize('provider'), bookingController.acceptBooking);
router.post('/:bookingId/reject', authorize('provider'), bookingController.rejectBooking);
router.put('/:bookingId/status', authorize('provider'), bookingController.updateBookingStatus);
router.put('/:bookingId/location', authorize('provider'), bookingController.updateProviderLocation);
router.get('/provider/my-bookings',authorize('provider'),bookingController.getProviderBookings);
router.get('/provider/stats',authorize('provider'),bookingController.getProviderStats);

module.exports = router;