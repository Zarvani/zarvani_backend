// ============= controllers/paymentController.js =============
const Booking = require("../models/Booking");
const { Payment } = require("../models/Payment");
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

// Get Payment History (User)
exports.getPaymentHistory = async (req, res) => {
  try {
    const { page = 1, limit = 50, period = 'all' } = req.query;
    
    // Build date filter based on period
    const dateFilter = getDateFilter(period);
    const query = { user: req.user._id, ...dateFilter };
    
    const payments = await Payment.find(query)
      .populate('booking')
      .populate('provider', 'name')
      .populate('shop', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Payment.countDocuments(query);
    
    // Calculate stats
    const stats = await calculateUserStats(req.user._id, period);
    
    ResponseHandler.success(res, {
      payments,
      stats,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    }, 'Payment history fetched successfully');
  } catch (error) {
    logger.error(`Get payment history error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Shop Earnings
exports.getShopEarnings = async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    
    // Assuming req.user has shop reference or is shop owner
    const shopId = req.user.shop || req.user._id;
    
    const dateFilter = getDateFilter(period);
    const query = { shop: shopId, ...dateFilter };
    
    const transactions = await Payment.find(query)
      .populate('user', 'name email')
      .populate('booking')
      .sort({ createdAt: -1 });
    
    // Calculate stats
    const stats = await calculateShopStats(shopId, period);
    
    ResponseHandler.success(res, {
      transactions,
      stats
    }, 'Shop earnings fetched successfully');
  } catch (error) {
    logger.error(`Get shop earnings error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Provider Earnings
exports.getProviderEarnings = async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    
    // Assuming req.user._id is the provider ID
    const providerId = req.user._id;
    
    const dateFilter = getDateFilter(period);
    const query = { provider: providerId, ...dateFilter };
    
    const transactions = await Payment.find(query)
      .populate('user', 'name email')
      .populate('booking')
      .sort({ createdAt: -1 });
    
    // Calculate stats
    const stats = await calculateProviderStats(providerId, period);
    
    ResponseHandler.success(res, {
      transactions,
      stats
    }, 'Provider earnings fetched successfully');
  } catch (error) {
    logger.error(`Get provider earnings error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Superadmin - Get All Earnings Overview
exports.getAllEarningsOverview = async (req, res) => {
  try {
    const { period = 'month', type = 'all' } = req.query;
    
    const dateFilter = getDateFilter(period);
    let query = { ...dateFilter };
    
    // Filter by type if specified
    if (type === 'shop') {
      query.shop = { $ne: null };
    } else if (type === 'provider') {
      query.provider = { $ne: null };
    }
    
    const transactions = await Payment.find(query)
      .populate('user', 'name email')
      .populate('provider', 'name email')
      .populate('shop', 'name')
      .populate('booking')
      .sort({ createdAt: -1 })
      .limit(100);
    
    // Calculate comprehensive stats
    const stats = await calculateSuperAdminStats(period);
    
    ResponseHandler.success(res, {
      transactions,
      stats
    }, 'All earnings overview fetched successfully');
  } catch (error) {
    logger.error(`Get all earnings overview error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Superadmin - Get Detailed Analytics
exports.getPaymentAnalytics = async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    const dateFilter = getDateFilter(period);
    
    // Aggregate by payment method
    const paymentMethodStats = await Payment.aggregate([
      { $match: { status: 'success', ...dateFilter } },
      {
        $group: {
          _id: '$paymentMethod',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);
    
    // Aggregate by status
    const statusStats = await Payment.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);
    
    // Top earning shops
    const topShops = await Payment.aggregate([
      { $match: { shop: { $ne: null }, status: 'success', ...dateFilter } },
      {
        $group: {
          _id: '$shop',
          totalEarnings: { $sum: '$amount' },
          transactionCount: { $sum: 1 }
        }
      },
      { $sort: { totalEarnings: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'shops',
          localField: '_id',
          foreignField: '_id',
          as: 'shopDetails'
        }
      }
    ]);
    
    // Top earning providers
    const topProviders = await Payment.aggregate([
      { $match: { provider: { $ne: null }, status: 'success', ...dateFilter } },
      {
        $group: {
          _id: '$provider',
          totalEarnings: { $sum: '$amount' },
          bookingCount: { $sum: 1 }
        }
      },
      { $sort: { totalEarnings: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'serviceproviders',
          localField: '_id',
          foreignField: '_id',
          as: 'providerDetails'
        }
      }
    ]);
    
    // Daily earnings trend
    const dailyTrend = await Payment.aggregate([
      { $match: { status: 'success', ...dateFilter } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          totalAmount: { $sum: '$amount' },
          transactionCount: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    ResponseHandler.success(res, {
      paymentMethodStats,
      statusStats,
      topShops,
      topProviders,
      dailyTrend
    }, 'Payment analytics fetched successfully');
  } catch (error) {
    logger.error(`Get payment analytics error: ${error.message}`);
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

// ============= Helper Functions =============

function getDateFilter(period) {
  const now = new Date();
  let startDate;
  
  switch (period) {
    case 'today':
      startDate = new Date(now.setHours(0, 0, 0, 0));
      break;
    case 'week':
      startDate = new Date(now.setDate(now.getDate() - 7));
      break;
    case 'month':
      startDate = new Date(now.setMonth(now.getMonth() - 1));
      break;
    case 'year':
      startDate = new Date(now.setFullYear(now.getFullYear() - 1));
      break;
    case 'all':
    default:
      return {};
  }
  
  return { createdAt: { $gte: startDate } };
}

async function calculateUserStats(userId, period) {
  const dateFilter = getDateFilter(period);
  const query = { user: userId, ...dateFilter };
  
  const successPayments = await Payment.find({ ...query, status: 'success' });
  const totalSpent = successPayments.reduce((sum, p) => sum + p.amount, 0);
  const productsPurchased = successPayments.filter(p => p.shop).length;
  const servicesBooked = successPayments.filter(p => p.provider).length;
  
  // This month calculation
  const thisMonthFilter = getDateFilter('month');
  const thisMonthPayments = await Payment.find({
    user: userId,
    status: 'success',
    ...thisMonthFilter
  });
  const thisMonth = thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
  
  return {
    totalSpent,
    productsPurchased,
    servicesBooked,
    thisMonth
  };
}

async function calculateShopStats(shopId, period) {
  const dateFilter = getDateFilter(period);
  const query = { shop: shopId, ...dateFilter };
  
  const allPayments = await Payment.find(query);
  const successPayments = allPayments.filter(p => p.status === 'success');
  
  const totalEarnings = successPayments.reduce((sum, p) => sum + p.amount, 0);
  const pendingPayouts = successPayments.reduce((sum, p) => sum + p.amount, 0); // Can add payout logic
  
  // This month
  const thisMonthFilter = getDateFilter('month');
  const thisMonthPayments = await Payment.find({
    shop: shopId,
    status: 'success',
    ...thisMonthFilter
  });
  const thisMonth = thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
  
  // Last payout (mock - implement actual payout tracking)
  const lastPayout = 5000;
  
  return {
    totalEarnings,
    pendingPayouts,
    thisMonth,
    lastPayout
  };
}

async function calculateProviderStats(providerId, period) {
  const dateFilter = getDateFilter(period);
  const query = { provider: providerId, ...dateFilter };
  
  const allPayments = await Payment.find(query);
  const successPayments = allPayments.filter(p => p.status === 'success');
  
  const totalEarnings = successPayments.reduce((sum, p) => sum + p.amount, 0);
  const pendingPayouts = successPayments.reduce((sum, p) => sum + p.amount, 0);
  
  // This month
  const thisMonthFilter = getDateFilter('month');
  const thisMonthPayments = await Payment.find({
    provider: providerId,
    status: 'success',
    ...thisMonthFilter
  });
  const thisMonth = thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
  
  const totalBookings = successPayments.length;
  
  return {
    totalEarnings,
    pendingPayouts,
    thisMonth,
    totalBookings
  };
}

async function calculateSuperAdminStats(period) {
  const dateFilter = getDateFilter(period);
  
  const allPayments = await Payment.find(dateFilter);
  const successPayments = allPayments.filter(p => p.status === 'success');
  
  const totalRevenue = successPayments.reduce((sum, p) => sum + p.amount, 0);
  const shopRevenue = successPayments
    .filter(p => p.shop)
    .reduce((sum, p) => sum + p.amount, 0);
  const providerRevenue = successPayments
    .filter(p => p.provider)
    .reduce((sum, p) => sum + p.amount, 0);
  
  const totalTransactions = allPayments.length;
  const successfulTransactions = successPayments.length;
  const pendingTransactions = allPayments.filter(p => p.status === 'pending').length;
  const failedTransactions = allPayments.filter(p => p.status === 'failed').length;
  const refundedTransactions = allPayments.filter(p => p.status === 'refunded').length;
  
  const refundedAmount = allPayments
    .filter(p => p.status === 'refunded')
    .reduce((sum, p) => sum + p.refundAmount, 0);
  
  return {
    totalRevenue,
    shopRevenue,
    providerRevenue,
    totalTransactions,
    successfulTransactions,
    pendingTransactions,
    failedTransactions,
    refundedTransactions,
    refundedAmount,
    averageTransactionValue: totalRevenue / (successfulTransactions || 1)
  };
}