// ============= models/Shop.js =============
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
  role: {
    type: String,
    enum: ['shop'],
    default: 'shop'
  },
  address: {
    addressLine1: { type: String, required: true },
    addressLine2: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
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
    }
  },
  ownerName: {
    type: String,
    required: true
  },
  gstNumber: String,
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
    }
  },
  categories: [{
    type: String
  }],
  workingHours: {
    monday: { start: String, end: String, isOpen: Boolean },
    tuesday: { start: String, end: String, isOpen: Boolean },
    wednesday: { start: String, end: String, isOpen: Boolean },
    thursday: { start: String, end: String, isOpen: Boolean },
    friday: { start: String, end: String, isOpen: Boolean },
    saturday: { start: String, end: String, isOpen: Boolean },
    sunday: { start: String, end: String, isOpen: Boolean }
  },
  ratings: {
    average: { type: Number, default: 0, min: 0, max: 5 },
    count: { type: Number, default: 0 }
  },
  totalOrders: {
    type: Number,
    default: 0
  },
  earnings: {
    total: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    withdrawn: { type: Number, default: 0 }
  },
  bankDetails: {
    accountHolderName: String,
    accountNumber: String,
    ifscCode: String,
    bankName: String
  },
  verificationStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  rejectionReason: String,
  isActive: {
    type: Boolean,
    default: false
  },
  lastLogin: Date,
  otp: {
    code: String,
    expiresAt: Date,
    attempts: { type: Number, default: 0 }
  }
}, { timestamps: true });

shopSchema.index({ 'address.location': '2dsphere' });

shopSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

shopSchema.methods.comparePassword = async function(pwd) {
  return await bcrypt.compare(pwd, this.password);
};

shopSchema.methods.generateOTP = function() {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.otp = {
    code: otp,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    attempts: 0
  };
  return otp;
};

module.exports = {Shop: mongoose.model('Shop', shopSchema)};