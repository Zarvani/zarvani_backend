const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const Order = require('../models/Order');
const ServiceProvider = require('../models/ServiceProvider');
const Shop = require('../models/Shop');
const ResponseHandler = require('../utils/responseHandler');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

// ==================== GET COMMISSION DASHBOARD ====================
exports.getCommissionDashboard = async (req, res) => {
  try {
    const user = req.user;
    const isProvider = user.role === 'provider';
    const isShop = user.role === 'shop';
    
    if (!isProvider && !isShop) {
      return ResponseHandler.error(res, 'Only providers or shops can view commission dashboard', 403);
    }
    
    const ownerId = user._id;
    const ownerField = isProvider ? 'provider' : 'shop';
    const commissionRate = isProvider ? 20 : 12;
    
    // Get all time totals
    const allTimeStats = await this.calculateCommissionStats(ownerId, ownerField);
    
    // Get this month stats
    const thisMonthStart = new Date();
    thisMonthStart.setDate(1);
    thisMonthStart.setHours(0, 0, 0, 0);
    
    const thisMonthStats = await this.calculateCommissionStats(
      ownerId, 
      ownerField,
      { createdAt: { $gte: thisMonthStart } }
    );
    
    // Get pending commissions
    const pendingCommissions = await Payment.find({
      [ownerField]: ownerId,
      paymentDestination: 'personal_account',
      'pendingCommission.status': { $in: ['pending', 'overdue'] }
    })
      .populate('booking', 'bookingId serviceDetails totalAmount')
      .populate('order', 'orderId pricing.totalAmount')
      .populate('user', 'name phone')
      .sort({ 'pendingCommission.dueDate': 1 })
      .limit(20);
    
    // Get paid commissions history
    const paidCommissions = await Payment.find({
      [ownerField]: ownerId,
      paymentDestination: 'personal_account',
      'pendingCommission.status': 'paid'
    })
      .sort({ 'pendingCommission.paidDate': -1 })
      .limit(10);
    
    ResponseHandler.success(res, {
      dashboard: {
        commissionRate: `${commissionRate}%`,
        ownerType: isProvider ? 'provider' : 'shop',
        ownerId: ownerId,
        updatedAt: new Date()
      },
      summary: {
        allTime: {
          totalEarnings: allTimeStats.totalEarnings,
          totalCommissionDue: allTimeStats.totalCommissionDue,
          totalCommissionPaid: allTimeStats.totalCommissionPaid,
          netEarnings: allTimeStats.totalEarnings - allTimeStats.totalCommissionDue - allTimeStats.totalCommissionPaid,
          totalTransactions: allTimeStats.totalTransactions
        },
        thisMonth: {
          totalEarnings: thisMonthStats.totalEarnings,
          totalCommissionDue: thisMonthStats.totalCommissionDue,
          totalCommissionPaid: thisMonthStats.totalCommissionPaid,
          netEarnings: thisMonthStats.totalEarnings - thisMonthStats.totalCommissionDue - thisMonthStats.totalCommissionPaid,
          totalTransactions: thisMonthStats.totalTransactions
        }
      },
      pending: {
        totalDue: pendingCommissions.reduce((sum, p) => sum + p.commission.pendingCommission, 0),
        count: pendingCommissions.length,
        items: pendingCommissions.map(p => ({
          paymentId: p._id,
          transactionId: p.transactionId,
          amount: p.amount,
          commission: p.commission.pendingCommission,
          dueDate: p.pendingCommission.dueDate,
          status: p.pendingCommission.status,
          daysRemaining: p.pendingCommission.dueDate ? 
            Math.max(0, Math.ceil((p.pendingCommission.dueDate - new Date()) / (1000 * 60 * 60 * 24))) : 0,
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
        }))
      },
      history: {
        totalPaid: paidCommissions.reduce((sum, p) => sum + p.commission.pendingCommission, 0),
        count: paidCommissions.length,
        items: paidCommissions.map(p => ({
          paymentId: p._id,
          transactionId: p.transactionId,
          amount: p.amount,
          commission: p.commission.pendingCommission,
          paidAt: p.pendingCommission.paidDate,
          paymentMethod: p.pendingCommission.paymentMethod,
          ...(p.booking && { 
            type: 'service',
            bookingId: p.booking.bookingId
          }),
          ...(p.order && { 
            type: 'product',
            orderId: p.order.orderId
          })
        }))
      }
    }, 'Commission dashboard fetched successfully');
    
  } catch (error) {
    logger.error(`Get commission dashboard error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ==================== INITIATE COMMISSION PAYOUT ====================
exports.initiateCommissionPayout = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const user = req.user;
    const { paymentIds, paymentMethod, transactionId, notes } = req.body;
    
    const isProvider = user.role === 'provider';
    const isShop = user.role === 'shop';
    
    if (!isProvider && !isShop) {
      await session.abortTransaction();
      return ResponseHandler.error(res, 'Only providers or shops can initiate payout', 403);
    }
    
    if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0) {
      await session.abortTransaction();
      return ResponseHandler.error(res, 'Please select at least one commission to pay', 400);
    }
    
    const ownerField = isProvider ? 'provider' : 'shop';
    const ownerId = user._id;
    
    // Get all selected payments
    const payments = await Payment.find({
      _id: { $in: paymentIds },
      [ownerField]: ownerId,
      paymentDestination: 'personal_account',
      'pendingCommission.status': { $in: ['pending', 'overdue'] }
    }).session(session);
    
    if (payments.length === 0) {
      await session.abortTransaction();
      return ResponseHandler.error(res, 'No valid commissions found to pay', 404);
    }
    
    // Calculate total amount
    const totalCommission = payments.reduce((sum, p) => 
      sum + p.commission.pendingCommission, 0
    );
    
    // Mark each commission as paid
    const now = new Date();
    const updatedPayments = [];
    
    for (const payment of payments) {
      payment.pendingCommission.status = 'paid';
      payment.pendingCommission.paidDate = now;
      payment.pendingCommission.paymentMethod = paymentMethod;
      payment.pendingCommission.transactionId = transactionId;
      
      // Move to company commission
      payment.commission.companyCommission = payment.commission.pendingCommission;
      payment.commission.pendingCommission = 0;
      
      // Update verification
      payment.paymentVerification = {
        status: 'verified',
        verifiedAt: now,
        verifiedBy: user._id,
        notes: notes || `Paid via ${paymentMethod}`
      };
      
      await payment.save({ session });
      updatedPayments.push(payment);
      
      // Update Booking/Order commission status
      if (payment.booking) {
        await Booking.findByIdAndUpdate(
          payment.booking,
          {
            'payment.commissionStatus': 'paid',
            'payment.commissionPaidAt': now
          },
          { session }
        );
      }
      
      if (payment.order) {
        await Order.findByIdAndUpdate(
          payment.order,
          {
            'payment.commissionStatus': 'paid',
            'payment.commissionPaidAt': now
          },
          { session }
        );
      }
    }
    
    // Update owner commission tracking
    if (isProvider) {
      const provider = await ServiceProvider.findById(ownerId).session(session);
      provider.commission.due = Math.max(0, provider.commission.due - totalCommission);
      provider.commission.paid = (provider.commission.paid || 0) + totalCommission;
      provider.commission.lastPaymentDate = now;
      await provider.save({ session });
    } else if (isShop) {
      const shop = await Shop.findById(ownerId).session(session);
      shop.commission.due = Math.max(0, shop.commission.due - totalCommission);
      shop.commission.paid = (shop.commission.paid || 0) + totalCommission;
      shop.commission.lastPaymentDate = now;
      await shop.save({ session });
    }
    
    // Create a consolidated payout record
    const payoutRecord = await Payment.create([{
      transactionId: `PAYOUT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      user: user._id,
      amount: totalCommission,
      paymentMethod: paymentMethod,
      paymentDestination: 'company_account',
      paymentType: 'commission_payout',
      status: 'success',
      paymentDate: now,
      verified: true,
      
      // Link to owner
      ...(isProvider && { provider: ownerId }),
      ...(isShop && { shop: ownerId }),
      
      // Commission details
      commission: {
        companyCommission: totalCommission,
        calculatedAt: now
      },
      
      metadata: {
        type: 'commission_payout',
        paymentIds: paymentIds,
        originalTransactions: updatedPayments.map(p => p.transactionId),
        notes: notes || 'Commission payout initiated by owner',
        initiatedBy: user._id
      }
    }], { session });
    
    await session.commitTransaction();
    
    // Send notification
    try {
      const PushNotificationService = require('../services/pushNotification');
      await PushNotificationService.sendToUser(
        user._id,
        'Commission Paid Successfully ✅',
        `You have paid ₹${totalCommission} in commissions. Thank you!`
      );
    } catch (notifError) {
      logger.error(`Notification error: ${notifError.message}`);
    }
    
    ResponseHandler.success(res, {
      payout: {
        id: payoutRecord[0]._id,
        transactionId: payoutRecord[0].transactionId,
        amount: totalCommission,
        paymentMethod: paymentMethod,
        paidAt: now,
        count: updatedPayments.length,
        paymentIds: updatedPayments.map(p => p._id)
      },
      summary: {
        totalPaid: totalCommission,
        numberOfCommissions: updatedPayments.length,
        status: 'completed'
      }
    }, 'Commission payout completed successfully');
    
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Initiate commission payout error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  } finally {
    session.endSession();
  }
};

// ==================== GET EARNINGS SUMMARY ====================
exports.getEarningsSummary = async (req, res) => {
  try {
    const user = req.user;
    const { period = 'all' } = req.query;
    
    const isProvider = user.role === 'provider';
    const isShop = user.role === 'shop';
    
    if (!isProvider && !isShop) {
      return ResponseHandler.error(res, 'Not authorized', 403);
    }
    
    const ownerField = isProvider ? 'provider' : 'shop';
    const ownerId = user._id;
    
    // Get owner data for total earnings
    let owner;
    if (isProvider) {
      owner = await ServiceProvider.findById(ownerId);
    } else {
      owner = await Shop.findById(ownerId);
    }
    
    // Build date filter
    const dateFilter = {};
    const now = new Date();
    
    switch (period) {
      case 'today':
        const today = new Date(now.setHours(0, 0, 0, 0));
        dateFilter.createdAt = { $gte: today };
        break;
      case 'week':
        const weekAgo = new Date(now.setDate(now.getDate() - 7));
        dateFilter.createdAt = { $gte: weekAgo };
        break;
      case 'month':
        const monthAgo = new Date(now.setMonth(now.getMonth() - 1));
        dateFilter.createdAt = { $gte: monthAgo };
        break;
      case 'year':
        const yearAgo = new Date(now.setFullYear(now.getFullYear() - 1));
        dateFilter.createdAt = { $gte: yearAgo };
        break;
    }
    
    // Get payment breakdown
    const payments = await Payment.find({
      [ownerField]: ownerId,
      status: 'success',
      ...dateFilter
    }).sort({ createdAt: -1 }).limit(50);
    
    // Calculate breakdown by payment type
    const companyPayments = payments.filter(p => p.paymentDestination === 'company_account');
    const personalPayments = payments.filter(p => p.paymentDestination === 'personal_account');
    
    const companyEarnings = companyPayments.reduce((sum, p) => 
      sum + (p.commission?.providerEarning || p.commission?.shopEarning || 0), 0
    );
    
    const personalEarnings = personalPayments.reduce((sum, p) => sum + p.amount, 0);
    
    // Calculate commission breakdown
    const companyCommission = companyPayments.reduce((sum, p) => 
      sum + (p.commission?.companyCommission || 0), 0
    );
    
    const personalCommissionDue = personalPayments
      .filter(p => p.pendingCommission?.status === 'pending')
      .reduce((sum, p) => sum + (p.commission?.pendingCommission || 0), 0);
    
    const personalCommissionPaid = personalPayments
      .filter(p => p.pendingCommission?.status === 'paid')
      .reduce((sum, p) => sum + (p.commission?.pendingCommission || 0), 0);
    
    ResponseHandler.success(res, {
      period,
      summary: {
        totalEarnings: owner?.earnings?.total || 0,
        periodEarnings: companyEarnings + personalEarnings,
        breakdown: {
          fromCompany: companyEarnings,
          fromPersonal: personalEarnings
        },
        commission: {
          totalPaid: companyCommission + personalCommissionPaid,
          due: personalCommissionDue,
          breakdown: {
            autoDeducted: companyCommission,
            manuallyPaid: personalCommissionPaid,
            pending: personalCommissionDue
          }
        },
        transactionCount: payments.length
      },
      commissionRates: {
        companyPayments: isProvider ? '15%' : '8%',
        personalPayments: isProvider ? '20%' : '12%'
      }
    }, 'Earnings summary fetched');
    
  } catch (error) {
    logger.error(`Get earnings summary error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ==================== HELPER FUNCTIONS ====================
exports.calculateCommissionStats = async (ownerId, ownerField, additionalFilter = {}) => {
  const isProvider = ownerField === 'provider';
  
  // Get earnings from provider/shop model
  let owner;
  if (isProvider) {
    owner = await ServiceProvider.findById(ownerId);
  } else {
    owner = await Shop.findById(ownerId);
  }
  
  const totalEarnings = owner?.earnings?.total || 0;
  
  // Get commission due from personal payments
  const dueQuery = {
    [ownerField]: ownerId,
    paymentDestination: 'personal_account',
    'pendingCommission.status': { $in: ['pending', 'overdue'] },
    ...additionalFilter
  };
  
  const dueResult = await Payment.aggregate([
    { $match: dueQuery },
    {
      $group: {
        _id: null,
        total: { $sum: '$commission.pendingCommission' },
        count: { $sum: 1 }
      }
    }
  ]);
  
  const totalCommissionDue = dueResult[0]?.total || 0;
  
  // Get commission paid (both auto from company and manual)
  const paidQuery = {
    [ownerField]: ownerId,
    $or: [
      { paymentDestination: 'company_account' },
      { 
        paymentDestination: 'personal_account',
        'pendingCommission.status': 'paid'
      }
    ],
    ...additionalFilter
  };
  
  const paidResult = await Payment.aggregate([
    { $match: paidQuery },
    {
      $group: {
        _id: null,
        total: { 
          $sum: {
            $cond: [
              { $eq: ['$paymentDestination', 'company_account'] },
              '$commission.companyCommission',
              '$commission.pendingCommission'
            ]
          }
        },
        count: { $sum: 1 }
      }
    }
  ]);
  
  const totalCommissionPaid = paidResult[0]?.total || 0;
  
  // Get total transactions count
  const transactionQuery = {
    [ownerField]: ownerId,
    status: 'success',
    ...additionalFilter
  };
  
  const totalTransactions = await Payment.countDocuments(transactionQuery);
  
  return {
    totalEarnings,
    totalCommissionDue,
    totalCommissionPaid,
    totalTransactions,
    netEarnings: totalEarnings - totalCommissionDue - totalCommissionPaid
  };
};