// ============= routes/userRoutes.js =============
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadProfile } = require('../middleware/uploadMiddleware');


router.get("/category", userController.getServicesByCategory);
router.get("/services", userController.getServices);
router.get("/servicesbyid/:id", userController.getServiceById);
router.post('/reviews', userController.submitReview);

router.use(protect);
router.use(authorize('user'));

router.get('/profile', userController.getProfile);
router.put('/profile', uploadProfile, userController.updateProfile);
router.post('/address', userController.addAddress);
router.get('/address', userController.getAddresses);
router.put('/address/:addressId', userController.updateAddress);
router.patch('/address/:addressId/default', userController.setDefaultAddress);
router.delete('/address/:addressId', userController.deleteAddress);
router.get('/bookings', userController.getBookingHistory);


module.exports = router;