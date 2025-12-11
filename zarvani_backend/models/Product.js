const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  shop: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  category: {
    type: String,
    required: true
  },
  subcategory: String,
  images: [{
    url: String,
    publicId: String
  }],
  price: {
    mrp: { type: Number, required: true },
    sellingPrice: { type: Number, required: true },
    discount: Number
  },
  stock: {
    quantity: { type: Number, default: 0 },
    unit: { type: String, default: 'piece' },
    lowStockThreshold: { type: Number, default: 5 }
  },
  sku: {
    type: String,
    unique: true,
    sparse: true
  },
  brand: String,
  specifications: [{
    key: String,
    value: String
  }],
  ratings: {
    average: { type: Number, default: 0, min: 0, max: 5 },
    count: { type: Number, default: 0 },
    reviews: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      rating: { type: Number, min: 1, max: 5 },
      comment: String,
      images: [String],
      createdAt: { type: Date, default: Date.now }
    }]
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  tags: [String],
  weight: Number,
  dimensions: {
    length: Number,
    width: Number,
    height: Number
  },
  expiryDate: Date,
  batchNumber: String,
  barcode: String,
  returnPolicy: {
    allowed: { type: Boolean, default: false },
    days: { type: Number, default: 0 },
    conditions: String
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
productSchema.index({ shop: 1, category: 1 });
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ 'price.sellingPrice': 1 });
productSchema.index({ ratings: -1 });
productSchema.index({ isAvailable: 1, isFeatured: 1 });

// Virtual for inStock
productSchema.virtual('inStock').get(function() {
  return this.stock.quantity > 0;
});

// Virtual for lowStock
productSchema.virtual('lowStock').get(function() {
  return this.stock.quantity <= this.stock.lowStockThreshold;
});

module.exports = mongoose.model('Product', productSchema);