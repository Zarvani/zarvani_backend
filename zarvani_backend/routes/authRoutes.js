// ============= routes/authRoutes.js =============
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { validateSchema, schemas } = require('../middleware/validateRequest');

router.post('/signup', validateSchema(schemas.signup), authController.signup);
router.post('/send-otp', authController.sendOTP);
router.post('/verify-otp', validateSchema(schemas.verifyOTP), authController.verifyOTP);
router.post('/login', validateSchema(schemas.login), authController.loginWithPassword);
router.post('/login-otp', authController.loginWithOTP);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/change-password', protect, authController.changePassword);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', protect, authController.logout);
router.get('/me', protect, authController.getCurrentUser);

module.exports = router;