const Cart = require('../models/Cart');
const Product = require('../models/Product');
const ResponseHandler = require('../utils/responseHandler');

// ======================= GET CART =======================
exports.getCart = async (req, res) => {
  try {
    const cart = await Cart.getUserCart(req.user.id);
    return ResponseHandler.success(res, cart, 'Cart fetched successfully');
  } catch (error) {
    return ResponseHandler.error(res, error.message, 500);
  }
};

// ======================= ADD TO CART =======================
exports.addToCart = async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;

    if (!productId) {
      return ResponseHandler.error(res, 'Product ID is required', 400);
    }

    const product = await Product.findById(productId);
    if (!product) {
      return ResponseHandler.error(res, 'Product not found', 404);
    }

    let cart = await Cart.findOne({ user: req.user.id });

    // If no cart, create one
    if (!cart) {
      cart = new Cart({
        user: req.user.id,
        shop: product.shop,
        items: []
      });
    }

    // Prevent cross-shop ordering
    if (cart.shop && cart.shop.toString() !== product.shop.toString()) {
      return ResponseHandler.error(
        res,
        'You can only order from one shop at a time. Clear your cart first.',
        400
      );
    }

    if (!cart.shop) cart.shop = product.shop;

    await cart.addItem(productId, quantity);

    const populatedCart = await Cart.findById(cart._id)
      .populate('items.product', 'name images price sellingPrice isAvailable stock')
      .populate('shop', 'name address');

    return ResponseHandler.success(
      res,
      populatedCart,
      'Item added to cart successfully'
    );
  } catch (error) {
    return ResponseHandler.error(res, error.message, 500);
  }
};

// ======================= UPDATE QUANTITY =======================
exports.updateQuantity = async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity } = req.body;

    if (quantity < 1) {
      return ResponseHandler.error(res, 'Quantity must be at least 1', 400);
    }

    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart) {
      return ResponseHandler.error(res, 'Cart not found', 404);
    }

    await cart.updateItemQuantity(productId, quantity);

    const populatedCart = await Cart.findById(cart._id)
      .populate('items.product', 'name images price sellingPrice isAvailable stock')
      .populate('shop', 'name address');

    return ResponseHandler.success(res, populatedCart, 'Cart updated successfully');
  } catch (error) {
    return ResponseHandler.error(res, error.message, 500);
  }
};

// ======================= REMOVE ITEM =======================
exports.removeFromCart = async (req, res) => {
  try {
    const { productId } = req.params;

    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart) {
      return ResponseHandler.error(res, 'Cart not found', 404);
    }

    await cart.removeItem(productId);

    const populatedCart = await Cart.findById(cart._id)
      .populate('items.product', 'name images price sellingPrice isAvailable stock')
      .populate('shop', 'name address');

    return ResponseHandler.success(
      res,
      populatedCart,
      'Item removed from cart successfully'
    );
  } catch (error) {
    return ResponseHandler.error(res, error.message, 500);
  }
};

// ======================= CLEAR CART =======================
exports.clearCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id });

    if (!cart) {
      return ResponseHandler.error(res, 'Cart not found', 404);
    }

    await cart.clearCart();

    return ResponseHandler.success(res, {}, 'Cart cleared successfully');
  } catch (error) {
    return ResponseHandler.error(res, error.message, 500);
  }
};

// ======================= CART COUNT =======================
exports.getCartCount = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id });
    const count = cart ? cart.itemCount : 0;

    return ResponseHandler.success(res, { count }, 'Cart count fetched');
  } catch (error) {
    return ResponseHandler.error(res, error.message, 500);
  }
};

// ======================= CART SUMMARY =======================
exports.getCartSummary = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id });

    if (!cart) {
      return ResponseHandler.error(res, 'Cart not found', 404);
    }

    const summary = cart.getSummary();

    return ResponseHandler.success(res, summary, 'Cart summary fetched');
  } catch (error) {
    return ResponseHandler.error(res, error.message, 500);
  }
};
