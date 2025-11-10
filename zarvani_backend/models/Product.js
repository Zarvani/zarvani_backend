// ============= models/Product.js =============
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
    unit: { type: String, default: 'piece' }
  },
  sku: String,
  brand: String,
  specifications: [{
    key: String,
    value: String
  }],
  ratings: {
    average: { type: Number, default: 0 },
    count: { type: Number, default: 0 }
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  tags: [String]
}, { timestamps: true });

module.exports = {Product: mongoose.model('Product', productSchema)};