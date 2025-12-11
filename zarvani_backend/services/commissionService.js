const Payment = require('../models/Payment');
const ServiceProvider = require('../models/ServiceProvider');
const Shop = require('../models/Shop');
const logger = require('../utils/logger');

class CommissionService {
  
  // ✅ NEW: Process commission for different payment scenarios
  static async processCommission(paymentId) {
    try {
      const payment = await Payment.findById(paymentId)
        .populate('provider')
        .populate('shop');
      
      if (!payment) {
        throw new Error('Payment not found');
      }
      
      // Calculate commission based on payment destination and type
      await payment.calculateCommission();
      await payment.save();
      
      logger.info(`Commission processed for payment: ${paymentId}`);
      
      return payment;
    } catch (error) {
      logger.error(`Process commission error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: Get pending commissions with filters
  static async getPendingCommissions(filters = {}) {
    try {
      const {
        ownerType,
        ownerId,
        startDate,
        endDate,
        minAmount,
        maxAmount
      } = filters;
      
      const query = {
        paymentDestination: 'personal_account',
        'pendingCommission.status': 'pending',
        status: 'success'
      };
      
      // Apply filters
      if (ownerType === 'provider') {
        query.provider = { $ne: null };
      } else if (ownerType === 'shop') {
        query.shop = { $ne: null };
      }
      
      if (ownerId) {
        if (ownerType === 'provider') {
          query.provider = ownerId;
        } else if (ownerType === 'shop') {
          query.shop = ownerId;
        }
      }
      
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }
      
      if (minAmount || maxAmount) {
        query.amount = {};
        if (minAmount) query.amount.$gte = minAmount;
        if (maxAmount) query.amount.$lte = maxAmount;
      }
      
      const pendingCommissions = await Payment.find(query)
        .populate('provider', 'name phone email')
        .populate('shop', 'name phone email')
        .populate('user', 'name phone')
        .populate('booking', 'bookingId serviceDetails')
        .populate('order', 'orderId items')
        .sort({ 'pendingCommission.dueDate': 1 });
      
      return pendingCommissions;
    } catch (error) {
      logger.error(`Get pending commissions error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: Get overdue commissions with severity
  static async getOverdueCommissions(severity = 'all') {
    try {
      const now = new Date();
      let dateFilter = {};
      
      if (severity === 'critical') {
        // Overdue by more than 14 days
        const criticalDate = new Date(now.setDate(now.getDate() - 14));
        dateFilter = { $lt: criticalDate };
      } else if (severity === 'high') {
        // Overdue by 7-14 days
        const highDate = new Date(now.setDate(now.getDate() - 7));
        dateFilter = { $lt: highDate, $gte: new Date(now.setDate(now.getDate() - 7)) };
      } else {
        // All overdue
        dateFilter = { $lt: new Date() };
      }
      
      const overdueCommissions = await Payment.find({
        paymentDestination: 'personal_account',
        'pendingCommission.status': 'pending',
        'pendingCommission.dueDate': dateFilter,
        status: 'success'
      })
        .populate('provider', 'name phone email')
        .populate('shop', 'name phone email')
        .populate('user', 'name phone')
        .sort({ 'pendingCommission.dueDate': 1 });
      
      return overdueCommissions;
    } catch (error) {
      logger.error(`Get overdue commissions error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: Mark commission as paid with proof
  static async markCommissionPaid(paymentId, adminId, paymentData) {
    try {
      const {
        paymentMethod = 'upi',
        transactionId,
        screenshotUrl,
        notes
      } = paymentData;
      
      const payment = await Payment.findById(paymentId);
      
      if (!payment) {
        throw new Error('Payment not found');
      }
      
      if (payment.paymentDestination !== 'personal_account') {
        throw new Error('Commission only applicable for personal account payments');
      }
      
      if (payment.pendingCommission.status === 'paid') {
        throw new Error('Commission already paid');
      }
      
      // Mark commission as paid
      await payment.markCommissionPaid(adminId, paymentMethod, transactionId);
      
      // Store payment proof if provided
      if (screenshotUrl) {
        payment.metadata = payment.metadata || {};
        payment.metadata.commissionPaymentProof = {
          screenshotUrl,
          paidAt: new Date(),
          verifiedBy: adminId
        };
      }
      
      if (notes) {
        payment.paymentVerification.notes = notes;
      }
      
      await payment.save();
      
      // Send confirmation notifications
      await this.sendCommissionPaidNotifications(payment, adminId);
      
      logger.info(`Commission marked as paid for payment: ${paymentId} by admin: ${adminId}`);
      
      return payment;
    } catch (error) {
      logger.error(`Mark commission paid error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: Send commission reminders with escalation
  static async sendCommissionReminders() {
    try {
      const overdueCommissions = await this.getOverdueCommissions();
      const NotificationService = require('./pushNotification');
      const EmailService = require('./emailService');
      
      let reminderCount = 0;
      let escalationCount = 0;
      
      for (const payment of overdueCommissions) {
        const owner = await payment.getPaymentOwner();
        if (!owner) continue;
        
        const daysOverdue = payment.daysOverdue;
        let subject, message;
        
        if (daysOverdue > 14) {
          // Critical - escalate to admin
          subject = 'CRITICAL: Commission Overdue - Account Suspension Risk';
          message = `Commission of ₹${payment.commission.pendingCommission} is overdue by ${daysOverdue} days. Immediate action required.`;
          escalationCount++;
          
          // Notify admin
          await this.notifyAdminAboutCriticalCommission(payment);
        } else if (daysOverdue > 7) {
          // High priority
          subject = 'URGENT: Commission Overdue';
          message = `Your commission of ₹${payment.commission.pendingCommission} is overdue by ${daysOverdue} days. Please pay immediately.`;
        } else {
          // Normal reminder
          subject = 'Reminder: Commission Payment Due';
          message = `Your commission of ₹${payment.commission.pendingCommission} is overdue. Please make the payment.`;
        }
        
        // Send notification
        await NotificationService.sendToUser(owner._id, subject, message);
        
        // Send email
        if (owner.email) {
          await EmailService.sendCommissionReminder({
            to: owner.email,
            amount: payment.commission.pendingCommission,
            daysOverdue,
            dueDate: payment.pendingCommission.dueDate,
            paymentId: payment._id
          });
        }
        
        // Update reminder count
        payment.pendingCommission.remindersSent.push({
          sentAt: new Date(),
          type: daysOverdue > 7 ? 'urgent' : 'normal',
          content: message
        });
        
        payment.pendingCommission.reminderSent = true;
        await payment.save();
        
        reminderCount++;
      }
      
      logger.info(`Commission reminders sent: ${reminderCount}, escalations: ${escalationCount}`);
      
      return { reminderCount, escalationCount };
    } catch (error) {
      logger.error(`Send commission reminders error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: Send due date reminders
  static async sendDueDateReminders(hoursBefore = 24) {
    try {
      const dueSoonDate = new Date(Date.now() + hoursBefore * 60 * 60 * 1000);
      
      const dueSoonPayments = await Payment.find({
        paymentDestination: 'personal_account',
        'pendingCommission.status': 'pending',
        'pendingCommission.dueDate': { 
          $lte: dueSoonDate,
          $gt: new Date() 
        },
        status: 'success',
        'pendingCommission.reminderSent': { $ne: true }
      });
      
      const NotificationService = require('./pushNotification');
      let reminderCount = 0;
      
      for (const payment of dueSoonPayments) {
        const owner = await payment.getPaymentOwner();
        if (!owner) continue;
        
        const hoursRemaining = Math.ceil((payment.pendingCommission.dueDate - new Date()) / (1000 * 60 * 60));
        
        await NotificationService.sendToUser(
          owner._id,
          'Commission Due Soon',
          `Your commission of ₹${payment.commission.pendingCommission} is due in ${hoursRemaining} hours.`
        );
        
        payment.pendingCommission.reminderSent = true;
        payment.pendingCommission.remindersSent.push({
          sentAt: new Date(),
          type: 'due_soon',
          content: `Commission due in ${hoursRemaining} hours`
        });
        
        await payment.save();
        reminderCount++;
      }
      
      logger.info(`Due date reminders sent: ${reminderCount}`);
      return reminderCount;
    } catch (error) {
      logger.error(`Send due date reminders error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: Get comprehensive commission statistics
  static async getCommissionStats(timeframe = 'month') {
    try {
      const dateFilter = this.getDateFilter(timeframe);
      
      // Aggregate commission data
      const commissionStats = await Payment.aggregate([
        {
          $match: {
            status: 'success',
            ...dateFilter
          }
        },
        {
          $group: {
            _id: {
              destination: '$paymentDestination',
              type: '$paymentType'
            },
            totalAmount: { $sum: '$amount' },
            totalCommissionCollected: { 
              $sum: {
                $cond: [
                  { $eq: ['$paymentDestination', 'company_account'] },
                  '$commission.companyCommission',
                  0
                ]
              }
            },
            totalPendingCommission: {
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
            },
            totalCommissionPaid: {
              $sum: {
                $cond: [
                  { 
                    $and: [
                      { $eq: ['$paymentDestination', 'personal_account'] },
                      { $eq: ['$pendingCommission.status', 'paid'] }
                    ]
                  },
                  '$commission.pendingCommission',
                  0
                ]
              }
            },
            count: { $sum: 1 }
          }
        },
        {
          $sort: { '_id.destination': 1, '_id.type': 1 }
        }
      ]);
      
      // Calculate totals
      const totals = {
        totalRevenue: 0,
        totalCommission: 0,
        pendingCommission: 0,
        collectedCommission: 0,
        byType: {}
      };
      
      commissionStats.forEach(stat => {
        totals.totalRevenue += stat.totalAmount;
        totals.totalCommission += stat.totalCommissionCollected + stat.totalCommissionPaid;
        totals.pendingCommission += stat.totalPendingCommission;
        totals.collectedCommission += stat.totalCommissionCollected + stat.totalCommissionPaid;
        
        const type = stat._id.type || 'unknown';
        totals.byType[type] = totals.byType[type] || {
          revenue: 0,
          commission: 0,
          pending: 0
        };
        
        totals.byType[type].revenue += stat.totalAmount;
        totals.byType[type].commission += stat.totalCommissionCollected + stat.totalCommissionPaid;
        totals.byType[type].pending += stat.totalPendingCommission;
      });
      
      // Get top commission payers
      const topPayers = await Payment.aggregate([
        {
          $match: {
            paymentDestination: 'personal_account',
            status: 'success',
            ...dateFilter
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
            totalCommission: { $sum: '$commission.pendingCommission' },
            totalPaid: {
              $sum: {
                $cond: [
                  { $eq: ['$pendingCommission.status', 'paid'] },
                  '$commission.pendingCommission',
                  0
                ]
              }
            },
            totalPending: {
              $sum: {
                $cond: [
                  { $eq: ['$pendingCommission.status', 'pending'] },
                  '$commission.pendingCommission',
                  0
                ]
              }
            },
            paymentCount: { $sum: 1 }
          }
        },
        {
          $sort: { totalCommission: -1 }
        },
        {
          $limit: 10
        }
      ]);
      
      return {
        timeframe,
        generatedAt: new Date(),
        summary: totals,
        breakdown: commissionStats,
        topPayers,
        metrics: {
          commissionRate: totals.totalRevenue > 0 ? (totals.totalCommission / totals.totalRevenue) * 100 : 0,
          collectionRate: totals.totalCommission > 0 ? (totals.collectedCommission / totals.totalCommission) * 100 : 0,
          averageCommission: totals.totalCommission > 0 ? totals.totalCommission / commissionStats.reduce((sum, s) => sum + s.count, 0) : 0
        }
      };
    } catch (error) {
      logger.error(`Get commission stats error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: Get commission summary for owner (provider/shop)
  static async getOwnerCommissionSummary(ownerId, ownerType, timeframe = 'month') {
    try {
      const dateFilter = this.getDateFilter(timeframe);
      const ownerField = ownerType === 'provider' ? 'provider' : 'shop';
      
      const summary = await Payment.aggregate([
        {
          $match: {
            [ownerField]: ownerId,
            status: 'success',
            ...dateFilter
          }
        },
        {
          $group: {
            _id: '$paymentDestination',
            totalEarnings: {
              $sum: {
                $cond: [
                  { $eq: ['$paymentType', 'service'] },
                  '$commission.providerEarning',
                  '$commission.shopEarning'
                ]
              }
            },
            totalCommissionOwed: {
              $sum: {
                $cond: [
                  { $eq: ['$paymentDestination', 'personal_account'] },
                  '$commission.pendingCommission',
                  0
                ]
              }
            },
            totalCommissionPaid: {
              $sum: {
                $cond: [
                  { 
                    $and: [
                      { $eq: ['$paymentDestination', 'personal_account'] },
                      { $eq: ['$pendingCommission.status', 'paid'] }
                    ]
                  },
                  '$commission.pendingCommission',
                  0
                ]
              }
            },
            paymentCount: { $sum: 1 },
            averagePayment: { $avg: '$amount' }
          }
        }
      ]);
      
      // Get pending commissions
      const pendingCommissions = await Payment.find({
        [ownerField]: ownerId,
        paymentDestination: 'personal_account',
        'pendingCommission.status': 'pending',
        status: 'success',
        ...dateFilter
      }).sort({ 'pendingCommission.dueDate': 1 });
      
      // Calculate totals
      const totals = {
        totalEarnings: 0,
        totalCommissionOwed: 0,
        totalCommissionPaid: 0,
        pendingCommission: pendingCommissions.reduce((sum, p) => sum + p.commission.pendingCommission, 0),
        pendingCount: pendingCommissions.length
      };
      
      summary.forEach(item => {
        totals.totalEarnings += item.totalEarnings;
        totals.totalCommissionOwed += item.totalCommissionOwed;
        totals.totalCommissionPaid += item.totalCommissionPaid;
      });
      
      return {
        ownerId,
        ownerType,
        timeframe,
        summary,
        totals,
        pendingCommissions: pendingCommissions.map(p => ({
          paymentId: p._id,
          transactionId: p.transactionId,
          amount: p.amount,
          commission: p.commission.pendingCommission,
          dueDate: p.pendingCommission.dueDate,
          daysRemaining: Math.ceil((p.pendingCommission.dueDate - new Date()) / (1000 * 60 * 60 * 24))
        }))
      };
    } catch (error) {
      logger.error(`Get owner commission summary error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: Generate commission report
  static async generateCommissionReport(timeframe = 'month', format = 'json') {
    try {
      const stats = await this.getCommissionStats(timeframe);
      const pendingCommissions = await this.getPendingCommissions();
      const overdueCommissions = await this.getOverdueCommissions();
      
      const report = {
        timeframe,
        generatedAt: new Date(),
        summary: stats.summary,
        metrics: stats.metrics,
        
        pendingCommissions: {
          count: pendingCommissions.length,
          totalAmount: pendingCommissions.reduce((sum, p) => sum + p.commission.pendingCommission, 0),
          items: pendingCommissions.map(p => ({
            paymentId: p._id,
            transactionId: p.transactionId,
            date: p.createdAt,
            amount: p.amount,
            commission: p.commission.pendingCommission,
            dueDate: p.pendingCommission.dueDate,
            ownerType: p.provider ? 'provider' : 'shop',
            ownerId: p.provider || p.shop,
            ownerName: p.provider?.name || p.shop?.name
          }))
        },
        
        overdueCommissions: {
          count: overdueCommissions.length,
          totalAmount: overdueCommissions.reduce((sum, p) => sum + p.commission.pendingCommission, 0),
          items: overdueCommissions.map(p => ({
            paymentId: p._id,
            transactionId: p.transactionId,
            amount: p.amount,
            commission: p.commission.pendingCommission,
            dueDate: p.pendingCommission.dueDate,
            daysOverdue: Math.ceil((new Date() - p.pendingCommission.dueDate) / (1000 * 60 * 60 * 24)),
            ownerType: p.provider ? 'provider' : 'shop',
            ownerId: p.provider || p.shop,
            ownerName: p.provider?.name || p.shop?.name,
            contact: p.provider?.phone || p.shop?.phone
          }))
        },
        
        breakdown: stats.breakdown,
        topPayers: stats.topPayers
      };
      
      if (format === 'csv') {
        return this.convertToCSV(report);
      }
      
      return report;
    } catch (error) {
      logger.error(`Generate commission report error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: Notify admin about critical commission
  static async notifyAdminAboutCriticalCommission(payment) {
    try {
      const NotificationService = require('./pushNotification');
      const owner = await payment.getPaymentOwner();
      
      if (!owner) return;
      
      const adminMessage = `CRITICAL: Commission overdue for ${owner.name || 'Owner'}. ` +
                          `Amount: ₹${payment.commission.pendingCommission}, ` +
                          `Overdue by: ${payment.daysOverdue} days, ` +
                          `Payment ID: ${payment._id}`;
      
      // This should notify all admins
      // In production, you'd have an Admin model to get admin users
      logger.warn(adminMessage);
      
      // You can also send to a dedicated admin notification channel
      // await NotificationService.sendToAdmin('Critical Commission Alert', adminMessage);
    } catch (error) {
      logger.error(`Notify admin error: ${error.message}`);
    }
  }
  
  // ✅ NEW: Send commission paid notifications
  static async sendCommissionPaidNotifications(payment, adminId) {
    try {
      const NotificationService = require('./pushNotification');
      const owner = await payment.getPaymentOwner();
      
      if (owner) {
        await NotificationService.sendToUser(
          owner._id,
          'Commission Payment Verified',
          `Your commission payment of ₹${payment.commission.pendingCommission} has been verified. Thank you!`
        );
      }
      
      // Notify admin who verified
      const admin = await mongoose.model('User').findById(adminId);
      if (admin) {
        await NotificationService.sendToUser(
          adminId,
          'Commission Payment Recorded',
          `Commission payment verified for transaction: ${payment.transactionId}`
        );
      }
    } catch (error) {
      logger.error(`Send commission paid notifications error: ${error.message}`);
    }
  }
  
  // Helper: Convert to CSV
  static convertToCSV(report) {
    // Implement CSV conversion logic
    // This is a simplified version
    const csv = [];
    
    // Add headers
    csv.push('Payment ID,Transaction ID,Amount,Commission,Due Date,Owner Type,Owner Name,Status');
    
    // Add pending commissions
    report.pendingCommissions.items.forEach(item => {
      csv.push(`${item.paymentId},${item.transactionId},${item.amount},${item.commission},${item.dueDate},${item.ownerType},${item.ownerName},pending`);
    });
    
    // Add overdue commissions
    report.overdueCommissions.items.forEach(item => {
      csv.push(`${item.paymentId},${item.transactionId},${item.amount},${item.commission},${item.dueDate},${item.ownerType},${item.ownerName},overdue`);
    });
    
    return csv.join('\n');
  }
  
  // Helper: Get date filter
  static getDateFilter(timeframe) {
    const now = new Date();
    let startDate;
    
    switch (timeframe) {
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
      default:
        return {};
    }
    
    return { createdAt: { $gte: startDate } };
  }
}

module.exports = CommissionService;