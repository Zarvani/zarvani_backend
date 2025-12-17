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

    // -------------------------------
    // 1️⃣ Validate Payment Destination
    // -------------------------------
    if (!['company_account', 'personal_account'].includes(paymentDestination)) {
      return ResponseHandler.error(res, 'Invalid payment destination', 400);
    }

    // -------------------------------
    // 2️⃣ Validate Amount
    // -------------------------------
    if (!amount || amount <= 0) {
      return ResponseHandler.error(res, 'Valid amount is required', 400);
    }

    // ------------------------------------------------
    // 3️⃣ Validate Exactly ONE of bookingId or orderId
    // ------------------------------------------------
    if ((bookingId && orderId) || (!bookingId && !orderId)) {
      return ResponseHandler.error(
        res,
        'Send ONLY bookingId (for service) OR ONLY orderId (for shop)',
        400
      );
    }

    // Determine payment type
    const paymentType = bookingId ? 'service' : 'product';

    // -------------------------------
    // 4️⃣ Generate QR Payment
    // -------------------------------
    const result = await QRPaymentService.generatePaymentQR({
      bookingId,
      orderId,
      amount,
      userId: req.user._id,
      paymentDestination,
      providerId,
      shopId,
      paymentType
    });

    // -------------------------------
    // 5️⃣ Commission Logic
    // -------------------------------
    const commissionRate = (() => {
      if (paymentDestination === 'company_account') {
        return paymentType === 'service' ? 15 : 8;
      } else {
        return paymentType === 'service' ? 20 : 12;
      }
    })();

    ResponseHandler.success(res, {
      paymentId: result.payment._id,
      transactionId: result.payment.transactionId,

      qrCode: result.qrData.qrImageUrl,
      upiDeepLink: result.qrData.upiDeepLink,
      upiId: result.qrData.upiId,
      amount: result.qrData.amount,
      expiresAt: result.qrData.expiresAt,

      paymentDestination,
      paymentType,

      commission: {
        rate: commissionRate,
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
    const {
      bookingId,
      orderId,
      amount,
      paymentDestination = "company_account"
    } = req.body;

    // Validate input
    if (!bookingId && !orderId) {
      return ResponseHandler.error(res, "bookingId or orderId is required", 400);
    }

    let refDoc = null;
    let paymentType = null;
    let providerId = null;
    let userId = null;

    // -------------------------
    // 1️⃣ BOOKING PAYMENT FLOW
    // -------------------------
    if (bookingId) {
      refDoc = await Booking.findById(bookingId);
      if (!refDoc) return ResponseHandler.error(res, "Booking not found", 404);

      if (refDoc.user.toString() !== req.user._id.toString()) {
        return ResponseHandler.error(res, "Not authorized", 403);
      }

      paymentType = "service"; // booking = service payment
      providerId = refDoc.provider;
      userId = refDoc.user;
    }

    // -------------------------
    // 2️⃣ ORDER PAYMENT FLOW
    // -------------------------
    if (orderId) {
      refDoc = await Order.findById(orderId);
      if (!refDoc) return ResponseHandler.error(res, "Order not found", 404);

      if (refDoc.user.toString() !== req.user._id.toString()) {
        return ResponseHandler.error(res, "Not authorized", 403);
      }

      paymentType = "product_order"; // product purchase
      providerId = null; // orders may not have provider
      userId = refDoc.user;
    }

    // Create Razorpay Order
    const receipt = `RCPT-${Date.now()}`;
    const order = await PaymentService.createRazorpayOrder(amount, "INR", receipt);

    if (!order.success) {
      return ResponseHandler.error(res, "Failed to create order", 500);
    }

    // Create Payment record
    const payment = await Payment.create({
      transactionId: order.order.id,
      booking: bookingId || null,
      order: orderId || null,
      user: userId,
      provider: providerId,
      amount,
      paymentMethod: "upi",
      paymentGateway: "razorpay",
      paymentDestination,
      paymentType, // service / product_order
      status: "pending"
    });

    // Calculate commission
    await payment.calculateCommission();
    await payment.save();

    ResponseHandler.success(
      res,
      {
        orderId: order.order.id,
        amount: order.order.amount,
        currency: order.order.currency,
        paymentId: payment._id,
        paymentDestination,
        commission: {
          rate: payment.paymentDestination === "company_account" ? 15 : 20,
          amount: payment.totalCommission
        }
      },
      "Order created successfully"
    );
  } catch (error) {
    logger.error(`Create order error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

exports.verifyPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      bookingId,
      orderId,
      paymentMethod = 'online'
    } = req.body;

    // 1️⃣ Validate required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      await session.abortTransaction();
      return ResponseHandler.error(res, "Missing Razorpay details", 400);
    }

    if (!bookingId && !orderId) {
      await session.abortTransaction();
      return ResponseHandler.error(res, "Send bookingId OR orderId", 400);
    }

    // 2️⃣ Verify signature
    const isValid = PaymentService.verifyRazorpaySignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      await session.abortTransaction();
      return ResponseHandler.error(res, "Invalid payment signature", 400);
    }

    // 3️⃣ Check if payment already exists
    let payment = await Payment.findOne({
      $or: [
        { transactionId: razorpay_order_id },
        { gatewayTransactionId: razorpay_payment_id }
      ]
    }).session(session);

    let entity = null;
    let entityType = null;
    let updatedEntity = null;

    // 4️⃣ Process based on entity type (Booking or Order)
    if (bookingId) {
      entity = await Booking.findById(bookingId).session(session);
      entityType = 'booking';
      
      if (!entity) {
        await session.abortTransaction();
        return ResponseHandler.error(res, "Booking not found", 404);
      }

      // Verify user authorization
      if (entity.user.toString() !== req.user._id.toString()) {
        await session.abortTransaction();
        return ResponseHandler.error(res, "Not authorized for this booking", 403);
      }
    } else if (orderId) {
      entity = await Order.findById(orderId).session(session);
      entityType = 'order';
      
      if (!entity) {
        await session.abortTransaction();
        return ResponseHandler.error(res, "Order not found", 404);
      }

      // Verify user authorization
      if (entity.user.toString() !== req.user._id.toString()) {
        await session.abortTransaction();
        return ResponseHandler.error(res, "Not authorized for this order", 403);
      }
    }

    // 5️⃣ Check if payment is already marked as paid in the entity
    if (entity.payment && entity.payment.status === 'paid') {
      await session.abortTransaction();
      return ResponseHandler.success(res, {
        message: 'Payment already completed',
        entityType,
        entityId: entity._id,
        entityStatus: entity.status
      }, 'Payment already marked as paid');
    }

    // 6️⃣ Create or update payment record
    if (payment) {
      // Update existing payment
      payment.status = 'success';
      payment.paymentDate = new Date();
      payment.verified = true;
      payment.gatewayTransactionId = razorpay_payment_id;
      payment.paymentMethod = paymentMethod;
      
      // Link entity if not already linked
      if (entityType === 'booking' && !payment.booking) {
        payment.booking = bookingId;
        payment.provider = entity.provider;
        payment.paymentType = 'service';
      } else if (entityType === 'order' && !payment.order) {
        payment.order = orderId;
        payment.shop = entity.shop;
        payment.paymentType = 'product_order';
      }
      
      await payment.save({ session });
    } else {
      // Create new payment record
      const paymentData = {
        transactionId: razorpay_order_id,
        user: req.user._id,
        amount: entityType === 'booking' ? entity.totalAmount : entity.pricing.totalAmount,
        paymentMethod: paymentMethod,
        paymentGateway: 'razorpay',
        paymentDestination: 'company_account',
        status: 'success',
        gatewayTransactionId: razorpay_payment_id,
        paymentDate: new Date(),
        verified: true,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        createdBy: req.user._id
      };

      if (entityType === 'booking') {
        paymentData.booking = bookingId;
        paymentData.provider = entity.provider;
        paymentData.paymentType = 'service';
      } else {
        paymentData.order = orderId;
        paymentData.shop = entity.shop;
        paymentData.paymentType = 'product_order';
      }

      payment = new Payment(paymentData);
      await payment.save({ session });
    }

    // 7️⃣ Calculate commission
    await payment.calculateCommission();
    await payment.save({ session });

    // 8️⃣ ✅ CRITICAL: Update ONLY payment status and method in entity
    // DO NOT change the main entity status (confirmed, ready, out_for_delivery, etc.)
    
    if (entityType === 'booking') {
      // Update only payment info in booking
      entity.payment = {
        ...entity.payment, // Keep existing payment properties
        method: paymentMethod,
        status: 'paid',
        transactionId: razorpay_payment_id,
        gateway: 'razorpay',
        paidAt: new Date(),
        _id: payment._id
      };
      
      // ✅ Do NOT change booking.status unless it's specifically needed
      // Only mark payment as paid, keep booking status as is
      
      // Add payment reference if not present
      if (!entity.paymentReference) {
        entity.paymentReference = payment._id;
      }
      
      await entity.save({ session });
      updatedEntity = entity;
      
    } else if (entityType === 'order') {
      // Update only payment info in order
      entity.payment = {
        ...entity.payment, // Keep existing payment properties
        method: paymentMethod,
        status: 'paid',
        transactionId: razorpay_payment_id,
        gateway: 'razorpay',
        paidAt: new Date(),
        _id: payment._id
      };
      
      // ✅ Do NOT change order.status unless specifically needed
      // Payment can happen at various stages (confirmed, preparing, ready, etc.)
      
      // For COD orders being converted to online, update payment method only
      // Status remains as whatever it was (confirmed, preparing, etc.)
      
      await entity.save({ session });
      updatedEntity = entity;
    }

    // 9️⃣ Handle commission based on payment destination
    if (payment.paymentDestination === 'company_account') {
      await payment.initiatePayout();
    } else {
      await payment.recordPendingCommission();
    }

    // 🔟 Commit transaction
    await session.commitTransaction();

    // 1️⃣1️⃣ Send notifications
    try {
      const amount = entityType === 'booking' ? entity.totalAmount : entity.pricing.totalAmount;
      const entityId = entityType === 'booking' ? entity.bookingId : entity.orderId;
      
      // Send push notification to user
      await PushNotificationService.sendToUser(
        req.user._id,
        "Payment Successful",
        `Your payment of ₹${amount} for ${entityType} #${entityId} was successful.`
      );

      // Notify provider/shop about payment
      if (entityType === 'booking' && entity.provider) {
        await PushNotificationService.sendToProvider(
          entity.provider,
          "Payment Received",
          `Payment of ₹${amount} received for booking #${entity.bookingId}.`
        );
      } else if (entityType === 'order' && entity.shop) {
        await PushNotificationService.sendToShop(
          entity.shop,
          "Payment Received",
          `Payment of ₹${amount} received for order #${entity.orderId}.`
        );
      }
    } catch (notifError) {
      logger.error(`Notification failed: ${notifError.message}`);
      // Don't fail the transaction for notification errors
    }

    // 1️⃣2️⃣ Prepare response
    const response = {
      success: true,
      message: 'Payment verified successfully',
      payment: {
        id: payment._id,
        transactionId: payment.transactionId,
        amount: payment.amount,
        status: payment.status,
        paymentMethod: payment.paymentMethod,
        paymentDestination: payment.paymentDestination,
        commission: payment.totalCommission
      },
      entity: {
        type: entityType,
        id: entity._id,
        entityId: entityType === 'booking' ? entity.bookingId : entity.orderId,
        // Return current status (unchanged)
        status: entity.status,
        // Return updated payment info
        payment: {
          method: entity.payment.method,
          status: entity.payment.status,
          paidAt: entity.payment.paidAt
        }
      }
    };

    ResponseHandler.success(res, response, 'Payment verified successfully');

  } catch (error) {
    await session.abortTransaction();
    logger.error(`Verify payment error: ${error.message}`, { 
      stack: error.stack,
      userId: req.user?._id,
      Booking,
      Order
    });
    ResponseHandler.error(res, error.message, 500);
  } finally {
    session.endSession();
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
// ==================== PAY COMMISSION (PROVIDER/SHOP PAYS COMMISSION) ====================
// ✅ Pay commission (provider/shop pays commission)
exports.payCommission = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const { paymentMethod, transactionId, screenshotUrl } = req.body;
        
        const user = req.user;
        const isProvider = user.role === 'provider';
        const isShop = user.role === 'shop';
        
        if (!isProvider && !isShop) {
            return ResponseHandler.error(res, 'Only providers or shops can pay commission', 403);
        }
        
        const payment = await Payment.findOne({
            _id: paymentId,
            ...(isProvider && { provider: user._id }),
            ...(isShop && { shop: user._id }),
            paymentDestination: 'personal_account'
        });
        
        if (!payment) {
            return ResponseHandler.error(res, 'Commission record not found', 404);
        }
        
        const updatedPayment = await CommissionService.markCommissionPaid(paymentId, {
            paymentMethod,
            transactionId,
            screenshotUrl
        });
        
        // Update Booking/Order commission status
        if (updatedPayment.booking) {
            await Booking.findByIdAndUpdate(updatedPayment.booking, {
                'payment.commissionStatus': 'paid',
                'payment.commissionPaidAt': new Date()
            });
        }
        
        if (updatedPayment.order) {
            await Order.findByIdAndUpdate(updatedPayment.order, {
                'payment.commissionStatus': 'paid',
                'payment.commissionPaidAt': new Date()
            });
        }
        
        ResponseHandler.success(res, { 
            payment: updatedPayment,
            message: 'Commission paid successfully'
        }, 'Commission paid');
        
    } catch (error) {
        logger.error(`Pay commission error: ${error.message}`);
        ResponseHandler.error(res, error.message, 500);
    }
};

// ✅ Get commission dashboard for provider/shop
exports.getCommissionDashboard = async (req, res) => {
    try {
        const user = req.user;
        const isProvider = user.role === 'provider';
        const isShop = user.role === 'shop';
        
        if (!isProvider && !isShop) {
            return ResponseHandler.error(res, 'Only providers or shops can view commission dashboard', 403);
        }
        
        const ownerId = user._id;
        const ownerType = isProvider ? 'provider' : 'shop';
        
        const summary = await CommissionService.getCommissionSummary(ownerId, ownerType);
        
        // Get owner model for total earnings
        let owner;
        if (isProvider) {
            owner = await ServiceProvider.findById(ownerId);
        } else {
            owner = await Shop.findById(ownerId);
        }
        
        ResponseHandler.success(res, {
            dashboard: {
                commissionRate: isProvider ? '20%' : '12%',
                ownerType,
                ownerId: ownerId,
                updatedAt: new Date()
            },
            summary,
            earnings: {
                total: owner.earnings.total,
                commission: {
                    due: owner.commission.due,
                    paid: owner.commission.paid,
                    lastPaymentDate: owner.commission.lastPaymentDate
                }
            },
            pendingCount: summary.pendingCommissions.length,
            paidCount: summary.paidCommissions.length
        }, 'Commission dashboard fetched');
        
    } catch (error) {
        logger.error(`Get commission dashboard error: ${error.message}`);
        ResponseHandler.error(res, error.message, 500);
    }
};
// ==================== GET MY PENDING COMMISSIONS ====================
exports.getMyPendingCommissions = async (req, res) => {
  try {
    const user = req.user;
    const isProvider = user.role === 'provider';
    const isShop = user.role === 'shop';
    
    if (!isProvider && !isShop) {
      return ResponseHandler.error(res, 'Only providers or shops can view commissions', 403);
    }
    
    const query = {
      paymentDestination: 'personal_account',
      'pendingCommission.status': 'pending',
      ...(isProvider && { provider: user._id }),
      ...(isShop && { shop: user._id })
    };
    
    const pendingCommissions = await Payment.find(query)
      .populate('booking', 'bookingId serviceDetails totalAmount')
      .populate('order', 'orderId items pricing.totalAmount')
      .populate('user', 'name phone')
      .sort({ 'pendingCommission.dueDate': 1 });
    
    // Calculate totals
    const totalDue = pendingCommissions.reduce((sum, p) => sum + p.commission.pendingCommission, 0);
    
    ResponseHandler.success(
      res,
      {
        pendingCommissions: pendingCommissions.map(p => ({
          _id: p._id,
          transactionId: p.transactionId,
          amount: p.amount,
          commission: p.commission.pendingCommission,
          dueDate: p.pendingCommission.dueDate,
          daysRemaining: Math.ceil((p.pendingCommission.dueDate - new Date()) / (1000 * 60 * 60 * 24)),
          ...(p.booking && { 
            type: 'service',
            bookingId: p.booking.bookingId,
            service: p.booking.serviceDetails?.title,
            customer: p.user?.name 
          }),
          ...(p.order && { 
            type: 'product',
            orderId: p.order.orderId,
            customer: p.user?.name 
          })
        })),
        summary: {
          totalDue,
          count: pendingCommissions.length,
          commissionRate: isProvider ? '20%' : '12%'
        }
      },
      'Pending commissions fetched'
    );
    
  } catch (error) {
    logger.error(`Get pending commissions error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
exports.getCommissionStats = async (req, res) => {
  try {
    const { period = 'month' } = req.query;

    const stats = await CommissionService.getCommissionStats(period);

    return ResponseHandler.success(
      res,
      stats,
      'Commission stats fetched'
    );
  } catch (error) {
    return ResponseHandler.error(res, error.message, 500);
  }
};

exports.getAllPendingCommissions = async (req, res) => {
  try {
    const pendingCommissions = await Payment.find({
      paymentDestination: 'personal_account',
      'pendingCommission.status': { $in: ['pending', 'overdue'] }
    })
      .populate('provider', 'name phone email')
      .populate('shop', 'name phone email')
      .populate('user', 'name phone')
      .populate('booking', 'bookingId serviceDetails')
      .populate('order', 'orderId items')
      .sort({ 'pendingCommission.dueDate': 1 });

    return ResponseHandler.success(
      res,
      { pendingCommissions },
      'Pending commissions fetched'
    );
  } catch (error) {
    return ResponseHandler.error(res, error.message, 500);
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
const ORDER_PAYMENT_METHODS = ["cod", "online", "wallet"];
const DEFAULT_PAYMENT_METHOD = "online";

exports.updatePaymentStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { entityId } = req.params;
    const { paymentId, paymentStatus = "paid" } = req.body;

    if (!entityId || !paymentId) {
      await session.abortTransaction();
      return ResponseHandler.error(res, "Missing entityId or paymentId", 400);
    }

    if (paymentStatus !== "paid") {
      await session.abortTransaction();
      return ResponseHandler.error(res, "Invalid payment status", 400);
    }

    // 🔴 CRITICAL FIX: First check if payment already exists with this transactionId
    const existingPayment = await Payment.findOne({
      $or: [
        { transactionId: paymentId },
        { gatewayTransactionId: paymentId }
      ]
    }).session(session);

    // If payment already exists and is successful, abort
    if (existingPayment && existingPayment.status === "success") {
      await session.abortTransaction();
      
      // Still update the entity to link the payment if not already linked
      let entity = await Order.findById(entityId).session(session);
      let entityType = "order";
      
      if (!entity) {
        entity = await Booking.findById(entityId).session(session);
        entityType = "booking";
      }
      
      if (entity && (!entity.payment?._id || entity.payment._id.toString() !== existingPayment._id.toString())) {
        entity.payment = {
          ...entity.payment,
          _id: existingPayment._id,
          method: existingPayment.paymentMethod,
          status: "paid",
          transactionId: existingPayment.transactionId,
          gateway: existingPayment.paymentGateway,
          paidAt: existingPayment.paymentDate || new Date(),
        };
        
        if (entityType === "order" && entity.status === "pending") {
          entity.status = "confirmed";
          entity.timestamps = entity.timestamps || {};
          entity.timestamps.confirmedAt = new Date();
          entity._updatedBy = "system";
        }
        
        await entity.save({ session });
        await session.commitTransaction();
      } else {
        await session.abortTransaction();
      }
      
      return ResponseHandler.success(
        res,
        { 
          success: true, 
          message: "Payment already completed",
          paymentId: existingPayment._id 
        },
        "Payment already completed"
      );
    }

    // Detect entity: Order or Booking
    let entity = await Order.findById(entityId).session(session);
    let entityType = "order";

    if (!entity) {
      entity = await Booking.findById(entityId).session(session);
      entityType = "booking";
    }

    if (!entity) {
      await session.abortTransaction();
      return ResponseHandler.error(res, "Entity not found", 404);
    }

    // Determine payment method
    let paymentMethod = entity.payment?.method || DEFAULT_PAYMENT_METHOD;

    // Map unsupported methods to 'online' for order/booking
    if (!ORDER_PAYMENT_METHODS.includes(paymentMethod)) {
      paymentMethod = DEFAULT_PAYMENT_METHOD;
    }

    const gateway = "razorpay";

    // Update embedded payment object in entity
    entity.payment = {
      ...entity.payment,
      method: paymentMethod,
      status: "paid",
      transactionId: paymentId,
      gateway,
      paidAt: new Date(),
    };

    // Auto-confirm order if applicable
    if (entityType === "order" && paymentMethod !== "cod" && entity.status === "pending") {
      entity.status = "confirmed";
      entity.timestamps = entity.timestamps || {};
      entity.timestamps.confirmedAt = new Date();
      entity._updatedBy = "system";
    }

    // 🔴 CRITICAL FIX 2: Update existing payment if found (partial record)
    let paymentRecord;
    if (existingPayment) {
      // Update existing payment (partial record created by createOrder)
      existingPayment.status = "success";
      existingPayment.paymentDate = new Date();
      existingPayment.verified = true;
      existingPayment.gatewayTransactionId = paymentId;
      
      // Link entity if not already linked
      if (entityType === "order" && !existingPayment.order) {
        existingPayment.order = entity._id;
        existingPayment.shop = entity.shop;
      } else if (entityType === "booking" && !existingPayment.booking) {
        existingPayment.booking = entity._id;
        existingPayment.provider = entity.provider;
      }
      
      // Update commission if needed
      await existingPayment.calculateCommission();
      
      paymentRecord = existingPayment;
      await paymentRecord.save({ session });
    } else {
      // Create new payment record (only if doesn't exist anywhere)
      const paymentRecordData = {
        user: entity.user,
        amount: entityType === "order" ? entity.pricing.totalAmount : entity.totalAmount,
        transactionId: paymentId,
        paymentMethod,
        paymentGateway: gateway,
        paymentDestination: "company_account",
        paymentType: entityType === "order" ? "product_order" : "service",
        status: "success",
        paymentDate: new Date(),
        verified: true,
      };

      if (entityType === "order") {
        paymentRecordData.order = entity._id;
        paymentRecordData.shop = entity.shop;
      } else {
        paymentRecordData.booking = entity._id;
        paymentRecordData.provider = entity.provider;
      }

      paymentRecord = new Payment(paymentRecordData);
      await paymentRecord.save({ session });
    }

    // Link the payment ID to the entity
    entity.payment._id = paymentRecord._id;
    
    await entity.save({ session });
    await session.commitTransaction();

    // Send notification
    try {
      const amount = entityType === "order" ? entity.pricing.totalAmount : entity.totalAmount;
      const id = entityType === "order" ? entity.orderId : entity.bookingId;

      await PushNotificationService.sendToUser(
        entity.user,
        "Payment Successful",
        `Payment of ₹${amount} for ${entityType} #${id} was successful.`
      );
    } catch (err) {
      console.error("Push notification failed:", err.message);
    }

    // Return response
    return ResponseHandler.success(
      res,
      {
        success: true,
        entityType,
        entityId: entity._id,
        paymentId: paymentRecord._id,
        paymentStatus: paymentRecord.status,
        paymentMethod: paymentRecord.paymentMethod,
        transactionId: paymentRecord.transactionId,
      },
      "Payment updated successfully"
    );
  } catch (err) {
    await session.abortTransaction();
    console.error("Payment update failed:", err);
    return ResponseHandler.error(res, err.message || "Internal Server Error", 500);
  } finally {
    session.endSession();
  }
};

exports.checkPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    const payment = await Payment.findOne({ 
      $or: [
        { transactionId: paymentId },
        { 'upiPayment.transactionId': paymentId },
        { gatewayTransactionId: paymentId }
      ]
    })
    .populate('order', 'orderId status payment')
    .populate('booking', 'bookingId status payment');

    if (!payment) {
      return ResponseHandler.error(res, 'Payment not found', 404);
    }

    ResponseHandler.success(res, { payment }, 'Payment details retrieved');
    
  } catch (error) {
    logger.error(`Check payment error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

exports.paymentWebhook = async (req, res) => {
  try {
    const { event, payload } = req.body;

    if (event === 'payment.captured' && payload.payment?.entity) {
      const paymentEntity = payload.payment.entity;
      
      // Check if payment already exists with either transactionId or gatewayTransactionId
      const existingPayment = await Payment.findOne({
        $or: [
          { gatewayTransactionId: paymentEntity.id },
          { transactionId: paymentEntity.order_id }
        ]
      });

      if (existingPayment) {
        // Payment already exists, just update it
        if (existingPayment.status !== 'success') {
          existingPayment.status = 'success';
          existingPayment.paymentDate = new Date();
          existingPayment.gatewayTransactionId = paymentEntity.id;
          await existingPayment.save();
        }
        
        // Update linked entity (booking/order) if not already updated
        if (existingPayment.booking) {
          const booking = await Booking.findById(existingPayment.booking);
          if (booking && booking.payment?.status !== 'paid') {
            await Booking.findByIdAndUpdate(existingPayment.booking, {
              'payment.status': 'paid',
              'payment.paidAt': new Date(),
              status: 'confirmed'
            });
          }
        }
        if (existingPayment.order) {
          const order = await Order.findById(existingPayment.order);
          if (order && order.payment?.status !== 'paid') {
            await Order.findByIdAndUpdate(existingPayment.order, {
              'payment.status': 'paid',
              'payment.paidAt': new Date(),
              status: 'confirmed'
            });
          }
        }
      }
      // If no existing payment, DO NOT CREATE ONE here
      // Wait for updatePaymentStatus to be called
    }

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error(`Payment webhook error: ${error.message}`);
    res.status(200).json({ success: false }); // Always return 200 to webhook
  }
};
exports.processAutoPayout = async (payment, session) => {
  try {
    const isServicePayment = payment.paymentType === 'service';
    const isProductPayment = payment.paymentType === 'product_order';
    
    let owner = null;
    let ownerModel = null;
    let commissionRate = 0;
    let payoutAmount = 0;
    let commissionAmount = 0;
    
    // Get owner and calculate commission
    if (isServicePayment && payment.provider) {
      owner = await ServiceProvider.findById(payment.provider).session(session);
      ownerModel = 'ServiceProvider';
      commissionRate = 15; // 15% for services (company account)
      commissionAmount = payment.amount * (commissionRate / 100);
      payoutAmount = payment.amount - commissionAmount;
      
    } else if (isProductPayment && payment.shop) {
      owner = await Shop.findById(payment.shop).session(session);
      ownerModel = 'Shop';
      commissionRate = 8; // 8% for products (company account)
      commissionAmount = payment.amount * (commissionRate / 100);
      payoutAmount = payment.amount - commissionAmount;
    }
    
    if (!owner) {
      logger.warn(`No owner found for auto-payout: ${payment._id}`);
      return;
    }
    
    // ✅ UPDATE OWNER EARNINGS (Immediate)
    owner.earnings.total = (owner.earnings.total || 0) + payoutAmount;
    owner.earnings.lastUpdated = new Date();
    
    // Update commission tracking
    owner.commission = owner.commission || {};
    owner.commission.paid = (owner.commission.paid || 0) + commissionAmount;
    owner.commission.lastPaymentDate = new Date();
    
    await owner.save({ session });
    
    // ✅ INITIATE AUTO-PAYOUT (Actual money transfer)
    const payoutResult = await this.initiatePayoutToOwner(owner, payoutAmount, payment, session);
    
    // Update payment with payout details
    payment.autoPayout = {
      status: payoutResult.success ? 'completed' : 'failed',
      payoutDate: new Date(),
      payoutMethod: payoutResult.method,
      payoutTo: payoutResult.to,
      ...(payoutResult.transactionId && { payoutId: payoutResult.transactionId })
    };
    
    payment.payoutDetails = {
      ...(isServicePayment && { providerAmount: payoutAmount }),
      ...(isProductPayment && { shopAmount: payoutAmount }),
      companyCommission: commissionAmount,
      sentAt: new Date(),
      transactionId: payoutResult.transactionId
    };
    
    payment.commission = {
      companyCommission: commissionAmount,
      commissionRate: commissionRate,
      ...(isServicePayment && { providerEarning: payoutAmount }),
      ...(isProductPayment && { shopEarning: payoutAmount }),
      calculatedAt: new Date()
    };
    
    await payment.save({ session });
    
    // Send notification to owner
    if (payoutResult.success) {
      const notificationMessage = `₹${payoutAmount} has been credited to your account for ${isServicePayment ? 'service' : 'order'}. Commission: ₹${commissionAmount}`;
      
      await PushNotificationService.sendToUser(
        owner._id,
        'Payment Received 💰',
        notificationMessage
      );
    }
    
    logger.info(`Auto-payout processed: ${payment._id}, Amount: ${payoutAmount}, Commission: ${commissionAmount}`);
    
  } catch (error) {
    logger.error(`Auto-payout error: ${error.message}`);
    throw error;
  }
};

// ==================== INITIATE PAYOUT TO OWNER ====================
exports.initiatePayoutToOwner = async (owner, amount, payment, session) => {
  try {
    // Get owner's payout method (UPI or bank)
    const payoutMethod = owner.bankDetails?.upiId ? 'upi' : 
                        owner.bankDetails?.accountNumber ? 'bank_transfer' : 'wallet';
    
    const payoutTo = owner.bankDetails?.upiId || 
                    owner.bankDetails?.accountNumber || 
                    owner.walletId;
    
    if (!payoutTo) {
      logger.warn(`No payout method found for owner: ${owner._id}`);
      return {
        success: false,
        error: 'No payout method configured'
      };
    }
    
    // In production, integrate with Razorpay Payouts/UPI API
    // This is a simulation - replace with actual API call
    
    const transactionId = `PAYOUT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Simulate successful payout
    // TODO: Replace with actual payout API like Razorpay Payouts
    /*
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
    
    const payout = await razorpay.payouts.create({
      account_number: process.env.RAZORPAY_ACCOUNT_NUMBER,
      fund_account_id: owner.razorpayFundAccountId,
      amount: amount * 100, // in paise
      currency: "INR",
      mode: payoutMethod,
      purpose: "payout",
      queue_if_low_balance: true,
      reference_id: transactionId,
      narration: `Payout for payment ${payment.transactionId}`
    });
    */
    
    // For now, simulate success
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API delay
    
    logger.info(`Payout initiated: ${transactionId}, Amount: ${amount}, To: ${payoutTo}`);
    
    return {
      success: true,
      method: payoutMethod,
      to: payoutTo,
      transactionId: transactionId,
      amount: amount
    };
    
  } catch (error) {
    logger.error(`Initiate payout error: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
};
module.exports = exports;