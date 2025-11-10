// ============= models/Booking.js (UPDATED) =============
const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  bookingId: {
    type: String,
    unique: true,
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  service: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    required: true
  },
  provider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceProvider',
    default: null // Will be assigned when provider accepts
  },
  serviceDetails: {
    title: String,
    price: Number,
    duration: Number,
    category: String
  },
  scheduledDate: {
    type: Date,
    required: true
  },
  scheduledTime: {
    type: String,
    required: true
  },
  isImmediate: {
    type: Boolean,
    default: false // true for instant booking (like Uber)
  },
  address: {
    addressLine1: String,
    addressLine2: String,
    city: String,
    state: String,
    pincode: String,
    location: {
      type: { type: String, default: 'Point' },
      coordinates: [Number] // [longitude, latitude]
    }
  },
  status: {
    type: String,
    enum: ['searching', 'pending', 'confirmed', 'provider-assigned', 'on-the-way', 'reached', 'in-progress', 'completed', 'cancelled', 'rejected', 'no-provider-found'],
    default: 'searching' // Start with searching for providers
  },
  
  // Provider Assignment Tracking
  notifiedProviders: [{
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceProvider' },
    notifiedAt: { type: Date, default: Date.now },
    response: { type: String, enum: ['pending', 'accepted', 'rejected', 'timeout'], default: 'pending' },
    respondedAt: Date
  }],
  
  providerSearchRadius: {
    type: Number,
    default: 5 // Start with 5km radius
  },
  
  maxSearchRadius: {
    type: Number,
    default: 20 // Maximum 20km
  },
  
  searchAttempts: {
    type: Number,
    default: 0
  },
  
  providerResponseTimeout: {
    type: Number,
    default: 30 // 30 seconds for provider to respond
  },
  
  // Live Tracking
  tracking: {
    providerLocation: {
      type: { type: String, default: 'Point' },
      coordinates: [Number],
      updatedAt: Date
    },
    estimatedArrival: Date,
    distance: Number, // Distance in km
    duration: Number // Duration in minutes
  },
  
  // Product Orders (Blinkit/Zepto style)
  products: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop' },
    quantity: Number,
    price: Number,
    status: { 
      type: String, 
      enum: ['pending', 'accepted', 'preparing', 'packed', 'out-for-delivery', 'delivered', 'cancelled'],
      default: 'pending'
    }
  }],
  
  shopOrderTracking: {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop' },
    acceptedAt: Date,
    preparingAt: Date,
    packedAt: Date,
    dispatchedAt: Date,
    deliveryPartner: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceProvider' },
    estimatedDeliveryTime: Date,
    deliveryLocation: {
      type: { type: String, default: 'Point' },
      coordinates: [Number],
      updatedAt: Date
    }
  },
  
  cancellationReason: String,
  cancelledBy: {
    type: String,
    enum: ['user', 'provider', 'shop', 'admin', 'system']
  },
  payment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  totalAmount: {
    type: Number,
    required: true
  },
  appliedCoupon: {
    code: String,
    discount: Number
  },
  loyaltyPointsUsed: {
    type: Number,
    default: 0
  },
  notes: String,
  completionNotes: String,
  completedAt: Date,
  
  // Timestamps for each status
  timestamps: {
    searchingAt: Date,
    providerAssignedAt: Date,
    onTheWayAt: Date,
    reachedAt: Date,
    inProgressAt: Date,
    completedAt: Date,
    cancelledAt: Date
  }
}, {
  timestamps: true
});

bookingSchema.index({ 'address.location': '2dsphere' });
bookingSchema.index({ status: 1, createdAt: -1 });
bookingSchema.index({ user: 1, status: 1 });
bookingSchema.index({ provider: 1, status: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
