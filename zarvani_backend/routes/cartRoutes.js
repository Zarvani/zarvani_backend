const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getCart,
  addToCart,
  updateQuantity,
  removeFromCart,
  clearCart,
  getCartCount,
  getCartSummary
} = require('../controllers/cartController');

// All routes are protected
router.use(protect);

router.route('/')
  .get(getCart);

router.route('/add')
  .post(addToCart);

router.route('/update/:productId')
  .put(updateQuantity);

router.route('/remove/:productId')
  .delete(removeFromCart);

router.route('/clear')
  .delete(clearCart);

router.route('/count')
  .get(getCartCount);

router.route('/summary')
  .get(getCartSummary);

module.exports = router;