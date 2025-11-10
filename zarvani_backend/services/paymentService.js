
// ============= services/paymentService.js =============
const crypto = require('crypto');
const axios = require('axios');
const logger = require('../utils/logger');

class PaymentService {
  // Razorpay integration
  static async createRazorpayOrder(amount, currency = 'INR', receipt) {
    try {
      const auth = Buffer.from(
        `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
      ).toString('base64');
      
      const response = await axios.post(
        'https://api.razorpay.com/v1/orders',
        {
          amount: amount * 100, // Convert to paise
          currency,
          receipt
        },
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return {
        success: true,
        order: response.data
      };
    } catch (error) {
      logger.error(`Razorpay order creation error: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  static verifyRazorpaySignature(orderId, paymentId, signature) {
    const text = `${orderId}|${paymentId}`;
    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(text)
      .digest('hex');
    
    return generated_signature === signature;
  }
  
  static async captureRazorpayPayment(paymentId, amount) {
    try {
      const auth = Buffer.from(
        `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
      ).toString('base64');
      
      const response = await axios.post(
        `https://api.razorpay.com/v1/payments/${paymentId}/capture`,
        {
          amount: amount * 100,
          currency: 'INR'
        },
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return {
        success: true,
        payment: response.data
      };
    } catch (error) {
      logger.error(`Payment capture error: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  static async initiateRefund(paymentId, amount, reason) {
    try {
      const auth = Buffer.from(
        `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
      ).toString('base64');
      
      const response = await axios.post(
        'https://api.razorpay.com/v1/refunds',
        {
          payment_id: paymentId,
          amount: amount * 100,
          notes: { reason }
        },
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return {
        success: true,
        refund: response.data
      };
    } catch (error) {
      logger.error(`Refund error: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Generate invoice
  static generateInvoice(bookingDetails) {
    // This is a placeholder - implement actual invoice generation
    // You can use libraries like pdfkit or integrate with invoice services
    return {
      invoiceNumber: `INV-${Date.now()}`,
      date: new Date(),
      amount: bookingDetails.totalAmount
    };
  }
}

module.exports = PaymentService;
