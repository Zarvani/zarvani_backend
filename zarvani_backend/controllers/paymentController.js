const mongoose = require('mongoose');
const Booking = require("../models/Booking");
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const PaymentService = require('../services/paymentService');
const QRPaymentService = require('../services/qrPaymentService');
const CommissionService = require('../services/commissionService');
const ResponseHandler = require('../utils/responseHandler');
const logger = require('../utils/logger');
const crypto = require('crypto');

// ✅ NEW: Create payment with QR (supports both destinations)
exports.createPaymentWithQR = async (req, res) => {
  try {
    const { 
      bookingId, 
      orderId, 
      amount, 
      paymentDestination = 'company_account',
      providerId,
      shopId 
    } = req.body;
    
    // Validate payment destination
    if (!['company_account', 'personal_account'].includes(paymentDestination)) {
      return ResponseHandler.error(res, 'Invalid payment destination', 400);
    }
    
    if (!amount || amount <= 0) {
      return ResponseHandler.error(res, 'Valid amount is required', 400);
    }
    
    // Validate either booking or order exists
    if (!bookingId && !orderId) {
      return ResponseHandler.error(res, 'Either bookingId or orderId is required', 400);
    }
    
    // Generate QR payment
    const result = await QRPaymentService.generatePaymentQR({
      bookingId,
      orderId,
      amount,
      userId: req.user._id,
      paymentDestination,
      providerId,
      shopId
    });
    
    ResponseHandler.success(res, {
      paymentId: result.payment._id,
      transactionId: result.payment.transactionId,
      qrCode: result.qrData.qrImageUrl,
      upiDeepLink: result.qrData.upiDeepLink,
      upiId: result.qrData.upiId,
      amount: result.qrData.amount,
      expiresAt: result.qrData.expiresAt,
      paymentDestination: result.payment.paymentDestination,
      paymentType: result.payment.paymentType,
      commission: {
        rate: result.payment.paymentDestination === 'company_account' ? 
              (result.payment.paymentType === 'service' ? 15 : 8) :
              (result.payment.paymentType === 'service' ? 20 : 12),
        amount: result.payment.totalCommission,
        netEarning: result.payment.netEarning
      }
    }, 'QR payment generated successfully');
  } catch (error) {
    logger.error(`Create payment with QR error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ✅ NEW: Generate collection QR for provider/shop
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
      paymentId: result.payment._id,
      qrCode: result.qrData.qrImageUrl,
      upiDeepLink: result.qrData.upiDeepLink,
      upiId: result.qrData.upiId,
      amount: result.qrData.amount,
      expiresAt: result.qrData.expiresAt,
      paymentDestination: destination,
      commission: {
        pending: destination === 'personal_account' ? result.payment.commission.pendingCommission : 0,
        rate: destination === 'personal_account' ? 
              (result.payment.paymentType === 'service' ? 20 : 12) : 0
      },
      dueDate: destination === 'personal_account' ? result.payment.pendingCommission.dueDate : null
    }, 'Collection QR generated successfully');
  } catch (error) {
    logger.error(`Generate collection QR error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ✅ NEW: UPI Payment Webhook (from Razorpay/UPI service)
exports.upiPaymentWebhook = async (req, res) => {
  try {
    // Verify webhook signature (if provided by payment gateway)
    const signature = req.headers['x-razorpay-signature'];
    const body = JSON.stringify(req.body);
    
    if (signature && process.env.RAZORPAY_WEBHOOK_SECRET) {
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(body)
        .digest('hex');
      
      if (signature !== expectedSignature) {
        logger.warn('Invalid webhook signature received');
        return ResponseHandler.error(res, 'Invalid webhook signature', 401);
      }
    }
    
    const webhookData = req.body;
    
    // Process the webhook
    const payment = await QRPaymentService.handleUPIWebhook(webhookData);
    
    if (payment) {
      ResponseHandler.success(res, { payment }, 'Webhook processed successfully');
    } else {
      ResponseHandler.success(res, {}, 'Webhook processed, no action taken');
    }
  } catch (error) {
    logger.error(`UPI webhook error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ✅ NEW: Manual UPI payment verification
exports.verifyManualUPIPayment = async (req, res) => {
  try {
    const { paymentId, transactionId, screenshot } = req.body;
    
    const payment = await QRPaymentService.verifyManualUPIPayment(paymentId, {
      transactionId,
      screenshot,
      verifiedBy: req.user._id,
      notes: req.body.notes
    });
    
    ResponseHandler.success(res, { payment }, 'Manual UPI payment verified successfully');
  } catch (error) {
    logger.error(`Manual UPI verification error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ✅ NEW: Generate UPI deep link for manual payment
exports.generateUPIDeepLink = async (req, res) => {
  try {
    const { upiId, name, amount, transactionNote } = req.body;
    
    if (!upiId || !amount) {
      return ResponseHandler.error(res, 'UPI ID and amount are required', 400);
    }
    
    const deepLink = await QRPaymentService.generateUPIDeepLink({
      upiId,
      name,
      amount,
      transactionNote
    });
    
    ResponseHandler.success(res, { 
      deepLink: deepLink.deepLink,
      transactionId: deepLink.transactionId,
      upiId: deepLink.upiId,
      amount: deepLink.amount
    }, 'UPI deep link generated successfully');
  } catch (error) {
    logger.error(`Generate UPI deep link error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ✅ NEW: Get QR payment status
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

// ✅ NEW: Check expired QR codes (Admin/Cron)
exports.checkExpiredQRs = async (req, res) => {
  try {
    // Verify API key for cron jobs
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.CRON_API_KEY && req.user?.role !== 'admin') {
      return ResponseHandler.error(res, 'Unauthorized', 401);
    }
    
    const expiredCount = await QRPaymentService.expireOldQRCodes();
    
    ResponseHandler.success(res, { expiredCount }, 'Expired QR check completed');
  } catch (error) {
    logger.error(`Check expired QR error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ============= COMMISSION MANAGEMENT METHODS =============

// ✅ NEW: Get pending commissions with filters
exports.getPendingCommissions = async (req, res) => {
  try {
    const { 
      ownerType, 
      ownerId, 
      startDate, 
      endDate, 
      minAmount, 
      maxAmount,
      page = 1,
      limit = 20
    } = req.query;
    
    const filters = {
      ownerType,
      ownerId,
      startDate,
      endDate,
      minAmount: minAmount ? parseFloat(minAmount) : undefined,
      maxAmount: maxAmount ? parseFloat(maxAmount) : undefined
    };
    
    const pendingCommissions = await CommissionService.getPendingCommissions(filters);
    
    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedCommissions = pendingCommissions.slice(startIndex, endIndex);
    
    ResponseHandler.success(res, {
      commissions: paginatedCommissions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(pendingCommissions.length / limit),
        totalItems: pendingCommissions.length,
        itemsPerPage: parseInt(limit)
      }
    }, 'Pending commissions fetched successfully');
  } catch (error) {
    logger.error(`Get pending commissions error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ✅ NEW: Get overdue commissions
exports.getOverdueCommissions = async (req, res) => {
  try {
    const { severity = 'all' } = req.query;
    
    const overdueCommissions = await CommissionService.getOverdueCommissions(severity);
    
    ResponseHandler.success(res, {
      commissions: overdueCommissions,
      summary: {
        total: overdueCommissions.length,
        totalAmount: overdueCommissions.reduce((sum, p) => sum + p.commission.pendingCommission, 0),
        bySeverity: {
          critical: overdueCommissions.filter(p => p.daysOverdue > 14).length,
          high: overdueCommissions.filter(p => p.daysOverdue > 7 && p.daysOverdue <= 14).length,
          normal: overdueCommissions.filter(p => p.daysOverdue <= 7).length
        }
      }
    }, 'Overdue commissions fetched successfully');
  } catch (error) {
    logger.error(`Get overdue commissions error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ✅ NEW: Mark commission as paid
exports.markCommissionPaid = async (req, res) => {
  try {
    const { paymentId, paymentMethod = 'upi', transactionId, screenshotUrl, notes } = req.body;
    
    if (!paymentId) {
      return ResponseHandler.error(res, 'Payment ID is required', 400);
    }
    
    const payment = await CommissionService.markCommissionPaid(
      paymentId, 
      req.user._id,
      { paymentMethod, transactionId, screenshotUrl, notes }
    );
    
    ResponseHandler.success(res, { payment }, 'Commission marked as paid successfully');
  } catch (error) {
    logger.error(`Mark commission paid error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ✅ NEW: Send commission reminders (Cron Job - Admin)
exports.sendCommissionReminders = async (req, res) => {
  try {
    // Verify API key for cron jobs
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.CRON_API_KEY && req.user?.role !== 'admin') {
      return ResponseHandler.error(res, 'Unauthorized', 401);
    }
    
    const { reminderCount, escalationCount } = await CommissionService.sendCommissionReminders();
    const dueDateReminderCount = await CommissionService.sendDueDateReminders();
    
    ResponseHandler.success(res, { 
      overdueReminders: reminderCount,
      dueDateReminders: dueDateReminderCount,
      escalations: escalationCount
    }, 'Commission reminders sent successfully');
  } catch (error) {
    logger.error(`Send commission reminders error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ✅ NEW: Get commission statistics
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

// ✅ NEW: Get owner commission summary (For Provider/Shop)
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

// ✅ NEW: Generate commission report (Admin)
exports.generateCommissionReport = async (req, res) => {
  try {
    const { period = 'month', format = 'json' } = req.query;
    
    const report = await CommissionService.generateCommissionReport(period, format);
    
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=commission-report-${period}-${Date.now()}.csv`);
      return res.send(report);
    } else {
      ResponseHandler.success(res, report, 'Commission report generated successfully');
    }
  } catch (error) {
    logger.error(`Generate commission report error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ✅ NEW: Get payment analytics with commission breakdown
exports.getPaymentAnalytics = async (req, res) => {
  try {
    const { period = 'month', type = 'all' } = req.query;
    
    // Get commission stats
    const commissionStats = await CommissionService.getCommissionStats(period);
    
    // Get payment method stats
    const dateFilter = getDateFilter(period);
    const paymentMethodStats = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          ...dateFilter
        }
      },
      {
        $group: {
          _id: '$paymentMethod',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          avgAmount: { $avg: '$amount' }
        }
      },
      { $sort: { totalAmount: -1 } }
    ]);
    
    // Get payment destination stats
    const destinationStats = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          ...dateFilter
        }
      },
      {
        $group: {
          _id: '$paymentDestination',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          avgAmount: { $avg: '$amount' }
        }
      }
    ]);
    
    // Get payment type stats
    const typeStats = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          ...dateFilter
        }
      },
      {
        $group: {
          _id: '$paymentType',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          avgAmount: { $avg: '$amount' }
        }
      }
    ]);
    
    // Get daily trend
    const dailyTrend = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          ...dateFilter
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          totalAmount: { $sum: '$amount' },
          totalCommission: { 
            $sum: {
              $cond: [
                { $eq: ['$paymentDestination', 'company_account'] },
                '$commission.companyCommission',
                { 
                  $cond: [
                    { $eq: ['$pendingCommission.status', 'paid'] },
                    '$commission.pendingCommission',
                    0
                  ]
                }
              ]
            }
          },
          transactionCount: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    ResponseHandler.success(res, {
      timeframe: period,
      generatedAt: new Date(),
      summary: {
        totalRevenue: commissionStats.summary.totalRevenue,
        totalCommission: commissionStats.summary.totalCommission,
        pendingCommission: commissionStats.summary.pendingCommission,
        collectionRate: commissionStats.metrics.collectionRate,
        commissionRate: commissionStats.metrics.commissionRate
      },
      breakdown: {
        byDestination: destinationStats,
        byMethod: paymentMethodStats,
        byType: typeStats,
        commissionBreakdown: commissionStats.breakdown
      },
      trends: {
        daily: dailyTrend
      },
      topMetrics: commissionStats.topPayers ? {
        topCommissionPayers: commissionStats.topPayers.slice(0, 5)
      } : {}
    }, 'Payment analytics fetched successfully');
  } catch (error) {
    logger.error(`Get payment analytics error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ============= EXISTING METHODS (UPDATED) =============

// Create Razorpay Order (Updated for commission tracking)
exports.createOrder = async (req, res) => {
  try {
    const { bookingId, amount, paymentDestination = 'company_account' } = req.body;
    
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
    
    // Create payment record with commission tracking
    const payment = await Payment.create({
      transactionId: order.order.id,
      booking: bookingId,
      user: req.user._id,
      provider: booking.provider,
      amount,
      paymentMethod: 'upi',
      paymentGateway: 'razorpay',
      paymentDestination,
      paymentType: 'service',
      status: 'pending'
    });
    
    // Calculate commission
    await payment.calculateCommission();
    await payment.save();
    
    ResponseHandler.success(res, {
      orderId: order.order.id,
      amount: order.order.amount,
      currency: order.order.currency,
      paymentId: payment._id,
      paymentDestination,
      commission: {
        rate: payment.paymentDestination === 'company_account' ? 15 : 20,
        amount: payment.totalCommission
      }
    }, 'Order created successfully');
  } catch (error) {
    logger.error(`Create order error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Verify Payment (Updated)
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
        paymentDate: new Date(),
        verified: true
      },
      { new: true }
    );
    
    if (!payment) {
      return ResponseHandler.error(res, 'Payment not found', 404);
    }
    
    // Process commission based on payment destination
    if (payment.paymentDestination === 'company_account') {
      await payment.initiatePayout();
    } else {
      await payment.recordPendingCommission();
    }
    
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
        amount: booking.totalAmount,
        paymentDestination: payment.paymentDestination,
        commission: payment.totalCommission
      });
    }
    
    ResponseHandler.success(res, { payment, booking }, 'Payment verified successfully');
  } catch (error) {
    logger.error(`Verify payment error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Payment History (Updated)
exports.getPaymentHistory = async (req, res) => {
  try {
    const { page = 1, limit = 50, period = 'all', type } = req.query;
    
    // Build date filter based on period
    const dateFilter = getDateFilter(period);
    
    // Build query
    let query = { user: req.user._id, ...dateFilter };
    
    // Filter by type if specified
    if (type === 'service') {
      query.provider = { $ne: null };
      query.paymentType = 'service';
    } else if (type === 'product') {
      query.shop = { $ne: null };
      query.paymentType = 'product';
    }
    
    const payments = await Payment.find(query)
      .populate('booking', 'bookingId serviceDetails')
      .populate('order', 'orderId items')
      .populate('provider', 'name')
      .populate('shop', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Payment.countDocuments(query);
    
    // Calculate stats
    const stats = await calculateUserStats(req.user._id, period);
    
    ResponseHandler.success(res, {
      payments: payments.map(p => ({
        id: p._id,
        transactionId: p.transactionId,
        amount: p.amount,
        status: p.status,
        paymentMethod: p.paymentMethod,
        paymentDestination: p.paymentDestination,
        paymentType: p.paymentType,
        createdAt: p.createdAt,
        booking: p.booking,
        order: p.order,
        provider: p.provider,
        shop: p.shop,
        commission: {
          amount: p.totalCommission,
          netEarning: p.netEarning,
          status: p.paymentDestination === 'personal_account' ? p.pendingCommission.status : 'n/a'
        }
      })),
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

// Get Shop Earnings (Updated)
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
      transactions: transactions.map(t => ({
        id: t._id,
        transactionId: t.transactionId,
        amount: t.amount,
        paymentDestination: t.paymentDestination,
        status: t.status,
        createdAt: t.createdAt,
        commission: {
          amount: t.totalCommission,
          netEarning: t.netEarning,
          pending: t.pendingCommission?.amount || 0,
          status: t.pendingCommission?.status
        },
        user: t.user
      })),
      stats
    }, 'Shop earnings fetched successfully');
  } catch (error) {
    logger.error(`Get shop earnings error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Provider Earnings (Updated)
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
      transactions: transactions.map(t => ({
        id: t._id,
        transactionId: t.transactionId,
        amount: t.amount,
        paymentDestination: t.paymentDestination,
        status: t.status,
        createdAt: t.createdAt,
        commission: {
          amount: t.totalCommission,
          netEarning: t.netEarning,
          pending: t.pendingCommission?.amount || 0,
          status: t.pendingCommission?.status
        },
        user: t.user
      })),
      stats
    }, 'Provider earnings fetched successfully');
  } catch (error) {
    logger.error(`Get provider earnings error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Owner Earnings (Unified for both provider/shop)
exports.getOwnerEarnings = async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    const ownerId = req.user._id;
    const ownerType = req.user.role === 'provider' ? 'provider' : 'shop';
    
    const dateFilter = getDateFilter(period);
    const query = { [ownerType]: ownerId, ...dateFilter };
    
    const transactions = await Payment.find(query)
      .populate('user', 'name email phone')
      .populate('booking', 'bookingId serviceDetails')
      .populate('order', 'orderId items')
      .sort({ createdAt: -1 })
      .limit(100);
    
    // Calculate comprehensive stats
    const stats = ownerType === 'provider' ? 
      await calculateProviderStats(ownerId, period) : 
      await calculateShopStats(ownerId, period);
    
    ResponseHandler.success(res, {
      transactions,
      stats,
      ownerType
    }, 'Earnings fetched successfully');
  } catch (error) {
    logger.error(`Get owner earnings error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Superadmin - Get All Earnings Overview (Updated)
exports.getAllEarningsOverview = async (req, res) => {
  try {
    const { period = 'month', type = 'all' } = req.query;
    
    const dateFilter = getDateFilter(period);
    let query = { ...dateFilter };
    
    // Filter by type if specified
    if (type === 'shop') {
      query.shop = { $ne: null };
      query.paymentType = 'product';
    } else if (type === 'provider') {
      query.provider = { $ne: null };
      query.paymentType = 'service';
    }
    
    const transactions = await Payment.find(query)
      .populate('user', 'name phone email')
      .populate('provider', 'name phone email')
      .populate('shop', 'name phone email')
      .populate('booking', 'bookingId serviceDetails')
      .populate('order', 'orderId items')
      .sort({ createdAt: -1 })
      .limit(100);
    
    // Calculate comprehensive stats
    const stats = await calculateSuperAdminStats(period, type);
    
    ResponseHandler.success(res, {
      transactions,
      stats
    }, 'All earnings overview fetched successfully');
  } catch (error) {
    logger.error(`Get all earnings overview error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Payment Details (Updated)
exports.getPaymentDetails = async (req, res) => {
  try {
    const { id } = req.params;
    
    const payment = await Payment.findById(id)
      .populate('user', 'name phone email')
      .populate('provider', 'name phone email bankDetails')
      .populate('shop', 'name phone email bankDetails')
      .populate('booking', 'bookingId serviceDetails scheduledDate scheduledTime')
      .populate('order', 'orderId items pricing');
    
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
    
    // Format response
    const response = {
      id: payment._id,
      transactionId: payment.transactionId,
      amount: payment.amount,
      status: payment.status,
      paymentMethod: payment.paymentMethod,
      paymentDestination: payment.paymentDestination,
      paymentType: payment.paymentType,
      createdAt: payment.createdAt,
      paymentDate: payment.paymentDate,
      verified: payment.verified,
      
      // Commission details
      commission: {
        total: payment.totalCommission,
        companyCommission: payment.commission.companyCommission,
        pendingCommission: payment.commission.pendingCommission,
        providerEarning: payment.commission.providerEarning,
        shopEarning: payment.commission.shopEarning,
        netEarning: payment.netEarning,
        rates: {
          commissionRate: payment.commission.commissionRate,
          pendingCommissionRate: payment.commission.pendingCommissionRate,
          shopCommissionRate: payment.commission.shopCommissionRate,
          shopPendingCommissionRate: payment.commission.shopPendingCommissionRate
        }
      },
      
      // Pending commission details (if applicable)
      pendingCommission: payment.pendingCommission ? {
        amount: payment.pendingCommission.amount,
        status: payment.pendingCommission.status,
        dueDate: payment.pendingCommission.dueDate,
        paidDate: payment.pendingCommission.paidDate,
        remindersSent: payment.pendingCommission.remindersSent
      } : null,
      
      // Payout details (if applicable)
      payout: payment.payout ? {
        status: payment.payout.status,
        payoutDate: payment.payout.payoutDate,
        payoutMethod: payment.payout.payoutMethod,
        transactionId: payment.payout.transactionId
      } : null,
      
      // QR details
      qrPayment: payment.qrPayment ? {
        upiId: payment.qrPayment.upiId,
        expiresAt: payment.qrPayment.expiresAt,
        status: payment.qrPayment.status,
        isExpired: payment.isQRExpired()
      } : null,
      
      // Related entities
      user: payment.user,
      provider: payment.provider,
      shop: payment.shop,
      booking: payment.booking,
      order: payment.order
    };
    
    ResponseHandler.success(res, { payment: response }, 'Payment details fetched successfully');
  } catch (error) {
    logger.error(`Get payment details error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Initiate Refund (Updated)
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
    
    // Check if payment is to company account (needs commission reversal)
    if (payment.paymentDestination === 'company_account') {
      // Need to reverse commission and any payouts made
      // This is complex and would need integration with payout reversal API
      logger.warn(`Refund requested for company account payment: ${id}, commission reversal required`);
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
    payment.refund = {
      amount: payment.amount,
      date: new Date(),
      reason: reason,
      gatewayRefundId: refund.refund.id,
      status: 'processed'
    };
    
    // If commission was paid, mark it as reversed
    if (payment.paymentDestination === 'personal_account' && payment.pendingCommission.status === 'paid') {
      payment.pendingCommission.status = 'reversed';
      payment.metadata = payment.metadata || {};
      payment.metadata.commissionReversal = {
        refundId: refund.refund.id,
        reversedAt: new Date(),
        reason: `Refund of payment: ${reason}`
      };
    }
    
    await payment.save();
    
    ResponseHandler.success(res, { payment }, 'Refund initiated successfully');
  } catch (error) {
    logger.error(`Refund error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Cash Payment (Updated)
exports.cashPayment = async (req, res) => {
  try {
    const { bookingId, paymentDestination = 'company_account' } = req.body;
    
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
      paymentDestination,
      paymentType: 'service',
      status: 'pending'
    });
    
    // Calculate commission
    await payment.calculateCommission();
    
    booking.payment = payment._id;
    booking.status = 'confirmed';
    await booking.save();
    
    ResponseHandler.success(res, { 
      payment,
      booking,
      commission: {
        amount: payment.totalCommission,
        netEarning: payment.netEarning
      }
    }, 'Booking confirmed with cash payment');
  } catch (error) {
    logger.error(`Cash payment error: ${error.message}`);
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
    case 'quarter':
      startDate = new Date(now.setMonth(now.getMonth() - 3));
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
  
  // Calculate commission paid (for personal account payments)
  const personalAccountPayments = successPayments.filter(p => p.paymentDestination === 'personal_account');
  const commissionPaid = personalAccountPayments.reduce((sum, p) => sum + (p.commission.pendingCommission || 0), 0);
  
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
    commissionPaid,
    thisMonth,
    totalTransactions: successPayments.length
  };
}

async function calculateShopStats(shopId, period) {
  const dateFilter = getDateFilter(period);
  const query = { shop: shopId, ...dateFilter };
  
  const allPayments = await Payment.find(query);
  const successPayments = allPayments.filter(p => p.status === 'success');
  
  const totalEarnings = successPayments.reduce((sum, p) => sum + p.amount, 0);
  const netEarnings = successPayments.reduce((sum, p) => sum + p.netEarning, 0);
  
  // This month
  const thisMonthFilter = getDateFilter('month');
  const thisMonthPayments = await Payment.find({
    shop: shopId,
    status: 'success',
    ...thisMonthFilter
  });
  const thisMonth = thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
  const thisMonthNet = thisMonthPayments.reduce((sum, p) => sum + p.netEarning, 0);
  
  // Commission stats
  const companyAccountPayments = successPayments.filter(p => p.paymentDestination === 'company_account');
  const personalAccountPayments = successPayments.filter(p => p.paymentDestination === 'personal_account');
  
  const totalCommission = companyAccountPayments.reduce((sum, p) => sum + (p.commission.companyCommission || 0), 0) +
                         personalAccountPayments.reduce((sum, p) => sum + (p.commission.pendingCommission || 0), 0);
  
  const pendingCommissions = personalAccountPayments.filter(p => p.pendingCommission?.status === 'pending');
  const totalPendingCommission = pendingCommissions.reduce((sum, p) => sum + (p.commission.pendingCommission || 0), 0);
  
  const paidCommissions = personalAccountPayments.filter(p => p.pendingCommission?.status === 'paid');
  const totalPaidCommission = paidCommissions.reduce((sum, p) => sum + (p.commission.pendingCommission || 0), 0);
  
  return {
    totalEarnings,
    netEarnings,
    totalCommission,
    totalPendingCommission,
    totalPaidCommission,
    thisMonth,
    thisMonthNet,
    pendingCommissionCount: pendingCommissions.length,
    paidCommissionCount: paidCommissions.length,
    companyAccountTransactions: companyAccountPayments.length,
    personalAccountTransactions: personalAccountPayments.length,
    totalTransactions: successPayments.length
  };
}

async function calculateProviderStats(providerId, period) {
  const dateFilter = getDateFilter(period);
  const query = { provider: providerId, ...dateFilter };
  
  const allPayments = await Payment.find(query);
  const successPayments = allPayments.filter(p => p.status === 'success');
  
  const totalEarnings = successPayments.reduce((sum, p) => sum + p.amount, 0);
  const netEarnings = successPayments.reduce((sum, p) => sum + p.netEarning, 0);
  
  // This month
  const thisMonthFilter = getDateFilter('month');
  const thisMonthPayments = await Payment.find({
    provider: providerId,
    status: 'success',
    ...thisMonthFilter
  });
  const thisMonth = thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
  const thisMonthNet = thisMonthPayments.reduce((sum, p) => sum + p.netEarning, 0);
  
  const totalBookings = successPayments.length;
  
  // Commission stats
  const companyAccountPayments = successPayments.filter(p => p.paymentDestination === 'company_account');
  const personalAccountPayments = successPayments.filter(p => p.paymentDestination === 'personal_account');
  
  const totalCommission = companyAccountPayments.reduce((sum, p) => sum + (p.commission.companyCommission || 0), 0) +
                         personalAccountPayments.reduce((sum, p) => sum + (p.commission.pendingCommission || 0), 0);
  
  const pendingCommissions = personalAccountPayments.filter(p => p.pendingCommission?.status === 'pending');
  const totalPendingCommission = pendingCommissions.reduce((sum, p) => sum + (p.commission.pendingCommission || 0), 0);
  
  const paidCommissions = personalAccountPayments.filter(p => p.pendingCommission?.status === 'paid');
  const totalPaidCommission = paidCommissions.reduce((sum, p) => sum + (p.commission.pendingCommission || 0), 0);
  
  return {
    totalEarnings,
    netEarnings,
    totalCommission,
    totalPendingCommission,
    totalPaidCommission,
    thisMonth,
    thisMonthNet,
    totalBookings,
    pendingCommissionCount: pendingCommissions.length,
    paidCommissionCount: paidCommissions.length,
    companyAccountTransactions: companyAccountPayments.length,
    personalAccountTransactions: personalAccountPayments.length
  };
}

async function calculateSuperAdminStats(period, type = 'all') {
  const dateFilter = getDateFilter(period);
  let query = { ...dateFilter };
  
  if (type === 'shop') {
    query.shop = { $ne: null };
  } else if (type === 'provider') {
    query.provider = { $ne: null };
  }
  
  const allPayments = await Payment.find(query);
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
    .filter(p => p.pendingCommission?.status === 'pending')
    .reduce((sum, p) => sum + (p.commission.pendingCommission || 0), 0);
  
  const paidCommission = personalAccountPayments
    .filter(p => p.pendingCommission?.status === 'paid')
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
    paidCommission,
    averageTransactionValue: totalRevenue / (successfulTransactions || 1),
    companyAccountTransactions: companyAccountPayments.length,
    personalAccountTransactions: personalAccountPayments.length,
    collectionRate: totalCommission > 0 ? ((totalCommission - pendingCommission) / totalCommission) * 100 : 0
  };
}

module.exports = exports;