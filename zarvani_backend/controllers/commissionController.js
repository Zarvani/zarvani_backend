const CommissionService = require('../services/commissionService');
const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const Order = require('../models/Order');
const ServiceProvider = require('../models/ServiceProvider');
const Shop = require('../models/Shop');
const ResponseHandler = require('../utils/responseHandler');
const logger = require('../utils/logger');
const mongoose = require('mongoose');
exports.getProviderCommissionSummary = async (req, res) => {
  try {
    const providerId = req.user._id;
    
    const summary = await CommissionService.getCommissionSummary(providerId, 'provider');
    
    const provider = await ServiceProvider.findById(providerId);
    
    ResponseHandler.success(res, {
      summary: {
        totalEarnings: provider?.earnings?.total || 0,
        totalCommissionDue: summary.totalCommissionDue,
        totalCommissionPaid: summary.totalCommissionPaid,
        netEarnings: (provider?.earnings?.total || 0) - summary.totalCommissionDue - summary.totalCommissionPaid,
        commissionRate: '20%'
      },
      breakdown: {
        pendingCommissions: summary.pendingCommissions,
        overdueCommissions: summary.overdueCommissions,
        paidCommissions: summary.paidCommissions
      },
      commissionRates: {
        companyPayment: '15%',
        personalPayment: '20%'
      }
    }, 'Provider commission summary fetched successfully');
    
  } catch (error) {
    logger.error(`Get provider commission summary error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

exports.getShopCommissionSummary = async (req, res) => {
  try {
    const shopId = req.user._id;
    
    const summary = await CommissionService.getCommissionSummary(shopId, 'shop');
    
    const shop = await Shop.findById(shopId);
    
    ResponseHandler.success(res, {
      summary: {
        totalEarnings: shop?.earnings?.total || 0,
        totalCommissionDue: summary.totalCommissionDue,
        totalCommissionPaid: summary.totalCommissionPaid,
        netEarnings: (shop?.earnings?.total || 0) - summary.totalCommissionDue - summary.totalCommissionPaid,
        commissionRate: '12%'
      },
      breakdown: {
        pendingCommissions: summary.pendingCommissions,
        overdueCommissions: summary.overdueCommissions,
        paidCommissions: summary.paidCommissions
      },
      commissionRates: {
        companyPayment: '8%',
        personalPayment: '12%'
      }
    }, 'Shop commission summary fetched successfully');
    
  } catch (error) {
    logger.error(`Get shop commission summary error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
exports.getCommissionDashboard = async (req, res) => {
  try {
    const user = req.user;
    const isProvider = user.role === 'provider';
    const isShop = user.role === 'shop';
    
    if (!isProvider && !isShop) {
      return ResponseHandler.error(res, 'Not authorized', 403);
    }
    
    const ownerId = user._id;
    const ownerType = isProvider ? 'provider' : 'shop';
    
    const summary = await CommissionService.getCommissionSummary(ownerId, ownerType, 'month');
    
    const recentPayments = await Payment.find({
      [ownerType]: ownerId,
      status: 'success'
    })
      .populate('booking', 'bookingId serviceDetails')
      .populate('order', 'orderId items pricing.totalAmount')
      .populate('user', 'name phone')
      .sort({ createdAt: -1 })
      .limit(10);
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    const monthlyTrend = await Payment.aggregate([
      {
        $match: {
          [ownerType]: ownerId,
          status: 'success',
          createdAt: {
            $gte: new Date(currentYear, currentMonth - 5, 1),
            $lt: new Date(currentYear, currentMonth + 1, 1)
          }
        }
      },
      {
        $group: {
          _id: { month: { $month: '$createdAt' }, year: { $year: '$createdAt' } },
          totalEarnings: { $sum: '$amount' },
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
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);
    
    ResponseHandler.success(res, {
      dashboard: {
        ownerType,
        ownerId,
        commissionRate: isProvider ? '20%' : '12%',
        updatedAt: new Date()
      },
      summary: {
        totalEarnings: summary.totalEarnings,
        totalCommissionDue: summary.totalCommissionDue,
        totalCommissionPaid: summary.totalCommissionPaid,
        netEarnings: summary.totalEarnings - summary.totalCommissionDue - summary.totalCommissionPaid,
        pendingCount: summary.pendingCommissions.length,
        overdueCount: summary.overdueCommissions.length,
        paidCount: summary.paidCommissions.length
      },
      breakdown: {
        pendingCommissions: summary.pendingCommissions.slice(0, 5),
        overdueCommissions: summary.overdueCommissions.slice(0, 5),
        recentPaidCommissions: summary.paidCommissions.slice(0, 5)
      },
      analytics: {
        monthlyTrend,
        paymentMethods: recentPayments.reduce((acc, payment) => {
          const method = payment.paymentMethod;
          acc[method] = (acc[method] || 0) + 1;
          return acc;
        }, {})
      },
      recentActivity: recentPayments.map(payment => ({
        id: payment._id,
        transactionId: payment.transactionId,
        amount: payment.amount,
        type: payment.paymentType,
        paymentDestination: payment.paymentDestination,
        commission: payment.totalCommission,
        status: payment.pendingCommission?.status || 'auto-deducted',
        date: payment.createdAt,
        ...(payment.booking && { 
          bookingId: payment.booking.bookingId,
          service: payment.booking.serviceDetails?.title 
        }),
        ...(payment.order && { 
          orderId: payment.order.orderId
        }),
        customer: payment.user?.name
      }))
    }, 'Commission dashboard fetched successfully');
    
  } catch (error) {
    logger.error(`Get commission dashboard error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
exports.payCommission = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { 
      paymentMethod = 'upi', 
      transactionId, 
      screenshotUrl, 
      notes 
    } = req.body;
    
    const user = req.user;
    const isProvider = user.role === 'provider';
    const isShop = user.role === 'shop';
    
    if (!isProvider && !isShop) {
      return ResponseHandler.error(res, 'Not authorized', 403);
    }
    
    const ownerField = isProvider ? 'provider' : 'shop';
    
    const payment = await Payment.findOne({
      _id: paymentId,
      [ownerField]: user._id,
      paymentDestination: 'personal_account',
      'pendingCommission.status': { $in: ['pending', 'overdue'] }
    });
    
    if (!payment) {
      return ResponseHandler.error(res, 'Commission not found or already paid', 404);
    }
    
    const updatedPayment = await CommissionService.markCommissionPaid(
      paymentId,
      user._id,
      {
        paymentMethod,
        transactionId,
        screenshotUrl,
        notes
      }
    );
    
    const ownerModel = isProvider ? ServiceProvider : Shop;
    const owner = await ownerModel.findById(user._id);
    
    if (owner) {
      owner.commission.due = Math.max(0, owner.commission.due - payment.commission.pendingCommission);
      owner.commission.paid = (owner.commission.paid || 0) + payment.commission.pendingCommission;
      owner.commission.lastPaymentDate = new Date();
      await owner.save();
    }
    
    ResponseHandler.success(res, {
      payment: {
        id: updatedPayment._id,
        transactionId: updatedPayment.transactionId,
        amount: updatedPayment.amount,
        commissionPaid: updatedPayment.commission.companyCommission,
        paymentMethod: updatedPayment.pendingCommission.paymentMethod,
        transactionId: updatedPayment.pendingCommission.transactionId,
        paidAt: updatedPayment.pendingCommission.paidDate,
        status: updatedPayment.pendingCommission.status
      },
      summary: {
        remainingDue: owner?.commission.due || 0,
        totalPaid: owner?.commission.paid || 0,
        commissionRate: isProvider ? '20%' : '12%'
      }
    }, 'Commission paid successfully');
    
  } catch (error) {
    logger.error(`Pay commission error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
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
    
    let owner;
    if (isProvider) {
      owner = await ServiceProvider.findById(ownerId);
    } else {
      owner = await Shop.findById(ownerId);
    }
    
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
    
    const payments = await Payment.find({
      [ownerField]: ownerId,
      status: 'success',
      ...dateFilter
    }).sort({ createdAt: -1 }).limit(50);
    
    const companyPayments = payments.filter(p => p.paymentDestination === 'company_account');
    const personalPayments = payments.filter(p => p.paymentDestination === 'personal_account');
    
    const companyEarnings = companyPayments.reduce((sum, p) => 
      sum + (p.commission?.providerEarning || p.commission?.shopEarning || 0), 0
    );
    
    const personalEarnings = personalPayments.reduce((sum, p) => sum + p.amount, 0);
    
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

exports.getMyPendingCommissions = async (req, res) => {
  try {
    const user = req.user;
    const ownerField = user.role === 'provider' ? 'provider' : 'shop';
    
    const pendingCommissions = await Payment.find({
      [ownerField]: user._id,
      paymentDestination: 'personal_account',
      'pendingCommission.status': { $in: ['pending', 'overdue'] }
    })
      .populate('booking', 'bookingId serviceDetails')
      .populate('order', 'orderId items')
      .populate('user', 'name phone')
      .sort({ 'pendingCommission.dueDate': 1 });
    
    ResponseHandler.success(res, {
      pendingCommissions: pendingCommissions.map(p => ({
        id: p._id,
        transactionId: p.transactionId,
        amount: p.amount,
        commission: p.commission.pendingCommission,
        dueDate: p.pendingCommission.dueDate,
        status: p.pendingCommission.status,
        daysRemaining: p.pendingCommission.dueDate ? 
          Math.max(0, Math.ceil((p.pendingCommission.dueDate - new Date()) / (1000 * 60 * 60 * 24))) : 0,
        daysOverdue: p.pendingCommission.dueDate && p.pendingCommission.dueDate < new Date() ? 
          Math.ceil((new Date() - p.pendingCommission.dueDate) / (1000 * 60 * 60 * 24)) : 0,
        ...(p.booking && { 
          type: 'service',
          bookingId: p.booking.bookingId,
          service: p.booking.serviceDetails?.title,
          customer: p.user?.name,
          customerPhone: p.user?.phone
        }),
        ...(p.order && { 
          type: 'product',
          orderId: p.order.orderId,
          customer: p.user?.name,
          customerPhone: p.user?.phone
        })
      })),
      summary: {
        totalDue: pendingCommissions.reduce((sum, p) => sum + p.commission.pendingCommission, 0),
        count: pendingCommissions.length,
        pendingCount: pendingCommissions.filter(p => p.pendingCommission.status === 'pending').length,
        overdueCount: pendingCommissions.filter(p => p.pendingCommission.status === 'overdue').length
      }
    }, 'Pending commissions fetched successfully');
    
  } catch (error) {
    logger.error(`Get my pending commissions error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

exports.getCommissionPaymentDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    const ownerField = user.role === 'provider' ? 'provider' : 'shop';
    
    const payment = await Payment.findOne({
      _id: id,
      [ownerField]: user._id
    })
      .populate('booking', 'bookingId serviceDetails totalAmount scheduledDate scheduledTime')
      .populate('order', 'orderId items pricing.totalAmount deliveryInfo')
      .populate('user', 'name phone email');
    
    if (!payment) {
      return ResponseHandler.error(res, 'Commission payment not found', 404);
    }
    
    // Calculate commission details
    const now = new Date();
    const dueDate = payment.pendingCommission?.dueDate;
    const daysRemaining = dueDate ? 
      Math.max(0, Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24))) : 0;
    const daysOverdue = dueDate && dueDate < now ? 
      Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24)) : 0;
    
    const commissionRate = payment.paymentType === 'service' ? 
      (payment.paymentDestination === 'company_account' ? 15 : 20) :
      (payment.paymentDestination === 'company_account' ? 8 : 12);
    
    ResponseHandler.success(res, {
      payment: {
        id: payment._id,
        transactionId: payment.transactionId,
        amount: payment.amount,
        paymentMethod: payment.paymentMethod,
        paymentDestination: payment.paymentDestination,
        paymentType: payment.paymentType,
        status: payment.status,
        createdAt: payment.createdAt,
        paymentDate: payment.paymentDate
      },
      commission: {
        amount: payment.paymentDestination === 'company_account' ? 
          payment.commission.companyCommission : 
          payment.commission.pendingCommission,
        rate: `${commissionRate}%`,
        netEarning: payment.netEarning,
        status: payment.pendingCommission?.status || 'auto-deducted',
        dueDate: payment.pendingCommission?.dueDate,
        paidDate: payment.pendingCommission?.paidDate,
        paymentMethod: payment.pendingCommission?.paymentMethod,
        transactionId: payment.pendingCommission?.transactionId,
        remindersSent: payment.pendingCommission?.remindersSent || []
      },
      timeline: {
        daysRemaining,
        daysOverdue,
        isOverdue: payment.pendingCommission?.status === 'overdue',
        canPay: payment.pendingCommission?.status === 'pending' || 
                payment.pendingCommission?.status === 'overdue'
      },
      relatedData: {
        ...(payment.booking && { 
          type: 'service',
          bookingId: payment.booking.bookingId,
          service: payment.booking.serviceDetails?.title,
          amount: payment.booking.totalAmount,
          scheduledDate: payment.booking.scheduledDate,
          scheduledTime: payment.booking.scheduledTime
        }),
        ...(payment.order && { 
          type: 'product',
          orderId: payment.order.orderId,
          amount: payment.order.pricing?.totalAmount,
          deliveryInfo: payment.order.deliveryInfo
        }),
        customer: payment.user ? {
          name: payment.user.name,
          phone: payment.user.phone,
          email: payment.user.email
        } : null
      }
    }, 'Commission payment details fetched successfully');
    
  } catch (error) {
    logger.error(`Get commission payment details error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

exports.getAllPendingCommissions = async (req, res) => {
  try {
    const { 
      ownerType, 
      status = 'pending', 
      startDate, 
      endDate,
      page = 1,
      limit = 50
    } = req.query;
    
    const filters = {
      ownerType,
      status,
      startDate,
      endDate
    };
    
    const pendingCommissions = await CommissionService.getPendingCommissions(filters);
    
    const overdueCommissions = await CommissionService.getOverdueCommissions('all');
    
    const totalPendingAmount = pendingCommissions.reduce((sum, p) => 
      sum + p.commission.pendingCommission, 0
    );
    
    const totalOverdueAmount = overdueCommissions.reduce((sum, p) => 
      sum + p.commission.pendingCommission, 0
    );
    
    const byOwnerType = {
      providers: pendingCommissions.filter(p => p.provider).length,
      shops: pendingCommissions.filter(p => p.shop).length
    };
    
    const skip = (page - 1) * limit;
    const paginatedCommissions = pendingCommissions.slice(skip, skip + limit);
    
    ResponseHandler.success(res, {
      commissions: paginatedCommissions.map(commission => ({
        id: commission._id,
        transactionId: commission.transactionId,
        amount: commission.amount,
        commission: commission.commission.pendingCommission,
        dueDate: commission.pendingCommission.dueDate,
        status: commission.pendingCommission.status,
        ownerType: commission.provider ? 'provider' : 'shop',
        ownerId: commission.provider || commission.shop,
        ownerName: commission.provider?.name || commission.shop?.name,
        ownerContact: commission.provider?.phone || commission.shop?.phone,
        ...(commission.booking && { 
          type: 'service',
          bookingId: commission.booking.bookingId,
          service: commission.booking.serviceDetails?.title,
          customer: commission.user?.name 
        }),
        ...(commission.order && { 
          type: 'product',
          orderId: commission.order.orderId,
          customer: commission.user?.name 
        })
      })),
      summary: {
        totalPending: pendingCommissions.length,
        totalPendingAmount,
        totalOverdue: overdueCommissions.length,
        totalOverdueAmount,
        byOwnerType,
        averageCommission: totalPendingAmount / (pendingCommissions.length || 1)
      },
      critical: overdueCommissions.slice(0, 10).map(commission => ({
        id: commission._id,
        transactionId: commission.transactionId,
        amount: commission.amount,
        commission: commission.commission.pendingCommission,
        dueDate: commission.pendingCommission.dueDate,
        daysOverdue: Math.ceil((new Date() - commission.pendingCommission.dueDate) / (1000 * 60 * 60 * 24)),
        ownerType: commission.provider ? 'provider' : 'shop',
        ownerName: commission.provider?.name || commission.shop?.name,
        ownerContact: commission.provider?.phone || commission.shop?.phone,
        remindersSent: commission.pendingCommission.remindersSent?.length || 0
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(pendingCommissions.length / limit),
        totalItems: pendingCommissions.length,
        itemsPerPage: parseInt(limit)
      }
    }, 'All pending commissions fetched successfully');
    
  } catch (error) {
    logger.error(`Get all pending commissions error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
exports.getCommissionStats = async (req, res) => {
  try {
    const { period = 'month', type = 'all' } = req.query;
    
    const stats = await CommissionService.getCommissionStats(period);
    
    const now = new Date();
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));
    
    const dailyTrend = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          totalRevenue: { $sum: '$amount' },
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
          pendingCommission: {
            $sum: {
              $cond: [
                { 
                  $and: [
                    { $eq: ['$paymentDestination', 'personal_account'] },
                    { $eq: ['$pendingCommission.status', 'pending'] }
                  ]
                },
                '$commission.pendingCommission',
                0
              ]
            }
          }
        }
      },
      { $sort: { '_id': 1 } }
    ]);
    
    const topPayers = await Payment.aggregate([
      {
        $match: {
          paymentDestination: 'personal_account',
          'pendingCommission.status': 'pending',
          status: 'success'
        }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $ne: ['$provider', null] },
              { type: 'provider', id: '$provider' },
              { type: 'shop', id: '$shop' }
            ]
          },
          totalCommissionDue: { $sum: '$commission.pendingCommission' },
          paymentCount: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      },
      { $sort: { totalCommissionDue: -1 } },
      { $limit: 10 }
    ]);
    
    const enhancedTopPayers = await Promise.all(
      topPayers.map(async (payer) => {
        let owner;
        if (payer._id.type === 'provider') {
          owner = await ServiceProvider.findById(payer._id.id)
            .select('name phone email verificationStatus');
        } else {
          owner = await Shop.findById(payer._id.id)
            .select('name phone email verificationStatus');
        }
        
        return {
          ...payer,
          ownerDetails: owner || null
        };
      })
    );
    
    ResponseHandler.success(res, {
      timeframe: period,
      generatedAt: new Date(),
      summary: stats.summary,
      metrics: {
        ...stats.metrics,
        pendingCollectionRate: stats.summary.totalCommission > 0 ? 
          ((stats.summary.totalCommission - stats.summary.pendingCommission) / stats.summary.totalCommission) * 100 : 0,
        averageCommissionPerTransaction: stats.summary.totalCommission / (stats.breakdown.reduce((sum, b) => sum + b.count, 0) || 1)
      },
      trends: {
        daily: dailyTrend,
        breakdownByType: stats.breakdown
      },
      topPayerInsights: {
        topCommissionPayers: enhancedTopPayers,
        highestSingleCommission: Math.max(...stats.breakdown.map(b => b.totalCommissionCollected)),
        averageDaysToPay: 7
      },
      alerts: {
        criticalOverdue: stats.summary.pendingCommission > 100000 ? 'High overdue amount detected' : 'Normal',
        collectionEfficiency: stats.metrics.collectionRate > 80 ? 'Good' : 'Needs improvement',
        pendingCount: stats.summary.pendingCommission > 0 ? `${stats.summary.pendingCommission.toFixed(2)} pending` : 'All clear'
      }
    }, 'Commission statistics fetched successfully');
    
  } catch (error) {
    logger.error(`Get commission stats error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

exports.adminMarkCommissionPaid = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { 
      paymentMethod = 'manual',
      transactionId,
      notes,
      overrideDueDate
    } = req.body;
    
    const adminId = req.user._id;
    
    const payment = await Payment.findById(paymentId)
      .populate('provider', 'name phone email')
      .populate('shop', 'name phone email');
    
    if (!payment) {
      return ResponseHandler.error(res, 'Payment not found', 404);
    }
    
    if (payment.paymentDestination !== 'personal_account') {
      return ResponseHandler.error(res, 'Only personal account payments have pending commission', 400);
    }
    
    if (payment.pendingCommission.status === 'paid') {
      return ResponseHandler.error(res, 'Commission already paid', 400);
    }
    
    const updatedPayment = await CommissionService.markCommissionPaid(
      paymentId,
      adminId,
      {
        paymentMethod,
        transactionId,
        notes: notes || `Manually marked as paid by admin: ${req.user.name}`,
        overrideDueDate
      }
    );
    
    const owner = payment.provider || payment.shop;
    const ownerType = payment.provider ? 'provider' : 'shop';
    
    ResponseHandler.success(res, {
      payment: {
        id: updatedPayment._id,
        transactionId: updatedPayment.transactionId,
        originalAmount: updatedPayment.amount,
        commissionPaid: updatedPayment.commission.companyCommission,
        paymentMethod: updatedPayment.pendingCommission.paymentMethod,
        paidAt: updatedPayment.pendingCommission.paidDate,
        verifiedBy: adminId,
        notes: updatedPayment.paymentVerification.notes
      },
      owner: {
        type: ownerType,
        id: owner._id,
        name: owner.name,
        contact: owner.phone || owner.email
      },
      commissionDetails: {
        rate: payment.commission.pendingCommissionRate + '%',
        originalDueDate: payment.pendingCommission.dueDate,
        daysOverdue: payment.pendingCommission.dueDate ? 
          Math.ceil((new Date() - payment.pendingCommission.dueDate) / (1000 * 60 * 60 * 24)) : 0,
        remindersSent: payment.pendingCommission.remindersSent?.length || 0
      }
    }, 'Commission marked as paid by admin');
    
  } catch (error) {
    logger.error(`Admin mark commission paid error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

exports.sendCommissionReminders = async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.CRON_API_KEY && req.user?.role !== 'admin') {
      return ResponseHandler.error(res, 'Unauthorized', 401);
    }
    
    const dueDateReminderCount = await CommissionService.sendDueDateReminders(24);
    
    const { reminderCount, escalationCount } = await CommissionService.sendCommissionReminders();
    
    await CommissionService.checkOverdueCommissions();
    
    ResponseHandler.success(res, {
      summary: {
        dueDateRemindersSent: dueDateReminderCount,
        overdueRemindersSent: reminderCount,
        escalations: escalationCount,
        timestamp: new Date()
      },
      message: 'Commission reminders processed successfully'
    }, 'Commission reminders sent successfully');
    
  } catch (error) {
    logger.error(`Send commission reminders error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
exports.getOverdueCommissions = async (req, res) => {
  try {
    const { severity = 'all' } = req.query;
    
    const overdueCommissions = await CommissionService.getOverdueCommissions(severity);
    
    // Calculate severity breakdown
    const now = new Date();
    const severityBreakdown = {
      critical: overdueCommissions.filter(p => {
        const daysOverdue = Math.ceil((now - p.pendingCommission.dueDate) / (1000 * 60 * 60 * 24));
        return daysOverdue > 14;
      }),
      high: overdueCommissions.filter(p => {
        const daysOverdue = Math.ceil((now - p.pendingCommission.dueDate) / (1000 * 60 * 60 * 24));
        return daysOverdue > 7 && daysOverdue <= 14;
      }),
      medium: overdueCommissions.filter(p => {
        const daysOverdue = Math.ceil((now - p.pendingCommission.dueDate) / (1000 * 60 * 60 * 24));
        return daysOverdue > 3 && daysOverdue <= 7;
      }),
      low: overdueCommissions.filter(p => {
        const daysOverdue = Math.ceil((now - p.pendingCommission.dueDate) / (1000 * 60 * 60 * 24));
        return daysOverdue <= 3;
      })
    };
    
    ResponseHandler.success(res, {
      overdueCommissions: overdueCommissions.map(commission => ({
        id: commission._id,
        transactionId: commission.transactionId,
        amount: commission.amount,
        commission: commission.commission.pendingCommission,
        dueDate: commission.pendingCommission.dueDate,
        daysOverdue: Math.ceil((now - commission.pendingCommission.dueDate) / (1000 * 60 * 60 * 24)),
        ownerType: commission.provider ? 'provider' : 'shop',
        ownerName: commission.provider?.name || commission.shop?.name,
        ownerContact: commission.provider?.phone || commission.shop?.phone,
        remindersSent: commission.pendingCommission.remindersSent?.length || 0,
        ...(commission.booking && { 
          type: 'service',
          bookingId: commission.booking.bookingId,
          service: commission.booking.serviceDetails?.title,
          customer: commission.user?.name 
        }),
        ...(commission.order && { 
          type: 'product',
          orderId: commission.order.orderId,
          customer: commission.user?.name 
        })
      })),
      severityBreakdown: {
        critical: {
          count: severityBreakdown.critical.length,
          amount: severityBreakdown.critical.reduce((sum, p) => sum + p.commission.pendingCommission, 0)
        },
        high: {
          count: severityBreakdown.high.length,
          amount: severityBreakdown.high.reduce((sum, p) => sum + p.commission.pendingCommission, 0)
        },
        medium: {
          count: severityBreakdown.medium.length,
          amount: severityBreakdown.medium.reduce((sum, p) => sum + p.commission.pendingCommission, 0)
        },
        low: {
          count: severityBreakdown.low.length,
          amount: severityBreakdown.low.reduce((sum, p) => sum + p.commission.pendingCommission, 0)
        }
      },
      summary: {
        totalOverdue: overdueCommissions.length,
        totalAmount: overdueCommissions.reduce((sum, p) => sum + p.commission.pendingCommission, 0),
        averageDaysOverdue: overdueCommissions.length > 0 ? 
          overdueCommissions.reduce((sum, p) => {
            const daysOverdue = Math.ceil((now - p.pendingCommission.dueDate) / (1000 * 60 * 60 * 24));
            return sum + daysOverdue;
          }, 0) / overdueCommissions.length : 0
      }
    }, 'Overdue commissions fetched successfully');
    
  } catch (error) {
    logger.error(`Get overdue commissions error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

module.exports = exports;