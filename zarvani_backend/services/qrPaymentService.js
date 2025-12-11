const QRCode = require('qrcode');
const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const Order = require('../models/Order');
const ServiceProvider = require('../models/ServiceProvider');
const Shop = require('../models/Shop');
const logger = require('../utils/logger');

class QRPaymentService {
  
  // ✅ NEW: Generate payment QR with destination choice
  static async generatePaymentQR(data) {
    try {
      const {
        bookingId,
        orderId,
        amount,
        userId,
        paymentDestination = 'company_account', // Default to company account
        providerId,
        shopId
      } = data;
      
      // Validate required fields
      if (!amount || amount <= 0) {
        throw new Error('Valid amount is required');
      }
      
      // Verify booking/order exists and belongs to user
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
      
      // Create payment record
      const payment = await Payment.create({
        transactionId: `QR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        booking: bookingId,
        order: orderId,
        user: userId,
        provider: providerId,
        shop: shopId,
        amount,
        paymentMethod: 'qr',
        paymentDestination,
        status: 'pending'
      });
      
      // Calculate commission
      await payment.calculateCommission();
      
      // Generate QR code
      const qrData = await payment.generateQRCode();
      await payment.save();
      
      logger.info(`QR generated for payment: ${payment._id}, destination: ${paymentDestination}`);
      
      return {
        payment,
        qrData: {
          qrImageUrl: qrData.qrImageUrl,
          upiDeepLink: qrData.upiDeepLink,
          upiId: qrData.upiId,
          amount: qrData.amount,
          expiresAt: qrData.expiresAt,
          isCompanyQR: qrData.isCompanyQR
        }
      };
    } catch (error) {
      logger.error(`Generate payment QR error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: Generate collection QR for provider/shop
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
      
      // Update payment destination
      payment.paymentDestination = destination;
      payment.paymentMethod = 'qr';
      
      // Calculate commission for new destination
      await payment.calculateCommission();
      
      // Generate QR code
      const qrData = await payment.generateQRCode();
      await payment.save();
      
      logger.info(`Collection QR generated for payment: ${payment._id}, destination: ${destination}`);
      
      return {
        payment,
        qrData: {
          qrImageUrl: qrData.qrImageUrl,
          upiDeepLink: qrData.upiDeepLink,
          upiId: qrData.upiId,
          amount: qrData.amount,
          expiresAt: qrData.expiresAt,
          isCompanyQR: qrData.isCompanyQR
        }
      };
    } catch (error) {
      logger.error(`Generate collection QR error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: UPI Payment Webhook Handler
  static async handleUPIWebhook(webhookData) {
    try {
      const {
        transactionId,
        upiId,
        amount,
        status,
        timestamp,
        referenceId,
        payerUpiId,
        payerName
      } = webhookData;
      
      // Find payment by UPI ID and amount
      const payment = await Payment.findOne({
        $or: [
          { 'qrPayment.upiId': upiId },
          { 'qrPayment.upiId': payerUpiId }
        ],
        amount: amount,
        status: 'pending'
      }).populate('provider shop user');
      
      if (!payment) {
        logger.warn(`No pending payment found for UPI: ${upiId}, amount: ${amount}`);
        return null;
      }
      
      // Check if QR is expired
      if (payment.isQRExpired()) {
        payment.status = 'expired';
        payment.qrPayment.status = 'expired';
        await payment.save();
        throw new Error('QR code expired');
      }
      
      if (status === 'success') {
        // Process successful payment
        await payment.processPaymentSuccess(transactionId, new Date(timestamp));
        
        // Update related booking/order
        await this.updateRelatedEntityStatus(payment);
        
        // Send notifications
        await this.sendPaymentNotifications(payment);
        
        logger.info(`UPI payment successful: ${transactionId} for payment: ${payment._id}`);
      } else {
        // Handle failed payment
        payment.status = 'failed';
        payment.qrPayment.status = 'expired';
        await payment.save();
        
        logger.info(`UPI payment failed: ${transactionId} for payment: ${payment._id}`);
      }
      
      return payment;
    } catch (error) {
      logger.error(`UPI webhook error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: Manual UPI payment verification
  static async verifyManualUPIPayment(paymentId, verificationData) {
    try {
      const {
        transactionId,
        screenshot,
        notes,
        verifiedBy
      } = verificationData;
      
      const payment = await Payment.findById(paymentId);
      
      if (!payment) {
        throw new Error('Payment not found');
      }
      
      if (payment.status !== 'pending') {
        throw new Error('Payment already processed');
      }
      
      // Mark as manually verified
      payment.status = 'success';
      payment.paymentDate = new Date();
      payment.verified = true;
      payment.upiPayment = {
        transactionId,
        status: 'success',
        verifiedAt: new Date(),
        verificationMethod: 'manual'
      };
      payment.qrPayment.status = 'paid';
      
      // Process commission
      if (payment.paymentDestination === 'company_account') {
        await payment.initiatePayout();
      } else {
        await payment.recordPendingCommission();
      }
      
      await payment.save();
      
      // Update related entity
      await this.updateRelatedEntityStatus(payment);
      
      logger.info(`Manual UPI verification for payment: ${paymentId} by: ${verifiedBy}`);
      
      return payment;
    } catch (error) {
      logger.error(`Manual UPI verification error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: Update related booking/order status
  static async updateRelatedEntityStatus(payment) {
    try {
      if (payment.booking) {
        const booking = await Booking.findById(payment.booking);
        if (booking) {
          booking.payment = payment._id;
          booking.status = payment.paymentType === 'service' ? 'completed' : 'confirmed';
          await booking.save();
        }
      }
      
      if (payment.order) {
        const order = await Order.findById(payment.order);
        if (order) {
          order.payment.status = 'paid';
          order.payment.paidAt = new Date();
          order.payment.transactionId = payment.transactionId;
          order.status = 'confirmed';
          await order.save();
        }
      }
      
      logger.info(`Related entity status updated for payment: ${payment._id}`);
    } catch (error) {
      logger.error(`Update related entity status error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: Send payment notifications
  static async sendPaymentNotifications(payment) {
    try {
      const NotificationService = require('./pushNotification');
      const EmailService = require('./emailService');
      
      // Notify user
      await NotificationService.sendToUser(
        payment.user,
        'Payment Successful',
        `Your payment of ₹${payment.amount} was successful. Thank you for your business!`
      );
      
      // Notify provider/shop
      const owner = await payment.getPaymentOwner();
      if (owner) {
        let message = '';
        let subject = '';
        
        if (payment.paymentDestination === 'company_account') {
          const earning = payment.paymentType === 'service' ? 
            payment.commission.providerEarning : 
            payment.commission.shopEarning;
          
          subject = 'Payment Received - Commission Deducted';
          message = `Payment of ₹${payment.amount} received. Your earning after commission: ₹${earning} will be transferred to your account.`;
        } else {
          subject = 'Payment Received - Pending Commission';
          message = `Payment of ₹${payment.amount} received directly to your account. Pending commission: ₹${payment.commission.pendingCommission} due by ${payment.pendingCommission.dueDate.toDateString()}.`;
        }
        
        await NotificationService.sendToUser(owner._id, subject, message);
        
        // Send email to owner
        if (owner.email) {
          await EmailService.sendPaymentReceipt({
            to: owner.email,
            amount: payment.amount,
            transactionId: payment.transactionId,
            date: payment.paymentDate,
            commission: payment.commission,
            paymentDestination: payment.paymentDestination
          });
        }
      }
      
      logger.info(`Payment notifications sent for payment: ${payment._id}`);
    } catch (error) {
      logger.error(`Send payment notifications error: ${error.message}`);
      // Don't throw error, just log it
    }
  }
  
  // ✅ NEW: Check and expire old QR codes
  static async expireOldQRCodes() {
    try {
      const expiredPayments = await Payment.updateMany(
        {
          'qrPayment.expiresAt': { $lt: new Date() },
          'qrPayment.status': 'generated',
          status: 'pending'
        },
        {
          'qrPayment.status': 'expired',
          status: 'expired'
        }
      );
      
      logger.info(`Expired QR check completed. Updated: ${expiredPayments.modifiedCount} payments`);
      return expiredPayments.modifiedCount;
    } catch (error) {
      logger.error(`Expire old QR codes error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: Get QR payment status
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
      
      const owner = await payment.getPaymentOwner();
      
      return {
        paymentId: payment._id,
        transactionId: payment.transactionId,
        status: payment.status,
        qrStatus: payment.qrPayment.status,
        amount: payment.amount,
        paymentDestination: payment.paymentDestination,
        paymentType: payment.paymentType,
        commission: {
          total: payment.totalCommission,
          pending: payment.commission.pendingCommission,
          ownerEarning: payment.netEarning
        },
        qrData: {
          upiId: payment.qrPayment.upiId,
          upiDeepLink: payment.qrPayment.upiDeepLink,
          expiresAt: payment.qrPayment.expiresAt,
          isExpired: payment.isQRExpired()
        },
        owner: owner ? {
          id: owner._id,
          name: owner.name,
          type: payment.getOwnerType()
        } : null,
        verification: payment.paymentVerification,
        payout: payment.payout
      };
    } catch (error) {
      logger.error(`Get QR payment status error: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ NEW: Generate UPI deep link for manual payment
  static async generateUPIDeepLink(data) {
    try {
      const { upiId, name, amount, transactionNote } = data;
      
      if (!upiId || !amount) {
        throw new Error('UPI ID and amount are required');
      }
      
      const transactionId = `UPI-${Date.now()}`;
      const deepLink = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(name || 'Payment')}&am=${amount}&cu=INR&tn=${encodeURIComponent(transactionNote || 'Payment')}&tr=${transactionId}`;
      
      return {
        deepLink,
        transactionId,
        upiId,
        amount
      };
    } catch (error) {
      logger.error(`Generate UPI deep link error: ${error.message}`);
      throw error;
    }
  }
}

module.exports = QRPaymentService;