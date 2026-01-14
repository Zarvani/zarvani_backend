const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  price: {
    type: Number,
    required: true
  },
  total: {
    type: Number,
    required: true
  }
}, { _id: false });

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  shop: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop'
  },
  items: [cartItemSchema],
  itemCount: {
    type: Number,
    default: 0
  },
  subtotal: {
    type: Number,
    default: 0
  },
  deliveryFee: {
    type: Number,
    default: 0
  },
  total: {
    type: Number,
    default: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
cartSchema.index({ shop: 1 });
cartSchema.index({ 'lastUpdated': 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }); // Auto expire after 30 days

// Calculate totals before saving
cartSchema.pre('save', async function (next) {
  this.itemCount = this.items.reduce((sum, item) => sum + item.quantity, 0);
  this.subtotal = this.items.reduce((sum, item) => sum + item.total, 0);

  // Calculate delivery fee (example: free above 500, else 49)
  this.deliveryFee = this.subtotal > 500 ? 0 : 49;

  this.total = this.subtotal + this.deliveryFee;
  this.lastUpdated = new Date();

  next();
});

// Static method to get or create cart for user
cartSchema.statics.getUserCart = async function (userId) {
  let cart = await this.findOne({ user: userId })
    .populate('items.product', 'name images price sellingPrice isAvailable stock')
    .populate('shop', 'name address');

  if (!cart) {
    cart = await this.create({ user: userId, items: [] });
  }

  return cart;
};

// Instance method to add item to cart
cartSchema.methods.addItem = async function (productId, quantity = 1) {
  const Product = mongoose.model('Product');

  // Fetch product details
  const product = await Product.findById(productId);
  if (!product) {
    throw new Error('Product not found');
  }

  if (!product.isAvailable || product.stock.quantity === 0) {
    throw new Error('Product is out of stock');
  }

  if (quantity > product.stock.quantity) {
    throw new Error(`Only ${product.stock.quantity} items available in stock`);
  }

  // Check if item already exists in cart
  const existingItemIndex = this.items.findIndex(
    item => item.product.toString() === productId
  );

  const itemPrice = product.price.sellingPrice;

  if (existingItemIndex !== -1) {
    // Update existing item quantity
    const newQuantity = this.items[existingItemIndex].quantity + quantity;

    // Check stock availability
    if (newQuantity > product.stock.quantity) {
      throw new Error(`Cannot add more than ${product.stock.quantity} items`);
    }

    this.items[existingItemIndex].quantity = newQuantity;
    this.items[existingItemIndex].price = itemPrice;
    this.items[existingItemIndex].total = newQuantity * itemPrice;
  } else {
    // Add new item
    this.items.push({
      product: productId,
      quantity,
      price: itemPrice,
      total: quantity * itemPrice
    });
  }

  await this.save();
  return this;
};

// Instance method to update item quantity
cartSchema.methods.updateItemQuantity = async function (productId, quantity) {
  if (quantity < 1) {
    return this.removeItem(productId);
  }

  const Product = mongoose.model('Product');
  const product = await Product.findById(productId);

  if (!product) {
    throw new Error('Product not found');
  }

  if (quantity > product.stock.quantity) {
    throw new Error(`Only ${product.stock.quantity} items available in stock`);
  }

  const itemIndex = this.items.findIndex(
    item => item.product.toString() === productId
  );

  if (itemIndex === -1) {
    throw new Error('Item not found in cart');
  }

  this.items[itemIndex].quantity = quantity;
  this.items[itemIndex].price = product.price.sellingPrice;
  this.items[itemIndex].total = quantity * product.price.sellingPrice;

  await this.save();
  return this;
};

// Instance method to remove item from cart
cartSchema.methods.removeItem = async function (productId) {
  const itemIndex = this.items.findIndex(
    item => item.product.toString() === productId
  );

  if (itemIndex === -1) {
    throw new Error('Item not found in cart');
  }

  this.items.splice(itemIndex, 1);
  await this.save();
  return this;
};

// Instance method to clear cart
cartSchema.methods.clearCart = async function () {
  this.items = [];
  await this.save();
  return this;
};

// Instance method to get cart summary
cartSchema.methods.getSummary = function () {
  return {
    itemCount: this.itemCount,
    subtotal: this.subtotal,
    deliveryFee: this.deliveryFee,
    total: this.total,
    items: this.items
  };
};

const Cart = mongoose.model('Cart', cartSchema);

module.exports = Cart;