const mongoose = require('mongoose');
const User = require("./User");
const addressSchema = User.schema.path("addresses").schema;
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

  // Items in order
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    name: {
      type: String,
      required: true
    },
    image: String,
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    price: {
      mrp: Number,
      sellingPrice: {
        type: Number,
        required: true
      },
      discount: Number
    },
    total: {
      type: Number,
      required: true
    },
    weight: Number,
    variant: String,
    addons: [{
      name: String,
      price: Number,
      quantity: Number
    }]
  }],

  // Delivery Information
  deliveryAddress: addressSchema,

  deliveryInfo: {
    type: {
      type: String,
      enum: ['standard', 'express', 'scheduled'],
      default: 'standard'
    },
    slot: {
      start: Date,
      end: Date
    },
    instructions: String,
    contactless: {
      type: Boolean,
      default: true
    },
    otp: {
      code: String,
      verified: { type: Boolean, default: false }
    }
  },

  // Delivery Boy (Shop-owned)
  deliveryBoy: {
    type: mongoose.Schema.Types.ObjectId,
  },

  // Order Status Flow
  status: {
    type: String,
    enum: [
      'pending',       // Order placed, waiting shop acceptance
      'confirmed',     // Shop accepted order
      'preparing',     // Shop preparing order
      'ready',         // Order ready for pickup
      'packed',
      'pickup',
      'out_for_delivery', // Delivery boy picked up
      'arriving',      // Delivery boy nearby
      'delivered',     // Order delivered
      'cancelled',     // Order cancelled
      'rejected'       // Shop rejected order
    ],
    default: 'pending'
  },

  statusHistory: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    updatedBy: { type: String, enum: ['user', 'shop', 'system', 'delivery_boy'] },
    note: String
  }],

  // Timestamps for each status
  timestamps: {
    placedAt: { type: Date, default: Date.now },
    confirmedAt: Date,
    preparingAt: Date,
    readyAt: Date,
    pickedUpAt: Date,
    outForDeliveryAt: Date,
    arrivingAt: Date,
    deliveredAt: Date,
    cancelledAt: Date,
    rejectedAt: Date
  },

  // Pricing Details
  pricing: {
    itemsTotal: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    packagingCharge: { type: Number, default: 0 },
    tip: { type: Number, default: 0 },
    discount: {
      couponCode: String,
      amount: { type: Number, default: 0 },
      type: { type: String, enum: ['percentage', 'fixed'] }
    },
    subtotal: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    savings: Number
  },

  // Payment Information
  payment: {
    method: {
      type: String,
      enum: ['cod', 'online', 'wallet', 'upi', 'cash', 'personal_upi'],
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'],
      default: 'pending'
    },
    transactionId: String,
    gateway: String,
    paidAt: Date,
    refundId: String,
    refundedAt: Date,

    // ✅ ADD THESE NEW FIELDS:
    receivedBy: {
      type: String,
      enum: ['company', 'provider', 'shop'],
      default: 'company'
    },
    commissionStatus: {
      type: String,
      enum: ['not_applicable', 'pending', 'paid', 'overdue'],
      default: 'not_applicable'
    },
    commissionAmount: {
      type: Number,
      default: 0
    },
    commissionPaidAt: Date,
    commissionDueDate: Date
  },

  // Cancellation/Rejection
  cancellation: {
    requestedBy: { type: String, enum: ['user', 'shop', 'delivery_boy', 'system'] },
    reason: String,
    note: String,
    refundAmount: Number,
    refundStatus: { type: String, enum: ['pending', 'processed', 'failed'] }
  },

  rejection: {
    reason: String,
    note: String
  },

  // Real-time Tracking
  tracking: {
    deliveryBoyLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number],
        default: [0, 0]   // ✅ default array
      },
      address: String,
      updatedAt: Date
    },
    shopLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: [Number]
    },
    userLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: [Number]
    },
    estimatedDeliveryTime: Date,
    distance: {
      shopToUser: Number,
      boyToShop: Number,
      boyToUser: Number
    },
    etaUpdates: [{
      eta: Date,
      timestamp: { type: Date, default: Date.now },
      distance: Number
    }]
  },

  // Ratings & Reviews
  rating: {
    shop: {
      rating: { type: Number, min: 1, max: 5 },
      review: String,
      images: [String],
      submittedAt: Date
    },
    delivery: {
      rating: { type: Number, min: 1, max: 5 },
      review: String,
      submittedAt: Date
    }
  },

  // Customer Details
  customerInfo: {
    name: String,
    phone: String,
    email: String
  },

  // Shop Details (snapshot at order time)
  shopInfo: {
    name: String,
    phone: String,
    address: String,
    location: {
      type: { type: String, default: 'Point' },
      coordinates: [Number]
    }
  },

  // Metadata
  notes: String,
  packagingType: String,
  isPriority: { type: Boolean, default: false },
  source: { type: String, enum: ['app', 'web', 'api'], default: 'app' },
  deviceInfo: {
    platform: String,
    version: String
  },

  // Analytics
  preparationTime: Number, // in minutes
  deliveryTime: Number,    // in minutes
  totalTime: Number,       // in minutes

  // Return/Refund
  returnRequest: {
    requested: { type: Boolean, default: false },
    reason: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'completed'] },
    items: [{
      product: mongoose.Schema.Types.ObjectId,
      quantity: Number,
      reason: String,
      images: [String]
    }],
    pickupAddress: {
      type: mongoose.Schema.Types.ObjectId,
    },
    refundAmount: Number,
    createdAt: Date,
    resolvedAt: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
orderSchema.index({ orderId: 1 });
orderSchema.index({ user: 1, status: 1 });
orderSchema.index({ shop: 1, status: 1 });
orderSchema.index({ deliveryBoy: 1, status: 1 });
orderSchema.index({ 'tracking.deliveryBoyLocation': '2dsphere' });
orderSchema.index({ 'timestamps.placedAt': -1 });
orderSchema.index({ status: 1, 'timestamps.placedAt': -1 });
orderSchema.index({ 'pricing.totalAmount': 1 });
orderSchema.index({ 'payment.status': 1 });

// Virtuals
orderSchema.virtual('isActive').get(function () {
  return ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'arriving'].includes(this.status);
});

orderSchema.virtual('isComplete').get(function () {
  return ['delivered', 'cancelled', 'rejected'].includes(this.status);
});

orderSchema.virtual('timeSincePlaced').get(function () {
  return Math.floor((Date.now() - new Date(this.timestamps.placedAt)) / 60000);
});

// Pre-save middleware
orderSchema.pre('save', function (next) {
  // Update status history
  if (this.isModified('status')) {
    this.statusHistory.push({
      status: this.status,
      timestamp: new Date(),
      updatedBy: this._updatedBy || 'system'
    });
  }

  // Calculate times
  if (this.status === 'delivered' && this.timestamps.deliveredAt) {
    if (this.timestamps.preparingAt) {
      this.preparationTime = Math.floor(
        (new Date(this.timestamps.readyAt || this.timestamps.deliveredAt) -
          new Date(this.timestamps.preparingAt)) / 60000
      );
    }

    if (this.timestamps.outForDeliveryAt) {
      this.deliveryTime = Math.floor(
        (new Date(this.timestamps.deliveredAt) -
          new Date(this.timestamps.outForDeliveryAt)) / 60000
      );
    }

    this.totalTime = Math.floor(
      (new Date(this.timestamps.deliveredAt) -
        new Date(this.timestamps.placedAt)) / 60000
    );
  }

  next();
});

// Method to update delivery boy location
orderSchema.methods.updateDeliveryBoyLocation = async function (lat, lng, address) {
  this.tracking.deliveryBoyLocation = {
    type: 'Point',
    coordinates: [lng, lat],
    address: address,
    updatedAt: new Date()
  };

  // Calculate distances
  if (this.tracking.shopLocation && this.tracking.userLocation) {
    const calculateDistance = (coord1, coord2) => {
      const [lng1, lat1] = coord1;
      const [lng2, lat2] = coord2;
      const R = 6371; // Earth's radius in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lng2 - lng1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    this.tracking.distance.boyToShop = calculateDistance(
      [lng, lat],
      this.tracking.shopLocation.coordinates
    );

    this.tracking.distance.boyToUser = calculateDistance(
      [lng, lat],
      this.tracking.userLocation.coordinates
    );

    // Update ETA (assuming 20 km/h average speed)
    const remainingDistance = this.tracking.distance.boyToUser;
    const etaMinutes = Math.ceil((remainingDistance / 20) * 60);
    this.tracking.estimatedDeliveryTime = new Date(Date.now() + etaMinutes * 60000);

    this.tracking.etaUpdates.push({
      eta: this.tracking.estimatedDeliveryTime,
      timestamp: new Date(),
      distance: remainingDistance
    });
  }

  await this.save();
  return this;
};

module.exports = mongoose.model('Order', orderSchema);