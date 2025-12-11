const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  
  // References
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking'
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  provider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceProvider'
  },
  shop: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop'
  },
  
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  
  // ✅ UPDATED Commission Structure
  commission: {
    companyCommission: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    providerEarning: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    shopEarning: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    // Commission rates based on payment destination
    commissionRate: { 
      type: Number, 
      default: 15,
      min: 0,
      max: 100 
    },
    pendingCommission: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    pendingCommissionRate: { 
      type: Number, 
      default: 20, // Default for provider personal payments
      min: 0,
      max: 100 
    },
    // Shop commission rates
    shopCommissionRate: { 
      type: Number, 
      default: 8,
      min: 0,
      max: 100 
    },
    shopPendingCommissionRate: { 
      type: Number, 
      default: 12,
      min: 0,
      max: 100 
    },
    calculatedAt: {
      type: Date,
      default: Date.now
    }
  },
  
  // ✅ UPDATED Payment Destination with commission tracking
  paymentDestination: {
    type: String,
    enum: ['company_account', 'personal_account'],
    required: true
  },
  
  // ✅ ADDED: Payment type - service or product
  paymentType: {
    type: String,
    enum: ['service', 'product'],
    required: true
  },
  
  // ✅ UPDATED QR Payment Details with UPI info
  qrPayment: {
    qrCode: String,
    qrImageUrl: String,
    upiId: String,
    upiName: String,
    amount: Number,
    expiresAt: Date,
    status: {
      type: String,
      enum: ['generated', 'scanned', 'paid', 'expired'],
      default: 'generated'
    },
    // UPI Deep Link for manual payment
    upiDeepLink: String,
    // For company QR generation
    isCompanyQR: {
      type: Boolean,
      default: false
    }
  },
  
  // ✅ ADDED: UPI Payment Gateway Details
  upiPayment: {
    upiId: String,
    upiApp: String,
    transactionId: String,
    referenceId: String,
    status: String,
    verifiedAt: Date,
    verificationMethod: {
      type: String,
      enum: ['webhook', 'manual', 'api'],
      default: 'webhook'
    }
  },
  
  // Bank Transfer Details for Personal Account
  bankTransfer: {
    bankName: String,
    accountNumber: String,
    ifscCode: String,
    accountHolderName: String,
    referenceNumber: String,
    transferDate: Date,
    verified: {
      type: Boolean,
      default: false
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    verifiedAt: Date
  },
  
  // ✅ UPDATED Payment verification for personal account
  paymentVerification: {
    status: {
      type: String,
      enum: ['pending', 'verified', 'rejected', 'overdue'],
      default: 'pending'
    },
    dueDate: Date,
    remindersSent: [{
      sentAt: Date,
      type: {
        type: String,
        enum: ['email', 'sms', 'push', 'whatsapp']
      },
      method: String,
      message: String
    }],
    verifiedAt: Date,
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    notes: String
  },
  
  // For personal account payments - commission tracking
  pendingCommission: {
    amount: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'overdue', 'waived', 'disputed'],
      default: 'pending'
    },
    dueDate: {
      type: Date,
      required: function() {
        return this.paymentDestination === 'personal_account';
      }
    },
    paidDate: Date,
    paymentMethod: String,
    transactionId: String,
    reminderSent: {
      type: Boolean,
      default: false
    },
    remindersSent: [{
      sentAt: Date,
      type: {
        type: String,
        enum: ['email', 'sms', 'push', 'whatsapp']
      },
      content: String
    }]
  },
  
  // Payout tracking for company account payments
  payout: {
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
      default: 'pending'
    },
    payoutId: String,
    payoutDate: Date,
    payoutMethod: {
      type: String,
      enum: ['upi', 'bank_transfer', 'wallet']
    },
    payoutTo: String, // UPI ID or Account Number
    failureReason: String,
    retryCount: {
      type: Number,
      default: 0
    },
    lastRetryAt: Date,
    transactionId: String
  },
  
  // Payment details
  paymentMethod: {
    type: String,
    enum: ['cash', 'upi', 'card', 'netbanking', 'wallet', 'qr'],
    required: true
  },
  
  // ✅ ADDED: Payment Gateway Details
  paymentGateway: {
    type: String,
    enum: ['razorpay', 'paytm', 'phonepe', 'google_pay', 'manual'],
    default: 'razorpay'
  },
  
  gatewayTransactionId: String,
  gatewayResponse: mongoose.Schema.Types.Mixed,
  
  status: {
    type: String,
    enum: ['pending', 'success', 'failed', 'refunded', 'cancelled', 'expired'],
    default: 'pending'
  },
  
  paymentDate: Date,
  
  // Refund details
  refund: {
    amount: { type: Number, min: 0 },
    date: Date,
    reason: String,
    gatewayRefundId: String,
    status: {
      type: String,
      enum: ['pending', 'processed', 'failed'],
      default: 'pending'
    }
  },
  
  // Security and verification
  ipAddress: String,
  userAgent: String,
  verified: {
    type: Boolean,
    default: false
  },
  
  // Metadata
  metadata: mongoose.Schema.Types.Mixed,
  
  // Audit trail
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
paymentSchema.index({ user: 1, createdAt: -1 });
paymentSchema.index({ provider: 1, status: 1 });
paymentSchema.index({ shop: 1, status: 1 });
paymentSchema.index({ 'pendingCommission.status': 1, 'pendingCommission.dueDate': 1 });
paymentSchema.index({ 'payout.status': 1 });
paymentSchema.index({ transactionId: 1 });
paymentSchema.index({ 'qrPayment.status': 1 });
paymentSchema.index({ 'paymentVerification.status': 1 });
paymentSchema.index({ paymentDestination: 1, status: 1 });
paymentSchema.index({ 'paymentType': 1 });
paymentSchema.index({ 'commission.pendingCommission': 1 });

// Virtuals
paymentSchema.virtual('isOverdue').get(function() {
  if (this.paymentDestination === 'personal_account' && 
      this.pendingCommission.status === 'pending' &&
      this.pendingCommission.dueDate) {
    return new Date() > this.pendingCommission.dueDate;
  }
  return false;
});

paymentSchema.virtual('daysOverdue').get(function() {
  if (this.isOverdue && this.pendingCommission.dueDate) {
    const today = new Date();
    const dueDate = this.pendingCommission.dueDate;
    const diffTime = Math.abs(today - dueDate);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
  return 0;
});

paymentSchema.virtual('totalCommission').get(function() {
  if (this.paymentDestination === 'company_account') {
    return this.commission.companyCommission;
  } else {
    return this.commission.pendingCommission;
  }
});

paymentSchema.virtual('netEarning').get(function() {
  if (this.paymentDestination === 'company_account') {
    return this.commission.providerEarning || this.commission.shopEarning;
  } else {
    return this.amount - this.commission.pendingCommission;
  }
});

// Pre-save middleware
paymentSchema.pre('save', async function(next) {
  // Auto-generate transactionId if not provided
  if (!this.transactionId) {
    this.transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Set payment type based on provider/shop
  if (this.provider && !this.paymentType) {
    this.paymentType = 'service';
  } else if (this.shop && !this.paymentType) {
    this.paymentType = 'product';
  }
  
  // Set commission rates based on payment type and destination
  if (this.isModified('paymentDestination') || this.isModified('paymentType')) {
    await this.calculateCommission();
  }
  
  // Update pending commission status
  if (this.isModified('pendingCommission.status') && 
      this.pendingCommission.status === 'paid' && 
      !this.pendingCommission.paidDate) {
    this.pendingCommission.paidDate = new Date();
    this.paymentVerification.status = 'verified';
    this.paymentVerification.verifiedAt = new Date();
  }
  
  // Mark as overdue if due date passed
  if (this.paymentDestination === 'personal_account' &&
      this.pendingCommission.status === 'pending' &&
      this.pendingCommission.dueDate &&
      new Date() > this.pendingCommission.dueDate) {
    this.pendingCommission.status = 'overdue';
  }
  
  next();
});

// ✅ NEW: Calculate commission based on payment destination and type
paymentSchema.methods.calculateCommission = async function() {
  if (this.paymentDestination === 'company_account') {
    // Company account - auto split
    if (this.paymentType === 'service') {
      // Provider service: 15% company, 85% provider
      this.commission.commissionRate = 15;
      this.commission.companyCommission = this.amount * 0.15;
      this.commission.providerEarning = this.amount * 0.85;
    } else {
      // Shop product: 8% company, 92% shop
      this.commission.commissionRate = 8;
      this.commission.companyCommission = this.amount * 0.08;
      this.commission.shopEarning = this.amount * 0.92;
    }
  } else {
    // Personal account - track pending commission
    if (this.paymentType === 'service') {
      // Provider service: 20% pending commission
      this.commission.pendingCommissionRate = 20;
      this.commission.pendingCommission = this.amount * 0.20;
      this.commission.providerEarning = this.amount; // Full amount to provider
    } else {
      // Shop product: 12% pending commission
      this.commission.pendingCommissionRate = 12;
      this.commission.pendingCommission = this.amount * 0.12;
      this.commission.shopEarning = this.amount; // Full amount to shop
    }
    
    // Set commission due date (7 days from payment)
    if (!this.pendingCommission.dueDate) {
      this.pendingCommission.dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
  }
  
  this.commission.calculatedAt = new Date();
};

// ✅ NEW: Generate QR Code with proper UPI data
paymentSchema.methods.generateQRCode = async function() {
  const QRCode = require('qrcode');
  
  let upiId, upiName;
  
  if (this.paymentDestination === 'company_account') {
    // Company QR - using company UPI
    upiId = process.env.COMPANY_UPI_ID || 'company@razorpay';
    upiName = process.env.COMPANY_NAME || 'Service Company';
    this.qrPayment.isCompanyQR = true;
  } else {
    // Personal QR - get provider's/shop's UPI
    const owner = await this.getPaymentOwner();
    if (!owner) {
      throw new Error('Payment owner not found');
    }
    
    upiId = owner.upiId || owner.bankDetails?.upiId;
    if (!upiId) {
      throw new Error('Owner UPI ID not configured');
    }
    
    upiName = owner.name || owner.businessName;
    this.qrPayment.isCompanyQR = false;
  }
  
  // Store UPI details
  this.qrPayment.upiId = upiId;
  this.qrPayment.upiName = upiName;
  this.qrPayment.amount = this.amount;
  this.qrPayment.expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  
  // Generate UPI deep link
  const upiDeepLink = this.generateUPIDeepLink(upiId, upiName, this.amount);
  this.qrPayment.upiDeepLink = upiDeepLink;
  
  // Generate QR code
  try {
    this.qrPayment.qrImageUrl = await QRCode.toDataURL(upiDeepLink);
    this.qrPayment.status = 'generated';
    return this.qrPayment;
  } catch (error) {
    throw new Error(`QR generation failed: ${error.message}`);
  }
};

// ✅ NEW: Generate UPI Deep Link
paymentSchema.methods.generateUPIDeepLink = function(upiId, name, amount) {
  const transactionNote = this.booking ? 
    `Payment for booking ${this.booking.bookingId}` : 
    `Payment for order ${this.order.orderId}`;
  
  return `upi://pay?pa=${upiId}&pn=${encodeURIComponent(name)}&am=${amount}&cu=INR&tn=${encodeURIComponent(transactionNote)}&tr=${this.transactionId}`;
};

// ✅ NEW: Process payment success
paymentSchema.methods.processPaymentSuccess = async function(upiTransactionId, verifiedAt) {
  this.status = 'success';
  this.paymentDate = verifiedAt || new Date();
  this.verified = true;
  
  // Store UPI transaction details
  this.upiPayment = {
    transactionId: upiTransactionId,
    status: 'success',
    verifiedAt: this.paymentDate,
    verificationMethod: 'webhook'
  };
  
  // Mark QR as paid
  this.qrPayment.status = 'paid';
  
  // Process commission based on payment destination
  if (this.paymentDestination === 'company_account') {
    await this.initiatePayout();
  } else {
    await this.recordPendingCommission();
  }
  
  await this.save();
  return this;
};

// ✅ NEW: Initiate payout for company account payments
paymentSchema.methods.initiatePayout = async function() {
  const owner = await this.getPaymentOwner();
  if (!owner) return;
  
  this.payout = {
    status: 'processing',
    payoutDate: new Date(),
    payoutMethod: 'upi',
    payoutTo: owner.upiId || owner.bankDetails?.accountNumber,
    transactionId: `P-${Date.now()}`
  };
  
  // In production, integrate with Razorpay Payouts API here
  // const razorpay = require('razorpay');
  // const payout = await razorpay.payouts.create({...});
  
  // Simulate successful payout
  setTimeout(async () => {
    this.payout.status = 'completed';
    await this.save();
    
    // Update owner earnings
    await this.updateOwnerEarnings();
  }, 1000);
};

// ✅ NEW: Record pending commission for personal account payments
paymentSchema.methods.recordPendingCommission = function() {
  this.pendingCommission = {
    amount: this.commission.pendingCommission,
    status: 'pending',
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  };
  
  this.paymentVerification = {
    status: 'pending',
    dueDate: this.pendingCommission.dueDate
  };
};

// ✅ NEW: Update owner earnings
paymentSchema.methods.updateOwnerEarnings = async function() {
  const owner = await this.getPaymentOwner();
  if (!owner) return;
  
  const earning = this.paymentType === 'service' ? 
    this.commission.providerEarning : 
    this.commission.shopEarning;
  
  if (this.paymentType === 'service' && owner.earnings) {
    owner.earnings.total = (owner.earnings.total || 0) + earning;
    owner.earnings.pending = (owner.earnings.pending || 0) + earning;
    await owner.save();
  } else if (this.paymentType === 'product' && owner.earnings) {
    owner.earnings.total = (owner.earnings.total || 0) + earning;
    owner.earnings.pending = (owner.earnings.pending || 0) + earning;
    await owner.save();
  }
};

// ✅ NEW: Mark commission as paid
paymentSchema.methods.markCommissionPaid = async function(adminId, paymentMethod, transactionId) {
  if (this.paymentDestination !== 'personal_account') {
    throw new Error('Only personal account payments have pending commission');
  }
  
  this.pendingCommission.status = 'paid';
  this.pendingCommission.paidDate = new Date();
  this.pendingCommission.paymentMethod = paymentMethod;
  this.pendingCommission.transactionId = transactionId;
  
  this.paymentVerification.status = 'verified';
  this.paymentVerification.verifiedAt = new Date();
  this.paymentVerification.verifiedBy = adminId;
  
  // Move pending commission to company commission
  this.commission.companyCommission = this.commission.pendingCommission;
  this.commission.pendingCommission = 0;
  
  await this.save();
  return this;
};

// ✅ NEW: Check if QR is expired
paymentSchema.methods.isQRExpired = function() {
  return this.qrPayment.expiresAt && new Date() > this.qrPayment.expiresAt;
};

// ✅ NEW: Get payment owner details
paymentSchema.methods.getPaymentOwner = async function() {
  if (this.provider) {
    return await mongoose.model('ServiceProvider').findById(this.provider);
  } else if (this.shop) {
    return await mongoose.model('Shop').findById(this.shop);
  }
  return null;
};

// ✅ NEW: Get payment owner type
paymentSchema.methods.getOwnerType = function() {
  if (this.provider) return 'provider';
  if (this.shop) return 'shop';
  return null;
};

// Static methods
paymentSchema.statics.findOverdueCommissions = function(days = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  return this.find({
    paymentDestination: 'personal_account',
    'pendingCommission.status': 'pending',
    'pendingCommission.dueDate': { $lt: cutoffDate }
  });
};

paymentSchema.statics.findPendingCommissions = function() {
  return this.find({
    paymentDestination: 'personal_account',
    'pendingCommission.status': 'pending',
    status: 'success'
  });
};

// Instance methods
paymentSchema.methods.canRefund = function() {
  return this.status === 'success' && 
         this.paymentDate && 
         new Date(this.paymentDate) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
};

paymentSchema.methods.calculateRefundAmount = function(cancellationCharge = 0) {
  return Math.max(0, this.amount - cancellationCharge);
};

module.exports = mongoose.model('Payment', paymentSchema);