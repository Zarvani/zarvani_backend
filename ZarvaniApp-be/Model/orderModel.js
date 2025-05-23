const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Userdata',
    required: true,
  },
  orderId: {
    type: String,
    required: true,
    unique: true,
  },
  orderStatus: {
    type: String,
    enum: ['initiated', 'accepted', 'in-progress', 'completed', 'cancelled'],
    default: 'initiated',
  },
  orderDate: {
    type: Date,
    default: Date.now,
  },
  service: {
    id: String,
    name: String,
    price: Number,
    category: String,
  },
  userData: {
    name: String,
    phone: String,
    email: String,
    dateTime: String,
    city: String,
    state: String,
    country: String,
    pincode: String,
    area: String,
    address: String,
    message: String,
  },
  files: {
    photos: [String],
    video: String,
  },
  
  // ============= ADDED FIELDS FOR SERVICE PROVIDER WORKFLOW =============
  
  // Service Provider Assignment
  serviceProviderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceProvider', // Adjust ref name based on your service provider model
    default: null,
  },
  
  // Estimated completion time set by service provider
  estimatedCompletionTime: {
    type: Date,
    default: null,
  },
  
  // Actual completion time
  completedAt: {
    type: Date,
    default: null,
  },
  
  // Images uploaded by service provider upon completion
  completionImages: {
    type: [String],
    default: [],
  },
  
  // Status history to track all status changes
  statusHistory: [{
    status: {
      type: String,
      enum: ['initiated', 'accepted', 'in-progress', 'completed', 'cancelled'],
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    note: {
      type: String,
      default: '',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'statusHistory.updatedByModel',
    },
    updatedByModel: {
      type: String,
      enum: ['Userdata', 'ServiceProvider', 'Admin'],
      default: 'Userdata',
    },
    images: {
      type: [String],
      default: [],
    },
  }],
  
  // Service provider notes/comments
  providerNotes: {
    type: [String],
    default: [],
  },
  
  // Payment related fields (optional)
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'refunded'],
    default: 'pending',
  },
  
  // Rating and feedback (optional)
  rating: {
    customerRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
    customerFeedback: {
      type: String,
      default: '',
    },
    providerRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
    providerFeedback: {
      type: String,
      default: '',
    },
  },
  
}, { timestamps: true });

// Index for better query performance
orderSchema.index({ 'service.category': 1, orderStatus: 1, serviceProviderId: 1 });
orderSchema.index({ userId: 1, orderStatus: 1 });
orderSchema.index({ serviceProviderId: 1, orderStatus: 1 });

// Pre-save middleware to update statusHistory
orderSchema.pre('save', function(next) {
  if (this.isModified('orderStatus')) {
    // Add to status history if status changed
    const lastHistoryEntry = this.statusHistory[this.statusHistory.length - 1];
    
    if (!lastHistoryEntry || lastHistoryEntry.status !== this.orderStatus) {
      this.statusHistory.push({
        status: this.orderStatus,
        timestamp: new Date(),
        note: `Status changed to ${this.orderStatus}`,
      });
    }
    
    // Set completion time if completed
    if (this.orderStatus === 'completed' && !this.completedAt) {
      this.completedAt = new Date();
    }
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);