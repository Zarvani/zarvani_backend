const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const addressSchema = new mongoose.Schema({
  label: {
    type: String,
    enum: ['Home', 'Work', 'Other'],
    default: 'Home'
  },
  addressLine1: { type: String, required: true },
  addressLine2: String,
  city: { type: String, required: true },
  state: { type: String, required: true },
  pincode: { type: String, required: true },
  landmark: String,
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
  isDefault: { type: Boolean, default: false }
});

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    match: [/^\+\d{7,15}$/, "Invalid phone number format"],

  },
  password: {
    type: String,
    minlength: 6,
    select: false
  },
  profilePicture: {
    url: String,
    publicId: String
  },
  role: {
    type: String,
    enum: ['user'],
    default: 'user'
  },
  addresses: [addressSchema],
  preferences: {
    language: { type: String, default: 'en' },
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true }
    }
  },
  loyaltyPoints: {
    type: Number,
    default: 0
  },
  subscription: {
    isActive: { type: Boolean, default: false },
    plan: String,
    startDate: Date,
    endDate: Date
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: Date,
  loginAttempts: { type: Number, default: 0 },
  lockUntil: Date,
  sessions: [{
    refreshToken: String,
    device: String,
    ip: String,
    createdAt: { type: Date, default: Date.now }
  }],
  otp: {
    code: String, // Store SHA-256 hash here
    expiresAt: Date,
    attempts: { type: Number, default: 0 }
  },
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  googleId: String,
  facebookId: String
}, {
  timestamps: true
});

// Index for geospatial queries
addressSchema.index({ location: '2dsphere' });

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }

  if (this.password) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Check if locked
userSchema.methods.isLocked = function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// Generate OTP
userSchema.methods.generateOTP = function () {
  const crypto = require('crypto');
  const otp = crypto.randomInt(100000, 999999).toString();
  
  // Hash OTP securely
  const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

  this.otp = {
    code: hashedOtp,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    attempts: 0
  };
  return otp; // Return plaintext to send via SMS/Email
};

// Verify OTP
userSchema.methods.verifyOTP = function (enteredOTP) {
  if (!this.otp || !this.otp.code) {
    return false;
  }

  if (this.otp.expiresAt < new Date()) {
    return false;
  }

  if (this.otp.attempts >= 5) {
    return false;
  }

  const crypto = require('crypto');
  const hashedEnteredOTP = crypto.createHash('sha256').update(enteredOTP).digest('hex');

  return this.otp.code === hashedEnteredOTP;
};

module.exports = mongoose.model('User', userSchema);