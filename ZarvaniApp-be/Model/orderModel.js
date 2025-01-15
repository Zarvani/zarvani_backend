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
  planId: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'INR',
  },
  status: {
    type: String,
    enum: ['paid', 'failed'],
    default:'failed',
  },
  paymentId: String,
  signature: String,
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);