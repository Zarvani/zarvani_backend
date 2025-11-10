// ============= routes/shopRoutes.js =============
const express = require('express');
const router = express.Router();
const shopController = require('../controllers/shopController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { 
  uploadProfile, 
  uploadMultipleDocuments, 
  uploadImages 
} = require('../middleware/uploadMiddleware');

router.use(protect);
router.use(authorize('shop'));

router.get('/profile', shopController.getProfile);
router.put('/profile', uploadProfile, shopController.updateProfile);
router.post('/documents', uploadMultipleDocuments, shopController.uploadDocuments);
router.post('/products', uploadImages, shopController.addProduct);
router.get('/products', shopController.getMyProducts);
router.put('/products/:id', uploadImages, shopController.updateProduct);
router.delete('/products/:id', shopController.deleteProduct);
router.get('/orders', shopController.getOrders);
router.put('/orders/:id/status', shopController.updateOrderStatus);

module.exports = router;
