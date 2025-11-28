// ============= services/commissionService.js =============
const Payment = require('../models/Payment');
const ServiceProvider = require('../models/ServiceProvider');
const { Shop } = require('../models/Shop');
const { Notification } = require('../models/Notification');
const logger = require('../utils/logger');

class CommissionService {
  constructor() {
    this.COMMISSION_RATE = 15; // 15%
    this.PENDING_COMMISSION_DAYS = 7; // 7 days to pay commission
  }

  calculateCommission(amount) {
    const commission = (amount * this.COMMISSION_RATE) / 100;
    const providerEarning = amount - commission;
    
    return {
      companyCommission: parseFloat(commission.toFixed(2)),
      providerEarning: parseFloat(providerEarning.toFixed(2)),
      commissionRate: this.COMMISSION_RATE,
      calculatedAt: new Date()
    };
  }

  async processCompanyAccountPayment(paymentData) {
    const session = await Payment.startSession();
    session.startTransaction();

    try {
      const { amount, providerId, shopId } = paymentData;
      
      const commission = this.calculateCommission(amount);
      
      const payment = await Payment.create([{
        ...paymentData,
        commission,
        paymentDestination: 'company_account',
        status: 'success',
        paymentDate: new Date(),
        payout: {
          status: 'pending'
        }
      }], { session });

      // Update provider/shop earnings
      if (providerId) {
        await ServiceProvider.findByIdAndUpdate(
          providerId,
          {
            $inc: {
              'earnings.total': commission.providerEarning,
              'earnings.pending': commission.providerEarning
            }
          },
          { session }
        );
      } else if (shopId) {
        await Shop.findByIdAndUpdate(
          shopId,
          {
            $inc: {
              'earnings.total': commission.providerEarning,
              'earnings.pending': commission.providerEarning
            }
          },
          { session }
        );
      }

      await session.commitTransaction();
      
      logger.info(`Company account payment processed: ${payment[0]._id}`);
      return payment[0];
      
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Company account payment failed: ${error.message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }

  async processPersonalAccountPayment(paymentData) {
    try {
      const { amount } = paymentData;
      const commission = this.calculateCommission(amount);
      
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + this.PENDING_COMMISSION_DAYS);

      const payment = await Payment.create({
        ...paymentData,
        commission,
        paymentDestination: 'personal_account',
        pendingCommission: {
          amount: commission.companyCommission,
          status: 'pending',
          dueDate: dueDate
        },
        status: 'success',
        paymentDate: new Date()
      });

      // Schedule commission reminder
      this.scheduleCommissionReminder(payment._id);

      logger.info(`Personal account payment processed: ${payment._id}`);
      return payment;
      
    } catch (error) {
      logger.error(`Personal account payment failed: ${error.message}`);
      throw error;
    }
  }

  async markServiceCompleted(bookingId, orderId = null) {
    const session = await Payment.startSession();
    session.startTransaction();

    try {
      let query = {};
      if (bookingId) query.booking = bookingId;
      if (orderId) query.order = orderId;

      const payment = await Payment.findOne(query).session(session);
      
      if (!payment) {
        throw new Error('Payment not found');
      }

      if (payment.paymentDestination === 'personal_account' && 
          payment.pendingCommission.status === 'pending') {
        
        payment.pendingCommission.status = 'paid';
        payment.pendingCommission.paidDate = new Date();
        await payment.save({ session });

        // Update provider/shop earnings
        if (payment.provider) {
          await ServiceProvider.findByIdAndUpdate(
            payment.provider,
            {
              $inc: {
                'earnings.total': payment.commission.providerEarning,
                'earnings.pending': payment.commission.providerEarning
              }
            },
            { session }
          );
        } else if (payment.shop) {
          await Shop.findByIdAndUpdate(
            payment.shop,
            {
              $inc: {
                'earnings.total': payment.commission.providerEarning,
                'earnings.pending': payment.commission.providerEarning
              }
            },
            { session }
          );
        }

        await this.sendCommissionCollectedNotification(payment);
      }

      await session.commitTransaction();
      logger.info(`Service completed and commission processed: ${payment._id}`);
      return payment;
      
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Mark service completed failed: ${error.message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }

  async initiatePayout(payoutData) {
    try {
      const { paymentId, recipientId, recipientType, amount } = payoutData;
      
      // Implement actual payout logic (RazorpayX, PayPal, etc.)
      const payoutResult = await this.processPayoutToBank(recipientId, amount);
      
      if (payoutResult.success) {
        await Payment.findByIdAndUpdate(paymentId, {
          'payout.status': 'completed',
          'payout.payoutDate': new Date(),
          'payout.payoutId': payoutResult.payoutId,
          $inc: { 'earnings.pending': -amount }
        });

        logger.info(`Payout completed: ${paymentId}`);
      } else {
        throw new Error(payoutResult.error || 'Payout failed');
      }
      
      return payoutResult;
    } catch (error) {
      await Payment.findByIdAndUpdate(paymentId, {
        'payout.status': 'failed',
        'payout.failureReason': error.message,
        $inc: { 'payout.retryCount': 1 },
        'payout.lastRetryAt': new Date()
      });
      
      logger.error(`Payout failed: ${paymentId} - ${error.message}`);
      throw error;
    }
  }

  async scheduleCommissionReminder(paymentId) {
    // Schedule reminders for 3 days before due date and on due date
    const payment = await Payment.findById(paymentId);
    if (!payment) return;

    const dueDate = new Date(payment.pendingCommission.dueDate);
    const reminderDate = new Date(dueDate);
    reminderDate.setDate(reminderDate.getDate() - 3);

    // Schedule reminder (you can use node-cron, agenda, or similar)
    setTimeout(async () => {
      await this.sendCommissionReminder(paymentId);
    }, reminderDate.getTime() - Date.now());
  }

  async sendCommissionReminder(paymentId) {
    try {
      const payment = await Payment.findById(paymentId)
        .populate('provider', 'name email phone')
        .populate('shop', 'name email phone')
        .populate('user', 'name');

      if (!payment || payment.pendingCommission.status !== 'pending') {
        return;
      }

      const recipient = payment.provider || payment.shop;
      const serviceType = payment.provider ? 'service' : 'order';

      await Notification.create({
        recipient: recipient._id,
        recipientModel: payment.provider ? 'ServiceProvider' : 'Shop',
        type: 'commission_reminder',
        title: 'Commission Payment Reminder',
        message: `Reminder: Please pay 15% commission (₹${payment.pendingCommission.amount}) for ${serviceType} completed for ${payment.user.name}. Due date: ${payment.pendingCommission.dueDate.toLocaleDateString()}`,
        data: {
          paymentId: payment._id,
          amount: payment.pendingCommission.amount,
          dueDate: payment.pendingCommission.dueDate,
          serviceType: serviceType
        },
        channels: {
          push: true,
          email: true,
          sms: true
        }
      });

      // Update reminder sent status
      payment.pendingCommission.reminderSent = true;
      payment.pendingCommission.remindersSent.push({
        sentAt: new Date(),
        type: 'email'
      });
      await payment.save();

      logger.info(`Commission reminder sent: ${payment._id}`);
    } catch (error) {
      logger.error(`Send commission reminder failed: ${error.message}`);
    }
  }

  async sendCommissionCollectedNotification(payment) {
    try {
      await Notification.create({
        recipient: 'admin', // Or specific admin user
        recipientModel: 'User',
        type: 'commission_collected',
        title: 'Commission Collected',
        message: `Commission of ₹${payment.pendingCommission.amount} collected for payment ${payment.transactionId}`,
        data: {
          paymentId: payment._id,
          amount: payment.pendingCommission.amount,
          collectedAt: new Date()
        },
        channels: {
          push: true,
          email: true
        }
      });

      logger.info(`Commission collected notification sent: ${payment._id}`);
    } catch (error) {
      logger.error(`Send commission collected notification failed: ${error.message}`);
    }
  }

  async getPendingCommissions(filters = {}) {
    const {
      period = 'month',
      page = 1,
      limit = 50,
      sortBy = 'pendingCommission.dueDate',
      sortOrder = 'asc'
    } = filters;

    const dateFilter = this.getDateFilter(period);
    const query = {
      'pendingCommission.status': 'pending',
      ...dateFilter
    };

    if (filters.providerId) query.provider = filters.providerId;
    if (filters.shopId) query.shop = filters.shopId;

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('user', 'name email phone')
        .populate('provider', 'name email phone')
        .populate('shop', 'name email phone')
        .populate('booking', 'bookingId serviceDetails')
        .populate('order', 'orderId items')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Payment.countDocuments(query)
    ]);

    const totalPendingAmount = payments.reduce((sum, payment) => {
      return sum + payment.pendingCommission.amount;
    }, 0);

    return {
      payments,
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        count: total,
        limit
      },
      summary: {
        totalPendingAmount: parseFloat(totalPendingAmount.toFixed(2)),
        totalPendingCommissions: total
      }
    };
  }

  getDateFilter(period) {
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

  // Mock payout processor - implement with actual payment gateway
  async processPayoutToBank(recipientId, amount) {
    // Implement with RazorpayX, PayPal Payouts, etc.
    return {
      success: true,
      payoutId: `pout_${Date.now()}`,
      amount: amount
    };
  }
}

module.exports = new CommissionService();