const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const deliveryBoySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    unique: true,
    sparse: true
  },
  password: {
    type: String,
    required: true,
    select: false
  },
  profilePicture: {
    url: String,
    publicId: String
  },
  vehicle: {
    type: {
      type: String,
      enum: ['bike', 'scooter', 'cycle', 'car', 'walking'],
      default: 'bike'
    },
    number: String,
    color: String,
    model: String
  },
  documents: {
    drivingLicense: {
      url: String,
      publicId: String,
      verified: { type: Boolean, default: false }
    },
    aadharCard: {
      url: String,
      publicId: String,
      verified: { type: Boolean, default: false }
    }
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'on-delivery', 'offline'],
    default: 'offline'
  },
  currentLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      default: [0, 0]
    },
    address: String,
    updatedAt: Date
  },
  assignedOrders: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  }],
  totalDeliveries: {
    type: Number,
    default: 0
  },
  ratings: {
    average: { type: Number, default: 0 },
    count: { type: Number, default: 0 }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: Date,
  otp: {
    code: String,
    expiresAt: Date,
    attempts: { type: Number, default: 0 }
  },
  earnings: {
    total: { type: Number, default: 0 },          // Total earnings from all orders
    lastUpdated: { type: Date, default: Date.now }
  },

  // ✅ ADD: Commission tracking separately
  commission: {
    due: { type: Number, default: 0 },            // Total commission due to company
    paid: { type: Number, default: 0 },           // Total commission paid to company
    lastPaymentDate: Date
  },

  // ✅ ADD: Bank/UPI details for auto-payout
  bankDetails: {
    upiId: String,
    accountHolderName: String,
    accountNumber: String,
    ifscCode: String,
    bankName: String,
    branch: String
  },
}, { timestamps: true });

deliveryBoySchema.index({ 'currentLocation': '2dsphere' });

deliveryBoySchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

deliveryBoySchema.methods.comparePassword = async function (pwd) {
  return await bcrypt.compare(pwd, this.password);
};

const shopSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Shop name is required'],
    trim: true
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true
  },
  phone: {
    type: String,
    required: true,
    match: [/^\+\d{7,15}$/, "Invalid phone number format"],
    unique: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
    select: false
  },
  logo: {
    url: String,
    publicId: String
  },
  coverImage: {
    url: String,
    publicId: String
  },
  role: {
    type: String,
    enum: ['shop'],
    default: 'shop'
  },
  address: {
    addressLine1: String,
    addressLine2: String,
    landmark: String,
    city: String,
    state: String,
    country: { type: String, default: 'India' },
    pincode: String,
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number],
        default: [0, 0]
      }
    },
    formattedAddress: String
  },
  ownerName: {
    type: String,
    required: true
  },
  ownerPhone: String,
  gstNumber: String,
  fssaiLicense: String,

  // Delivery Settings
  deliverySettings: {
    enabled: { type: Boolean, default: true },
    radius: { type: Number, default: 5 }, // in km
    minOrderAmount: { type: Number, default: 0 },
    deliveryFee: {
      baseFee: { type: Number, default: 20 },
      perKm: { type: Number, default: 5 },
      freeDeliveryAbove: { type: Number, default: 299 }
    },
    estimatedDeliveryTime: {
      min: { type: Number, default: 10 }, // minutes
      max: { type: Number, default: 45 }
    },
    packagingCharge: { type: Number, default: 5 },
    slotBasedDelivery: { type: Boolean, default: false },
    deliverySlots: [{
      startTime: String,
      endTime: String,
      maxOrders: Number,
      currentOrders: { type: Number, default: 0 }
    }]
  },

  // Shop-owned delivery boys
  deliveryBoys: [deliveryBoySchema],

  documents: {
    businessLicense: {
      url: String,
      publicId: String,
      verified: { type: Boolean, default: false }
    },
    gstCertificate: {
      url: String,
      publicId: String,
      verified: { type: Boolean, default: false }
    },
    fssaiCertificate: {
      url: String,
      publicId: String,
      verified: { type: Boolean, default: false }
    }
  },

  categories: [{
    type: String,
    required: true
  }],

  workingHours: {
    monday: {
      start: { type: String, default: "00:00" },
      end: { type: String, default: "23:59" },
      isOpen: { type: Boolean, default: true }
    },
    tuesday: {
      start: { type: String, default: "00:00" },
      end: { type: String, default: "23:59" },
      isOpen: { type: Boolean, default: true }
    },
    wednesday: {
      start: { type: String, default: "00:00" },
      end: { type: String, default: "23:59" },
      isOpen: { type: Boolean, default: true }
    },
    thursday: {
      start: { type: String, default: "00:00" },
      end: { type: String, default: "23:59" },
      isOpen: { type: Boolean, default: true }
    },
    friday: {
      start: { type: String, default: "00:00" },
      end: { type: String, default: "23:59" },
      isOpen: { type: Boolean, default: true }
    },
    saturday: {
      start: { type: String, default: "00:00" },
      end: { type: String, default: "23:59" },
      isOpen: { type: Boolean, default: true }
    },
    sunday: {
      start: { type: String, default: "00:00" },
      end: { type: String, default: "23:59" },
      isOpen: { type: Boolean, default: true }
    }
  },


  ratings: {
    average: { type: Number, default: 0, min: 0, max: 5 },
    count: { type: Number, default: 0 },
    reviews: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      rating: Number,
      comment: String,
      order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
      createdAt: { type: Date, default: Date.now }
    }]
  },

  orderStats: {
    total: { type: Number, default: 0 },
    today: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    preparing: { type: Number, default: 0 },
    outForDelivery: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    cancelled: { type: Number, default: 0 }
  },

  earnings: {
    today: { type: Number, default: 0 },
    weekly: { type: Number, default: 0 },
    monthly: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    withdrawn: { type: Number, default: 0 }
  },

  bankDetails: {
    accountHolderName: String,
    accountNumber: String,
    ifscCode: String,
    bankName: String,
    branch: String
  },

  verificationStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'suspended'],
    default: 'pending'
  },
  rejectionReason: String,

  isActive: {
    type: Boolean,
    default: false
  },

  isOpen: {
    type: Boolean,
    default: true
  },

  lastLogin: Date,

  otp: {
    code: String,
    expiresAt: Date,
    attempts: { type: Number, default: 0 }
  },

  // Quick Commerce Features
  sla: {
    acceptTime: { type: Number, default: 60 }, // seconds to accept order
    preparationTime: { type: Number, default: 15 }, // minutes
    deliveryTime: { type: Number, default: 30 } // minutes
  },

  features: {
    expressDelivery: { type: Boolean, default: false },
    midnightDelivery: { type: Boolean, default: false },
    cashOnDelivery: { type: Boolean, default: true },
    contactlessDelivery: { type: Boolean, default: true },
    returnPolicy: { type: Boolean, default: true }
  },

  tags: [String],

  inventoryManagement: {
    lowStockAlert: { type: Boolean, default: true },
    autoReorder: { type: Boolean, default: false },
    reorderLevel: { type: Number, default: 10 }
  },

  notificationSettings: {
    newOrder: { type: Boolean, default: true },
    lowStock: { type: Boolean, default: true },
    orderUpdate: { type: Boolean, default: true },
    marketing: { type: Boolean, default: true }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

shopSchema.index({ 'address.location': '2dsphere' });
shopSchema.index({ name: 'text', categories: 'text' });
shopSchema.index({ isActive: 1, isOpen: 1, verificationStatus: 1 });

shopSchema.virtual('deliveryTime').get(function () {
  return `${this.deliverySettings.estimatedDeliveryTime.min}-${this.deliverySettings.estimatedDeliveryTime.max} min`;
});

shopSchema.virtual('deliveryFeeRange').get(function () {
  return {
    min: this.deliverySettings.deliveryFee.baseFee,
    max: this.deliverySettings.deliveryFee.baseFee +
      (this.deliverySettings.radius * this.deliverySettings.deliveryFee.perKm)
  };
});

shopSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

shopSchema.methods.comparePassword = async function (pwd) {
  return await bcrypt.compare(pwd, this.password);
};

shopSchema.methods.generateOTP = function () {
  const crypto = require('crypto');
  const otp = crypto.randomInt(100000, 999999).toString();
  this.otp = {
    code: otp,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    attempts: 0
  };
  return otp;
};

shopSchema.methods.verifyOTP = function (enteredOTP) {
  if (!this.otp || !this.otp.code) return false;
  if (this.otp.expiresAt < new Date()) return false;
  if (this.otp.attempts >= 5) return false;
  return this.otp.code === enteredOTP;
};

// Helper method to check if shop is open now
shopSchema.methods.isShopOpenNow = function () {
  const now = new Date();
  const day = now.toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
  const daySchedule = this.workingHours?.[day];

  // If schedule missing → treat as closed
  if (!daySchedule || !daySchedule.isOpen) return false;

  const start = daySchedule.start;
  const end = daySchedule.end;

  // If start or end missing → treat as closed & avoid split crash
  if (!start || !end) return false;

  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
};

// Method to assign delivery boy (Hardened to prevent race conditions)
shopSchema.methods.assignDeliveryBoy = async function (orderId, session = null) {
  // 1. Find available boys in memory first to pick one
  const availableBoys = this.deliveryBoys.filter(boy =>
    boy.status === 'active' && boy.isActive
  );

  if (availableBoys.length === 0) return null;

  // Sort by number of assigned orders to balance load
  availableBoys.sort((a, b) => a.assignedOrders.length - b.assignedOrders.length);
  const pickedBoy = availableBoys[0];

  // 2. Perform ATOMIC update on the database to verify he's still available
  // This prevents two simultaneous orders from being assigned to the same "free" slot
  const updateOptions = {
    _id: this._id,
    'deliveryBoys._id': pickedBoy._id,
    'deliveryBoys.status': 'active' // Ensure he hasn't been picked by another process
  };
  
  const updatedShop = await this.constructor.findOneAndUpdate(
    updateOptions,
    {
      $push: { 'deliveryBoys.$.assignedOrders': orderId },
      $set: {
        'deliveryBoys.$.status': 'on-delivery',
        'deliveryBoys.$.lastAssignedAt': new Date()
      }
    },
    { new: true, session }
  );

  if (!updatedShop) {
    logger.warn(`Race condition in delivery boy assignment for shop ${this._id}. Retrying...`);
    // OPTIONAL: Implementation of a recursive retry or just returning null for the caller to handle
    return null;
  }

  return updatedShop.deliveryBoys.id(pickedBoy._id);
};

module.exports = mongoose.model('Shop', shopSchema);