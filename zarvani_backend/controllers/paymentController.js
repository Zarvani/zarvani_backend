// ============= controllers/paymentController.js =============
const Booking =require("../models/Booking")
const { Payment } = require("../models/Payment")
const PaymentService = require('../services/paymentService');
const ResponseHandler = require('../utils/responseHandler');
const logger = require('../utils/logger');

// Create Razorpay Order
exports.createOrder = async (req, res) => {
  try {
    const { bookingId, amount } = req.body;
    
    const booking = await Booking.findById(bookingId);
    
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }
    
    if (booking.user.toString() !== req.user._id.toString()) {
      return ResponseHandler.error(res, 'Not authorized', 403);
    }
    
    const receipt = `RCPT-${Date.now()}`;
    const order = await PaymentService.createRazorpayOrder(amount, 'INR', receipt);
    
    if (!order.success) {
      return ResponseHandler.error(res, 'Failed to create order', 500);
    }
    
    // Create payment record
    const payment = await Payment.create({
      transactionId: order.order.id,
      booking: bookingId,
      user: req.user._id,
      provider: booking.provider,
      amount,
      paymentMethod: 'upi',
      paymentGateway: 'razorpay',
      status: 'pending'
    });
    
    ResponseHandler.success(res, {
      orderId: order.order.id,
      amount: order.order.amount,
      currency: order.order.currency,
      paymentId: payment._id
    }, 'Order created successfully');
  } catch (error) {
    logger.error(`Create order error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Verify Payment
exports.verifyPayment = async (req, res) => {
  try {
    const { orderId, paymentId, signature, bookingId } = req.body;
    
    const isValid = PaymentService.verifyRazorpaySignature(orderId, paymentId, signature);
    
    if (!isValid) {
      return ResponseHandler.error(res, 'Invalid payment signature', 400);
    }
    
    // Update payment status
    const payment = await Payment.findOneAndUpdate(
      { transactionId: orderId },
      {
        status: 'success',
        gatewayTransactionId: paymentId,
        paymentDate: new Date()
      },
      { new: true }
    );
    
    // Update booking
    const booking = await Booking.findByIdAndUpdate(
      bookingId,
      {
        payment: payment._id,
        status: 'confirmed'
      },
      { new: true }
    ).populate('service provider user');
    
    // Send confirmation email
    const EmailService = require('../services/emailService');
    if (booking.user.email) {
      await EmailService.sendBookingConfirmation(booking.user.email, {
        userName: booking.user.name,
        bookingId: booking.bookingId,
        serviceName: booking.serviceDetails.title,
        date: booking.scheduledDate,
        time: booking.scheduledTime,
        providerName: booking.provider.name,
        amount: booking.totalAmount
      });
    }
    
    ResponseHandler.success(res, { payment, booking }, 'Payment verified successfully');
  } catch (error) {
    logger.error(`Verify payment error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Cash Payment
exports.cashPayment = async (req, res) => {
  try {
    const { bookingId } = req.body;
    
    const booking = await Booking.findById(bookingId);
    
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }
    
    if (booking.user.toString() !== req.user._id.toString()) {
      return ResponseHandler.error(res, 'Not authorized', 403);
    }
    
    const payment = await Payment.create({
      transactionId: `CASH-${Date.now()}`,
      booking: bookingId,
      user: req.user._id,
      provider: booking.provider,
      amount: booking.totalAmount,
      paymentMethod: 'cash',
      status: 'pending'
    });
    
    booking.payment = payment._id;
    booking.status = 'confirmed';
    await booking.save();
    
    ResponseHandler.success(res, { payment, booking }, 'Booking confirmed with cash payment');
  } catch (error) {
    logger.error(`Cash payment error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Payment History
exports.getPaymentHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    const payments = await Payment.find({ user: req.user._id })
      .populate('booking')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Payment.countDocuments({ user: req.user._id });
    
    ResponseHandler.paginated(res, payments, page, limit, count);
  } catch (error) {
    logger.error(`Get payment history error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Initiate Refund
exports.initiateRefund = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const payment = await Payment.findById(id).populate('booking');
    
    if (!payment) {
      return ResponseHandler.error(res, 'Payment not found', 404);
    }
    
    if (payment.status !== 'success') {
      return ResponseHandler.error(res, 'Cannot refund this payment', 400);
    }
    
    const refund = await PaymentService.initiateRefund(
      payment.gatewayTransactionId,
      payment.amount,
      reason
    );
    
    if (!refund.success) {
      return ResponseHandler.error(res, 'Refund failed', 500);
    }
    
    payment.status = 'refunded';
    payment.refundAmount = payment.amount;
    payment.refundDate = new Date();
    payment.refundReason = reason;
    await payment.save();
    
    ResponseHandler.success(res, { payment }, 'Refund initiated successfully');
  } catch (error) {
    logger.error(`Refund error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
