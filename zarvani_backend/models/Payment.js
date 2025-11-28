// ============= models/Payment.js =============
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
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
  
  // Commission Structure
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
    commissionRate: { 
      type: Number, 
      default: 15,
      min: 0,
      max: 100 
    },
    calculatedAt: {
      type: Date,
      default: Date.now
    }
  },
  
  // Payment Destination
  paymentDestination: {
    type: String,
    enum: ['company_account', 'personal_account'],
    required: true
  },
  
  // For personal account payments
  pendingCommission: {
    amount: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'overdue', 'waived'],
      default: 'pending'
    },
    dueDate: {
      type: Date,
      required: function() {
        return this.paymentDestination === 'personal_account';
      }
    },
    paidDate: Date,
    reminderSent: {
      type: Boolean,
      default: false
    },
    remindersSent: [{
      sentAt: Date,
      type: {
        type: String,
        enum: ['email', 'sms', 'push']
      }
    }]
  },
  
  // Payout tracking for company account payments
  payout: {
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending'
    },
    payoutId: String,
    payoutDate: Date,
    failureReason: String,
    retryCount: {
      type: Number,
      default: 0
    },
    lastRetryAt: Date
  },
  
  // Payment details
  paymentMethod: {
    type: String,
    enum: ['cash', 'upi', 'card', 'netbanking', 'wallet'],
    required: true
  },
  paymentGateway: String,
  gatewayTransactionId: String,
  gatewayResponse: mongoose.Schema.Types.Mixed,
  
  status: {
    type: String,
    enum: ['pending', 'success', 'failed', 'refunded', 'cancelled'],
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

// Virtual for isOverdue
paymentSchema.virtual('isOverdue').get(function() {
  if (this.paymentDestination === 'personal_account' && 
      this.pendingCommission.status === 'pending' &&
      this.pendingCommission.dueDate) {
    return new Date() > this.pendingCommission.dueDate;
  }
  return false;
});

// Virtual for daysOverdue
paymentSchema.virtual('daysOverdue').get(function() {
  if (this.isOverdue) {
    const today = new Date();
    const dueDate = this.pendingCommission.dueDate;
    const diffTime = Math.abs(today - dueDate);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
  return 0;
});

// Pre-save middleware
paymentSchema.pre('save', function(next) {
  if (this.isModified('pendingCommission.status') && 
      this.pendingCommission.status === 'paid' && 
      !this.pendingCommission.paidDate) {
    this.pendingCommission.paidDate = new Date();
  }
  next();
});

// Static methods
paymentSchema.statics.findOverdueCommissions = function(days = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  return this.find({
    'pendingCommission.status': 'pending',
    'pendingCommission.dueDate': { $lt: cutoffDate }
  });
};

// Instance methods
paymentSchema.methods.canRefund = function() {
  return this.status === 'success' && 
         this.paymentDate && 
         new Date(this.paymentDate) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days
};

paymentSchema.methods.calculateRefundAmount = function(cancellationCharge = 0) {
  return Math.max(0, this.amount - cancellationCharge);
};

module.exports = mongoose.model('Payment', paymentSchema);