const Booking = require("../models/Booking");
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const PaymentService = require('../services/paymentService');
const QRPaymentService = require('../services/qrPaymentService');
const CommissionService = require('../services/commissionService');
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

// Process payment with commission handling
exports.processPayment = async (req, res) => {
  try {
    const { 
      bookingId, 
      orderId, 
      amount, 
      paymentMethod, 
      paymentDestination,
      providerId,
      shopId 
    } = req.body;

    const paymentData = {
      transactionId: `TXN-${Date.now()}`,
      booking: bookingId,
      order: orderId,
      user: req.user._id,
      provider: providerId,
      shop: shopId,
      amount,
      paymentMethod,
      paymentDestination
    };

    let payment;

    if (paymentDestination === 'company_account') {
      // Payment to company account - auto split 85-15
      payment = await CommissionService.processCompanyAccountPayment(paymentData);
    } else if (paymentDestination === 'personal_account') {
      // Payment to personal account - track pending commission
      payment = await CommissionService.processPersonalAccountPayment(paymentData);
    }

    ResponseHandler.success(res, { payment }, 'Payment processed successfully');
  } catch (error) {
    logger.error(`Process payment error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Complete service and handle commission
exports.completeService = async (req, res) => {
  try {
    const { bookingId } = req.body;

    const payment = await CommissionService.markServiceCompleted(bookingId);

    ResponseHandler.success(res, { payment }, 'Service completed and commission processed');
  } catch (error) {
    logger.error(`Complete service error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ============= QR PAYMENT METHODS =============

// Generate QR for User Payment
exports.generateUserQRPayment = async (req, res) => {
  try {
    const { bookingId, orderId, amount } = req.body;
    
    if (!bookingId && !orderId) {
      return ResponseHandler.error(res, 'Either bookingId or orderId is required', 400);
    }

    if (!amount || amount <= 0) {
      return ResponseHandler.error(res, 'Valid amount is required', 400);
    }
    
    const qrPayment = await QRPaymentService.generateUserQRPayment(
      bookingId, 
      orderId, 
      amount, 
      req.user._id
    );
    
    ResponseHandler.success(res, { 
      qrCode: qrPayment.qrImageUrl,
      upiId: qrPayment.upiId,
      amount: qrPayment.amount,
      expiresAt: qrPayment.expiresAt,
      paymentId: qrPayment._id
    }, 'QR code generated successfully');
  } catch (error) {
    logger.error(`Generate user QR error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Generate Collection QR for Provider/Shop
exports.generateCollectionQR = async (req, res) => {
  try {
    const { paymentId, destination } = req.body;
    
    if (!['company_account', 'personal_account'].includes(destination)) {
      return ResponseHandler.error(res, 'Invalid payment destination', 400);
    }

    const user = req.user;
    const ownerType = user.role === 'provider' ? 'provider' : 'shop';
    
    const result = await QRPaymentService.generateCollectionQR(
      paymentId,
      destination,
      user._id,
      ownerType
    );
    
    ResponseHandler.success(res, { 
      qrCode: result.qrData.qrImageUrl,
      upiId: result.qrData.upiId,
      amount: result.qrData.amount,
      expiresAt: result.qrData.expiresAt,
      paymentId: result.payment._id,
      paymentDestination: destination,
      pendingCommission: destination === 'personal_account' ? result.payment.commission.pendingCommission : 0,
      dueDate: destination === 'personal_account' ? result.payment.paymentVerification.dueDate : null
    }, 'Collection QR generated successfully');
  } catch (error) {
    logger.error(`Generate collection QR error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// UPI Payment Webhook (Called by Razorpay/UPI service)
exports.upiPaymentWebhook = async (req, res) => {
  try {
    const { 
      transactionId, 
      upiId, 
      amount, 
      status, 
      timestamp,
      currency = 'INR'
    } = req.body;
    
    if (status === 'success') {
      const payment = await QRPaymentService.verifyUPIPayment(
        transactionId, 
        upiId, 
        amount,
        timestamp
      );
      
      ResponseHandler.success(res, { payment }, 'UPI payment verified successfully');
    } else {
      // Handle failed payment
      const payment = await Payment.findOneAndUpdate(
        { 'qrPayment.upiId': upiId, 'qrPayment.amount': amount },
        {
          status: 'failed',
          'qrPayment.status': 'expired'
        },
        { new: true }
      );
      
      ResponseHandler.success(res, { payment }, 'UPI payment failed');
    }
  } catch (error) {
    logger.error(`UPI webhook error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get QR Payment Status
exports.getQRPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    const status = await QRPaymentService.getQRPaymentStatus(paymentId, req.user._id);
    
    ResponseHandler.success(res, status, 'QR payment status fetched successfully');
  } catch (error) {
    logger.error(`Get QR payment status error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Check Expired QR Codes (Admin)
exports.checkExpiredQRs = async (req, res) => {
  try {
    const expiredCount = await QRPaymentService.checkExpiredQRs();
    
    ResponseHandler.success(res, { expiredCount }, 'Expired QR check completed');
  } catch (error) {
    logger.error(`Check expired QR error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ============= COMMISSION MANAGEMENT METHODS =============

// Get Pending Commissions (Admin)
exports.getPendingCommissions = async (req, res) => {
  try {
    const { period = 'month', type, ownerId } = req.query;
    
    const filters = {};
    if (type === 'provider') {
      filters.provider = { $ne: null };
    } else if (type === 'shop') {
      filters.shop = { $ne: null };
    }
    
    if (ownerId) {
      if (type === 'provider') {
        filters.provider = ownerId;
      } else if (type === 'shop') {
        filters.shop = ownerId;
      }
    }
    
    const pendingCommissions = await CommissionService.getPendingCommissions(period, filters);
    const overdueCommissions = await CommissionService.getOverdueCommissions();
    const stats = await CommissionService.getCommissionStats(period);
    
    ResponseHandler.success(res, {
      pending: pendingCommissions,
      overdue: overdueCommissions,
      stats
    }, 'Commissions data fetched successfully');
  } catch (error) {
    logger.error(`Get commissions error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Mark Commission as Paid
exports.markCommissionPaid = async (req, res) => {
  try {
    const { paymentId, proof } = req.body;
    
    if (!paymentId) {
      return ResponseHandler.error(res, 'Payment ID is required', 400);
    }
    
    const payment = await CommissionService.markCommissionPaid(
      paymentId, 
      req.user._id,
      proof
    );
    
    ResponseHandler.success(res, { payment }, 'Commission marked as paid successfully');
  } catch (error) {
    logger.error(`Mark commission paid error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Send Commission Reminders (Cron Job - Admin)
exports.sendCommissionReminders = async (req, res) => {
  try {
    const reminderCount = await CommissionService.sendCommissionReminders();
    const dueDateReminderCount = await CommissionService.sendDueDateReminders();
    
    ResponseHandler.success(res, { 
      overdueReminders: reminderCount,
      dueDateReminders: dueDateReminderCount
    }, 'Commission reminders sent successfully');
  } catch (error) {
    logger.error(`Send commission reminders error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Commission Statistics
exports.getCommissionStats = async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    
    const stats = await CommissionService.getCommissionStats(period);
    
    ResponseHandler.success(res, stats, 'Commission statistics fetched successfully');
  } catch (error) {
    logger.error(`Get commission stats error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Owner Commission Summary (For Provider/Shop)
exports.getOwnerCommissionSummary = async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    const ownerId = req.user._id;
    const ownerType = req.user.role === 'provider' ? 'provider' : 'shop';
    
    const summary = await CommissionService.getOwnerCommissionSummary(ownerId, ownerType, period);
    
    ResponseHandler.success(res, { summary }, 'Commission summary fetched successfully');
  } catch (error) {
    logger.error(`Get owner commission summary error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Generate Commission Report (Admin)
exports.generateCommissionReport = async (req, res) => {
  try {
    const { period = 'month', format = 'json' } = req.query;
    
    const report = await CommissionService.generateCommissionReport(period, format);
    
    if (format === 'csv') {
      // Implement CSV conversion if needed
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=commission-report-${period}-${Date.now()}.csv`);
      // Return CSV data
    } else {
      ResponseHandler.success(res, report, 'Commission report generated successfully');
    }
  } catch (error) {
    logger.error(`Generate commission report error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Payment Details with Commission Info
exports.getPaymentDetails = async (req, res) => {
  try {
    const { id } = req.params;
    
    const payment = await Payment.findById(id)
      .populate('user', 'name phone email')
      .populate('provider', 'name phone email bankDetails')
      .populate('shop', 'name phone email bankDetails')
      .populate('booking', 'bookingId serviceDetails')
      .populate('order', 'orderId items');
    
    if (!payment) {
      return ResponseHandler.error(res, 'Payment not found', 404);
    }
    
    // Check authorization
    const userId = req.user._id;
    const userRole = req.user.role;
    
    let isAuthorized = false;
    if (userRole === 'admin') {
      isAuthorized = true;
    } else if (userRole === 'user' && payment.user._id.toString() === userId.toString()) {
      isAuthorized = true;
    } else if (userRole === 'provider' && payment.provider && payment.provider._id.toString() === userId.toString()) {
      isAuthorized = true;
    } else if (userRole === 'shop' && payment.shop && payment.shop._id.toString() === userId.toString()) {
      isAuthorized = true;
    }
    
    if (!isAuthorized) {
      return ResponseHandler.error(res, 'Not authorized to view this payment', 403);
    }
    
    ResponseHandler.success(res, { payment }, 'Payment details fetched successfully');
  } catch (error) {
    logger.error(`Get payment details error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ============= HELPER FUNCTIONS =============

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
  const pendingPayouts = successPayments.reduce((sum, p) => sum + (p.commission.providerEarning || 0), 0);
  
  // This month
  const thisMonthFilter = getDateFilter('month');
  const thisMonthPayments = await Payment.find({
    shop: shopId,
    status: 'success',
    ...thisMonthFilter
  });
  const thisMonth = thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
  
  // Pending commissions for personal account payments
  const pendingCommissions = await Payment.find({
    shop: shopId,
    paymentDestination: 'personal_account',
    'paymentVerification.status': 'pending',
    status: 'success'
  });
  const totalPendingCommission = pendingCommissions.reduce((sum, p) => sum + p.commission.pendingCommission, 0);
  
  return {
    totalEarnings,
    pendingPayouts,
    thisMonth,
    totalPendingCommission,
    pendingCommissionCount: pendingCommissions.length
  };
}

async function calculateProviderStats(providerId, period) {
  const dateFilter = getDateFilter(period);
  const query = { provider: providerId, ...dateFilter };
  
  const allPayments = await Payment.find(query);
  const successPayments = allPayments.filter(p => p.status === 'success');
  
  const totalEarnings = successPayments.reduce((sum, p) => sum + p.amount, 0);
  const pendingPayouts = successPayments.reduce((sum, p) => sum + (p.commission.providerEarning || 0), 0);
  
  // This month
  const thisMonthFilter = getDateFilter('month');
  const thisMonthPayments = await Payment.find({
    provider: providerId,
    status: 'success',
    ...thisMonthFilter
  });
  const thisMonth = thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
  
  const totalBookings = successPayments.length;
  
  // Pending commissions for personal account payments
  const pendingCommissions = await Payment.find({
    provider: providerId,
    paymentDestination: 'personal_account',
    'paymentVerification.status': 'pending',
    status: 'success'
  });
  const totalPendingCommission = pendingCommissions.reduce((sum, p) => sum + p.commission.pendingCommission, 0);
  
  return {
    totalEarnings,
    pendingPayouts,
    thisMonth,
    totalBookings,
    totalPendingCommission,
    pendingCommissionCount: pendingCommissions.length
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
    .reduce((sum, p) => sum + (p.refund?.amount || 0), 0);
  
  // Commission stats
  const companyAccountPayments = successPayments.filter(p => p.paymentDestination === 'company_account');
  const personalAccountPayments = successPayments.filter(p => p.paymentDestination === 'personal_account');
  
  const totalCommission = companyAccountPayments.reduce((sum, p) => sum + (p.commission.companyCommission || 0), 0) +
                         personalAccountPayments.reduce((sum, p) => sum + (p.commission.pendingCommission || 0), 0);
  
  const pendingCommission = personalAccountPayments
    .filter(p => p.paymentVerification?.status === 'pending')
    .reduce((sum, p) => sum + (p.commission.pendingCommission || 0), 0);
  
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
    totalCommission,
    pendingCommission,
    averageTransactionValue: totalRevenue / (successfulTransactions || 1),
    companyAccountTransactions: companyAccountPayments.length,
    personalAccountTransactions: personalAccountPayments.length
  };
}

module.exports = exports;