// ============= models/Payment.js =============
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const paymentSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    unique: true,
    required: true
  },
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking'
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
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'upi', 'card', 'netbanking', 'wallet'],
    required: true
  },
  paymentGateway: String,
  gatewayTransactionId: String,
  status: {
    type: String,
    enum: ['pending', 'success', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentDate: Date,
  refundAmount: Number,
  refundDate: Date,
  refundReason: String,
  invoice: {
    url: String,
    publicId: String
  }
}, { timestamps: true });

module.exports = {Payment: mongoose.model('Payment', paymentSchema)};