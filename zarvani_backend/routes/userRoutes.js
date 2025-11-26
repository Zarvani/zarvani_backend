// ============= routes/userRoutes.js =============
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadProfile } = require('../middleware/uploadMiddleware');


router.get("/category", userController.getServicesByCategory);
router.use(protect);
router.use(authorize('user'));

router.get('/profile', userController.getProfile);
router.put('/profile', uploadProfile, userController.updateProfile);
router.post('/address', userController.addAddress);
router.get('/bookings', userController.getBookingHistory);
router.post('/reviews', userController.submitReview);
router.get("/services", userController.getServices);



module.exports = router;