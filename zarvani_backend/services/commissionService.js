const Payment = require('../models/Payment');
const ServiceProvider = require('../models/ServiceProvider');
const Shop = require('../models/Shop');
const logger = require('../utils/logger');

class CommissionService {
  
  // Get all pending commissions
  static async getPendingCommissions(period = 'month', filters = {}) {
    try {
      const dateFilter = this.getDateFilter(period);
      
      const query = {
        paymentDestination: 'personal_account',
        'paymentVerification.status': 'pending',
        status: 'success',
        ...dateFilter,
        ...filters
      };

      const pendingCommissions = await Payment.find(query)
        .populate('provider', 'name phone email')
        .populate('shop', 'name phone email')
        .populate('user', 'name phone')
        .populate('booking', 'bookingId')
        .populate('order', 'orderId')
        .sort({ 'paymentVerification.dueDate': 1 });

      return pendingCommissions;
    } catch (error) {
      logger.error(`Get pending commissions error: ${error.message}`);
      throw error;
    }
  }

  // Get overdue commissions
  static async getOverdueCommissions() {
    try {
      const overdueCommissions = await Payment.find({
        paymentDestination: 'personal_account',
        'paymentVerification.status': 'pending',
        'paymentVerification.dueDate': { $lt: new Date() },
        status: 'success'
      })
        .populate('provider', 'name phone email')
        .populate('shop', 'name phone email')
        .populate('user', 'name phone')
        .populate('booking', 'bookingId')
        .populate('order', 'orderId')
        .sort({ 'paymentVerification.dueDate': 1 });

      return overdueCommissions;
    } catch (error) {
      logger.error(`Get overdue commissions error: ${error.message}`);
      throw error;
    }
  }

  // Mark commission as paid
  static async markCommissionPaid(paymentId, adminId, proof = null) {
    try {
      const payment = await Payment.findById(paymentId);
      
      if (!payment) {
        throw new Error('Payment not found');
      }

      if (payment.paymentDestination !== 'personal_account') {
        throw new Error('Commission only applicable for personal account payments');
      }

      payment.paymentVerification.status = 'verified';
      payment.paymentVerification.verifiedAt = new Date();
      payment.paymentVerification.verifiedBy = adminId;
      payment.commission.pendingCommission = 0;
      payment.commission.companyCommission = payment.amount * 0.20; // Record the collected commission

      await payment.save();

      // Send confirmation notification
      await this.sendCommissionPaidNotification(payment);

      logger.info(`Commission marked as paid for payment: ${paymentId} by admin: ${adminId}`);
      return payment;
    } catch (error) {
      logger.error(`Mark commission paid error: ${error.message}`);
      throw error;
    }
  }

  // Auto-remind overdue commissions
  static async sendCommissionReminders() {
    try {
      const overduePayments = await this.getOverdueCommissions();
      const NotificationService = require('./pushNotification');
      
      let reminderCount = 0;

      for (const payment of overduePayments) {
        const owner = await payment.getPaymentOwner();
        
        if (owner) {
          await NotificationService.sendToUser(
            owner._id,
            'Commission Overdue',
            `URGENT: Your commission of ₹${payment.commission.pendingCommission} is overdue. Please pay immediately to avoid account suspension.`
          );

          // Update reminder count
          payment.paymentVerification.remindersSent.push({
            sentAt: new Date(),
            type: 'overdue',
            method: 'push'
          });

          await payment.save();
          reminderCount++;
        }
      }

      logger.info(`Commission reminders sent: ${reminderCount}`);
      return reminderCount;
    } catch (error) {
      logger.error(`Send commission reminders error: ${error.message}`);
      throw error;
    }
  }

  // Send due date reminders
  static async sendDueDateReminders() {
    try {
      const dueSoonDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      
      const dueSoonPayments = await Payment.find({
        paymentDestination: 'personal_account',
        'paymentVerification.status': 'pending',
        'paymentVerification.dueDate': { 
          $lte: dueSoonDate,
          $gt: new Date() 
        },
        status: 'success'
      });

      const NotificationService = require('./pushNotification');
      let reminderCount = 0;

      for (const payment of dueSoonPayments) {
        const owner = await payment.getPaymentOwner();
        
        if (owner) {
          await NotificationService.sendToUser(
            owner._id,
            'Commission Due Tomorrow',
            `Reminder: Your commission of ₹${payment.commission.pendingCommission} is due tomorrow.`
          );

          payment.paymentVerification.remindersSent.push({
            sentAt: new Date(),
            type: 'reminder',
            method: 'push'
          });

          await payment.save();
          reminderCount++;
        }
      }

      logger.info(`Due date reminders sent: ${reminderCount}`);
      return reminderCount;
    } catch (error) {
      logger.error(`Send due date reminders error: ${error.message}`);
      throw error;
    }
  }

  // Calculate commission statistics
  static async getCommissionStats(period = 'month') {
    try {
      const dateFilter = this.getDateFilter(period);
      
      const stats = await Payment.aggregate([
        {
          $match: {
            status: 'success',
            ...dateFilter
          }
        },
        {
          $group: {
            _id: '$paymentDestination',
            totalAmount: { $sum: '$amount' },
            totalCommission: { $sum: '$commission.companyCommission' },
            pendingCommission: { 
              $sum: {
                $cond: [
                  { 
                    $and: [
                      { $eq: ['$paymentDestination', 'personal_account'] },
                      { $eq: ['$paymentVerification.status', 'pending'] }
                    ]
                  },
                  '$commission.pendingCommission',
                  0
                ]
              }
            },
            collectedCommission: {
              $sum: {
                $cond: [
                  { 
                    $and: [
                      { $eq: ['$paymentDestination', 'personal_account'] },
                      { $eq: ['$paymentVerification.status', 'verified'] }
                    ]
                  },
                  '$commission.pendingCommission',
                  0
                ]
              }
            },
            count: { $sum: 1 }
          }
        }
      ]);

      // Calculate overall totals
      const overallStats = {
        totalRevenue: stats.reduce((sum, stat) => sum + stat.totalAmount, 0),
        totalCommission: stats.reduce((sum, stat) => sum + stat.totalCommission, 0),
        totalPendingCommission: stats.reduce((sum, stat) => sum + stat.pendingCommission, 0),
        totalCollectedCommission: stats.reduce((sum, stat) => sum + stat.collectedCommission, 0),
        byDestination: stats
      };

      return overallStats;
    } catch (error) {
      logger.error(`Get commission stats error: ${error.message}`);
      throw error;
    }
  }

  // Get provider/shop commission summary
  static async getOwnerCommissionSummary(ownerId, ownerType, period = 'month') {
    try {
      const dateFilter = this.getDateFilter(period);
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
            totalEarnings: { $sum: '$commission.providerEarning' },
            totalCommission: { $sum: '$commission.companyCommission' },
            pendingCommission: {
              $sum: {
                $cond: [
                  { 
                    $and: [
                      { $eq: ['$paymentDestination', 'personal_account'] },
                      { $eq: ['$paymentVerification.status', 'pending'] }
                    ]
                  },
                  '$commission.pendingCommission',
                  0
                ]
              }
            },
            paymentCount: { $sum: 1 }
          }
        }
      ]);

      return summary;
    } catch (error) {
      logger.error(`Get owner commission summary error: ${error.message}`);
      throw error;
    }
  }

  static getDateFilter(period) {
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
      default:
        return {};
    }

    return { createdAt: { $gte: startDate } };
  }

  static async sendCommissionPaidNotification(payment) {
    try {
      const owner = await payment.getPaymentOwner();
      const NotificationService = require('./pushNotification');
      
      await NotificationService.sendToUser(
        owner._id,
        'Commission Paid',
        'Thank you for paying your commission. Your payment has been verified and recorded.'
      );

      logger.info(`Commission paid notification sent for payment: ${payment._id}`);
    } catch (error) {
      logger.error(`Send commission paid notification error: ${error.message}`);
    }
  }

  // Generate commission report
  static async generateCommissionReport(period = 'month', format = 'json') {
    try {
      const stats = await this.getCommissionStats(period);
      const pendingCommissions = await this.getPendingCommissions(period);
      const overdueCommissions = await this.getOverdueCommissions();

      const report = {
        period,
        generatedAt: new Date(),
        summary: stats,
        pendingCommissions: {
          count: pendingCommissions.length,
          totalAmount: pendingCommissions.reduce((sum, p) => sum + p.commission.pendingCommission, 0),
          items: pendingCommissions.map(p => ({
            paymentId: p._id,
            transactionId: p.transactionId,
            amount: p.amount,
            pendingCommission: p.commission.pendingCommission,
            dueDate: p.paymentVerification.dueDate,
            owner: p.provider ? 'provider' : 'shop',
            ownerId: p.provider || p.shop
          }))
        },
        overdueCommissions: {
          count: overdueCommissions.length,
          totalAmount: overdueCommissions.reduce((sum, p) => sum + p.commission.pendingCommission, 0),
          items: overdueCommissions.map(p => ({
            paymentId: p._id,
            transactionId: p.transactionId,
            amount: p.amount,
            pendingCommission: p.commission.pendingCommission,
            dueDate: p.paymentVerification.dueDate,
            daysOverdue: Math.ceil((new Date() - p.paymentVerification.dueDate) / (1000 * 60 * 60 * 24)),
            owner: p.provider ? 'provider' : 'shop',
            ownerId: p.provider || p.shop
          }))
        }
      };

      return report;
    } catch (error) {
      logger.error(`Generate commission report error: ${error.message}`);
      throw error;
    }
  }
}

module.exports = CommissionService;