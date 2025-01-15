const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Userdata',
    required: true,
  },
  planId: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'cancelled'],
    default: 'active',
  },
  startDate: {
    type: Date,
    default: Date.now,
  },
  endDate: {
    type: Date,
    required: true,
  },
  credit:{
    type:Number,
    default:0,
  },
  paymentId: String,
  orderId: String,
  amount: Number,
}, { timestamps: true });

module.exports = mongoose.model('Subscription', subscriptionSchema);