// ============= models/Order.js (NEW - For Product Orders) =============
const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    unique: true,
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  shop: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    required: true
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    name: String,
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    price: {
      type: Number,
      required: true
    },
    total: Number
  }],
  deliveryAddress: {
    addressLine1: String,
    addressLine2: String,
    city: String,
    state: String,
    pincode: String,
    location: {
      type: { type: String, default: 'Point' },
      coordinates: [Number]
    }
  },
  status: {
    type: String,
    enum: ['placed', 'accepted', 'preparing', 'packed', 'searching-delivery', 'out-for-delivery', 'delivered', 'cancelled', 'rejected'],
    default: 'placed'
  },
  
  // Shop Response
  shopResponseTimeout: {
    type: Number,
    default: 60 // 60 seconds for shop to accept/reject
  },
  shopAcceptedAt: Date,
  shopRejectedAt: Date,
  rejectionReason: String,
  
  // Delivery Partner Assignment (Like Blinkit)
  deliveryPartner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceProvider'
  },
  
  notifiedDeliveryPartners: [{
    partner: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceProvider' },
    notifiedAt: { type: Date, default: Date.now },
    response: { type: String, enum: ['pending', 'accepted', 'rejected', 'timeout'], default: 'pending' },
    respondedAt: Date
  }],
  
  deliverySearchRadius: {
    type: Number,
    default: 3 // Start with 3km for delivery partners
  },
  
  deliverySearchAttempts: {
    type: Number,
    default: 0
  },
  
  // Live Tracking
  tracking: {
    deliveryPartnerLocation: {
      type: { type: String, default: 'Point' },
      coordinates: [Number],
      updatedAt: Date
    },
    estimatedDeliveryTime: Date,
    distance: Number,
    duration: Number,
    
    // Shop location for pickup
    shopLocation: {
      type: { type: String, default: 'Point' },
      coordinates: [Number]
    }
  },
  
  // Pricing
  subtotal: {
    type: Number,
    required: true
  },
  deliveryFee: {
    type: Number,
    default: 0
  },
  discount: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    required: true
  },
  
  payment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'online'],
    required: true
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  
  // Preparation time estimation
  estimatedPreparationTime: {
    type: Number, // in minutes
    default: 15
  },
  
  // Timestamps for each status
  timestamps: {
    placedAt: { type: Date, default: Date.now },
    acceptedAt: Date,
    preparingAt: Date,
    packedAt: Date,
    searchingDeliveryAt: Date,
    outForDeliveryAt: Date,
    deliveredAt: Date,
    cancelledAt: Date
  },
  
  cancelledBy: {
    type: String,
    enum: ['user', 'shop', 'system']
  },
  cancellationReason: String,
  
  notes: String,
  deliveryInstructions: String
}, {
  timestamps: true
});

orderSchema.index({ 'deliveryAddress.location': '2dsphere' });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ user: 1, status: 1 });
orderSchema.index({ shop: 1, status: 1 });
orderSchema.index({ deliveryPartner: 1, status: 1 });

module.exports = mongoose.model('Order', orderSchema);