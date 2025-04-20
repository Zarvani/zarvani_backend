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
    enum: ['initiated', 'accepted','in-progress', 'completed', 'cancelled'],
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
    email:  String,
    dateTime: String,
    city: String,
    state: String,
    country: String,
    pincode: String,
    area: String,
    address: String,
    message: String,  // Add other fields based on your formData structure
  },
  files: {
    photos: [String],
    video: String,
  }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
