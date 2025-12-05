const QRCode = require('qrcode');
const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const Order = require('../models/Order');
const ServiceProvider = require('../models/ServiceProvider');
const Shop = require('../models/Shop');
const logger = require('../utils/logger');

class QRPaymentService {
  
  // Generate QR for user payment (always company account)
  static async generateUserQRPayment(bookingId, orderId, amount, userId) {
    try {
      // Validate booking/order exists and belongs to user
      if (bookingId) {
        const booking = await Booking.findOne({ _id: bookingId, user: userId });
        if (!booking) {
          throw new Error('Booking not found or unauthorized');
        }
      }
      
      if (orderId) {
        const order = await Order.findOne({ _id: orderId, user: userId });
        if (!order) {
          throw new Error('Order not found or unauthorized');
        }
      }

      const payment = await Payment.create({
        transactionId: `QR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        booking: bookingId,
        order: orderId,
        user: userId,
        amount,
        paymentMethod: 'qr',
        paymentDestination: 'company_account',
        status: 'pending'
      });

      const qrData = await payment.generateQRCode();
      await payment.processCommission();
      await payment.save();

      logger.info(`User QR generated for payment: ${payment._id}`);
      return qrData;
    } catch (error) {
      logger.error(`Generate user QR error: ${error.message}`);
      throw error;
    }
  }

  // Generate QR for provider/shop collection
  static async generateCollectionQR(paymentId, destination, ownerId, ownerType) {
    try {
      const payment = await Payment.findById(paymentId);
      
      if (!payment) {
        throw new Error('Payment not found');
      }

      // Verify ownership
      let isOwner = false;
      if (ownerType === 'provider' && payment.provider?.toString() === ownerId.toString()) {
        isOwner = true;
      } else if (ownerType === 'shop' && payment.shop?.toString() === ownerId.toString()) {
        isOwner = true;
      }

      if (!isOwner) {
        throw new Error('Unauthorized to generate collection QR');
      }

      payment.paymentDestination = destination;
      payment.paymentMethod = 'qr';
      
      if (destination === 'personal_account') {
        // Calculate pending commission
        payment.commission.pendingCommissionRate = 20;
        payment.paymentVerification.status = 'pending';
        payment.paymentVerification.dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      }
      
      await payment.save();
      await payment.processCommission();
      
      const qrData = await payment.generateQRCode();
      
      logger.info(`Collection QR generated for payment: ${payment._id}, destination: ${destination}`);
      return { qrData, payment };
    } catch (error) {
      logger.error(`Generate collection QR error: ${error.message}`);
      throw error;
    }
  }

  // Verify UPI Payment (Webhook from Razorpay/UPI)
  static async verifyUPIPayment(transactionId, upiId, amount, timestamp) {
    try {
      const payment = await Payment.findOne({
        'qrPayment.upiId': upiId,
        'qrPayment.amount': amount,
        status: 'pending',
        'qrPayment.expiresAt': { $gt: new Date() }
      }).populate('provider shop user');

      if (!payment) {
        throw new Error('Payment not found or expired');
      }

      payment.status = 'success';
      payment.gatewayTransactionId = transactionId;
      payment.paymentDate = new Date(timestamp);
      payment.qrPayment.status = 'paid';
      payment.verified = true;

      // Process commission based on payment destination
      if (payment.paymentDestination === 'company_account') {
        await this.processCompanyAccountPayment(payment);
      } else {
        await this.processPersonalAccountPayment(payment);
      }

      await payment.save();

      // Update booking/order status
      await this.updateRelatedEntityStatus(payment);

      // Send notifications
      await this.sendPaymentSuccessNotifications(payment);

      logger.info(`UPI payment verified: ${transactionId} for payment: ${payment._id}`);
      return payment;
    } catch (error) {
      logger.error(`UPI payment verification error: ${error.message}`);
      throw error;
    }
  }

  static async processCompanyAccountPayment(payment) {
    try {
      // Commission already calculated in processCommission method
      // Initiate automatic payout to provider/shop
      await this.initiatePayout(payment);
      
      logger.info(`Company account payment processed: ${payment._id}`);
    } catch (error) {
      logger.error(`Process company account payment error: ${error.message}`);
      throw error;
    }
  }

  static async processPersonalAccountPayment(payment) {
    try {
      // For personal account, commission is pending
      // Send notification about pending commission
      await this.sendPendingCommissionNotification(payment);
      
      logger.info(`Personal account payment processed: ${payment._id}, pending commission: ${payment.commission.pendingCommission}`);
    } catch (error) {
      logger.error(`Process personal account payment error: ${error.message}`);
      throw error;
    }
  }

  static async initiatePayout(payment) {
    try {
      const owner = await payment.getPaymentOwner();
      
      if (owner && owner.bankDetails) {
        // Simulate Razorpay payout process
        payment.payout = {
          status: 'processing',
          payoutDate: new Date()
        };

        // In real implementation, integrate with Razorpay Payouts API
        // const razorpay = require('razorpay');
        // const payout = await razorpay.payouts.create({
        //   account_number: owner.bankDetails.accountNumber,
        //   fund_account_id: owner.razorpayContactId,
        //   amount: payment.commission.providerEarning * 100, // in paise
        //   currency: 'INR',
        //   mode: 'IMPS',
        //   purpose: 'payout'
        // });

        logger.info(`Payout initiated for payment: ${payment._id}, amount: ${payment.commission.providerEarning}`);
      }
    } catch (error) {
      logger.error(`Payout initiation error: ${error.message}`);
      payment.payout.status = 'failed';
      payment.payout.failureReason = error.message;
      await payment.save();
    }
  }

  static async sendPendingCommissionNotification(payment) {
    try {
      const owner = await payment.getPaymentOwner();
      const NotificationService = require('./pushNotification');
      
      await NotificationService.sendToUser(
        owner._id,
        'Pending Commission',
        `You have received payment of ₹${payment.amount}. Pending commission: ₹${payment.commission.pendingCommission} due by ${payment.paymentVerification.dueDate.toDateString()}`
      );

      logger.info(`Pending commission notification sent for payment: ${payment._id}`);
    } catch (error) {
      logger.error(`Send pending commission notification error: ${error.message}`);
    }
  }

  static async sendPaymentSuccessNotifications(payment) {
    try {
      const NotificationService = require('./pushNotification');
      
      // Notify user
      await NotificationService.sendToUser(
        payment.user,
        'Payment Successful',
        `Your payment of ₹${payment.amount} was successful. Thank you for your business!`
      );
      
      // Notify provider/shop
      const owner = await payment.getPaymentOwner();
      if (owner) {
        let message = `Payment of ₹${payment.amount} received successfully.`;
        
        if (payment.paymentDestination === 'personal_account') {
          message += ` Pending commission: ₹${payment.commission.pendingCommission} due by ${payment.paymentVerification.dueDate.toDateString()}`;
        } else {
          message += ` Your earnings: ₹${payment.commission.providerEarning} will be transferred shortly.`;
        }
        
        await NotificationService.sendToUser(owner._id, 'Payment Received', message);
      }

      logger.info(`Payment success notifications sent for payment: ${payment._id}`);
    } catch (error) {
      logger.error(`Send payment success notifications error: ${error.message}`);
    }
  }

  static async updateRelatedEntityStatus(payment) {
    try {
      if (payment.booking) {
        await Booking.findByIdAndUpdate(payment.booking, {
          status: 'completed',
          payment: payment._id
        });
      }
      
      if (payment.order) {
        await Order.findByIdAndUpdate(payment.order, {
          status: 'delivered',
          payment: payment._id,
          'timestamps.deliveredAt': new Date()
        });
      }

      logger.info(`Related entity status updated for payment: ${payment._id}`);
    } catch (error) {
      logger.error(`Update related entity status error: ${error.message}`);
    }
  }

  // Check for expired QR codes
  static async checkExpiredQRs() {
    try {
      const expiredPayments = await Payment.updateMany(
        {
          'qrPayment.expiresAt': { $lt: new Date() },
          'qrPayment.status': 'generated',
          status: 'pending'
        },
        {
          'qrPayment.status': 'expired',
          status: 'failed'
        }
      );

      logger.info(`Expired QR check completed. Updated: ${expiredPayments.modifiedCount} payments`);
      return expiredPayments.modifiedCount;
    } catch (error) {
      logger.error(`Check expired QR error: ${error.message}`);
      throw error;
    }
  }

  // Get QR payment status
  static async getQRPaymentStatus(paymentId, userId) {
    try {
      const payment = await Payment.findOne({
        _id: paymentId,
        $or: [
          { user: userId },
          { provider: userId },
          { shop: userId }
        ]
      });

      if (!payment) {
        throw new Error('Payment not found or unauthorized');
      }

      return {
        status: payment.status,
        qrStatus: payment.qrPayment.status,
        amount: payment.amount,
        paymentDestination: payment.paymentDestination,
        commission: payment.commission,
        paymentVerification: payment.paymentVerification
      };
    } catch (error) {
      logger.error(`Get QR payment status error: ${error.message}`);
      throw error;
    }
  }
}

module.exports = QRPaymentService;