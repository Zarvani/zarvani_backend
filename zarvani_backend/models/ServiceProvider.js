const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const serviceProviderSchema = new mongoose.Schema({
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
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    match: [/^\+\d{7,15}$/, "Invalid phone number format"],
    unique: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6,
    select: false
  },
  profilePicture: {
    url: String,
    publicId: String
  },
  role: {
    type: String,
    enum: ['provider'],
    default: 'provider'
  },
  address: {
    addressLine1: String,
    addressLine2: String,
    city: String,
    state: String,
    country:String,
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
    }
  },
  experience: {
    years: { type: Number, default: 0 },
    description: String
  },
  certifications: [{
    name: String,
    issuedBy: String,
    issuedDate: Date,
    document: {
      url: String,
      publicId: String
    }
  }],
  documents: {
    idProof: {
      type: { type: String },
      number: String,
      document: {
        url: String,
        publicId: String
      },
      verified: { type: Boolean, default: false }
    },
    addressProof: {
      document: {
        url: String,
        publicId: String
      },
      verified: { type: Boolean, default: false }
    },
    policeClearance: {
      document: {
        url: String,
        publicId: String
      },
      verified: { type: Boolean, default: false }
    }
  },
  serviceCategories: {
    type: [String],
    enum: [
      "plumbing",
      "electrical",
      "carpentry",
      "painting",
      "cleaning",
      "gardening",
      "home-appliance-repair",
      "computer-repair",
      "home-renovation",
      "interior-design",
      "pest-control",
      "hvac-repair",
      "salon-services",
      "beauty-services",
      "tutoring",
      "legal-services",
      "catering",
      "photography",
      "event-planning",
      "flooring-and-tile",
      "wall-panels-and-panelling",
      "water-purifier-installation",
      "ac-service",
      "sofa-and-carpet-cleaning",
      "maid-service",
      "home-moving-and-packers",
      "fitness-and-yoga-trainer",
      "home-health-care",
      "driver-and-chauffeur",
      "native-product-installation",
      "furniture-assembly",
      "shifting-and-relocation",
      "bike-or-vehicle-repair",
      "accounting-and-tax-services",
      "dry-cleaning-and-laundry",
      "baby-or-child-care",
      "elder-care",
      "pet-grooming",
      "other"
    ]
},
  specializations: [String],
  portfolio: [{
    title: String,
    description: String,
    image: {
      url: String,
      publicId: String
    },
    date: { type: Date, default: Date.now }
  }],
  workingHours: {
    monday: { start: String, end: String, isAvailable: Boolean },
    tuesday: { start: String, end: String, isAvailable: Boolean },
    wednesday: { start: String, end: String, isAvailable: Boolean },
    thursday: { start: String, end: String, isAvailable: Boolean },
    friday: { start: String, end: String, isAvailable: Boolean },
    saturday: { start: String, end: String, isAvailable: Boolean },
    sunday: { start: String, end: String, isAvailable: Boolean }
  },
  availability: {
    isAvailable: { type: Boolean, default: true },
    unavailableDates: [Date]
  },
  ratings: {
    average: { type: Number, default: 0, min: 0, max: 5 },
    count: { type: Number, default: 0 }
  },
  completedServices: {
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
    bankName: String,
    branch: String
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
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  lastLogin: Date,
  otp: {
    code: String,
    expiresAt: Date,
    attempts: { type: Number, default: 0 }
  },
  resetPasswordToken: String,
  resetPasswordExpire: Date
}, {
  timestamps: true
});

// Index for geospatial queries
serviceProviderSchema.index({ 'address.location': '2dsphere' });

// Hash password
serviceProviderSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password
serviceProviderSchema.methods.comparePassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate OTP
serviceProviderSchema.methods.generateOTP = function() {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.otp = {
    code: otp,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    attempts: 0
  };
  return otp;
};

// Verify OTP
serviceProviderSchema.methods.verifyOTP = function(enteredOTP) {
  if (!this.otp || !this.otp.code || this.otp.expiresAt < new Date() || this.otp.attempts >= 5) {
    return false;
  }
  return this.otp.code === enteredOTP;
};

module.exports = mongoose.model('ServiceProvider', serviceProviderSchema);