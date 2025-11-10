// ============= routes/providerRoutes.js =============
const express = require('express');
const router = express.Router();
const providerController = require('../controllers/providerController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { 
  uploadProfile, 
  uploadMultipleDocuments, 
  uploadImages 
} = require('../middleware/uploadMiddleware');

router.use(protect);
router.use(authorize('provider'));

router.get('/profile', providerController.getProfile);
router.put('/profile', uploadProfile, providerController.updateProfile);
router.post('/documents', uploadMultipleDocuments, providerController.uploadDocuments);
router.post('/services', uploadImages, providerController.addService);
router.get('/services', providerController.getMyServices);
router.get('/bookings', providerController.getBookings);
router.put('/bookings/:bookingId/status', providerController.updateBookingStatus);

module.exports = router;