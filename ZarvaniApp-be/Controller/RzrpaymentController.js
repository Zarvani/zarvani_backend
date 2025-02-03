const RazorpayService = require('../services/razorpay.service');
const SubscriptionService = require('../services/subscription.service');
const Order = require('../Model/orderModel');
const Subscription = require('../Model/subscriptionModel');
const mongoose = require('mongoose');
class PaymentController {
  // Create a new order
  async createOrder(req, res) {
    try {
      const { planId, amount } = req.body;
      const userId = req.user.id; 
      // Create Razorpay order
      const razorpayOrder = await RazorpayService.createOrder(amount);

      // Save order details
      const order = new Order({
        userId,
        orderId: razorpayOrder.id,
        planId,
        amount,
        currency: razorpayOrder.currency,
      });
      await order.save();

      res.json({
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
      });
    } catch (error) {
      console.error('Order creation failed:', error);
      res.status(500).json({ error: 'Failed to create order' });
    }
  }

  // Verify payment and create subscription
  async verifyPayment(req, res) {
    try {
        const { orderId, paymentId, signature } = req.body;

        // Verify payment signature
        const isValid = RazorpayService.verifyPaymentSignature(orderId, paymentId, signature);

        if (!isValid) {
            throw new Error('Invalid payment signature');
        }

        // Fetch payment status from Razorpay
        const paymentDetails = await RazorpayService.fetchPaymentDetails(paymentId);

        if (paymentDetails.status !== 'captured') {
            throw new Error(`Payment status is not 'captured'. Current status: ${paymentDetails.status}`);
        }

        // Find and update the order
        const order = await Order.findOne({ orderId });
        if (!order) {
            throw new Error('Order not found');
        }

        // Update order status to 'paid'
        order.status = 'paid';
        order.paymentId = paymentId;
        order.signature = signature;
        await order.save();

        // Create subscription
        const subscription = await SubscriptionService.createSubscription(
            order.userId,
            order.planId,
            orderId,
            paymentId,
            order.amount
        );
        await SubscriptionService.addCreditForPlan(order.userId, order);
        res.json({ 
            success: true, 
            message: 'Payment verified and subscription created successfully', 
            subscription 
        });
    } catch (error) {
        console.error('Payment verification failed:', error);
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
}


  // Handle Razorpay webhooks
  async handleWebhook(req, res) {
    try {
      const signature = req.headers['x-razorpay-signature'];
      
      // Verify webhook signature
      const isValid = RazorpayService.verifyPaymentSignature(
        req.body.payload.payment.entity.order_id,
        req.body.payload.payment.entity.id,
        signature
      );

      if (!isValid) {
        throw new Error('Invalid webhook signature');
      }

      // Process webhook event
      const event = req.body.event;
      switch (event) {
        case 'payment.captured':
          // Handle successful payment
          break;
        case 'payment.failed':
          // Handle failed payment
          break;
        // Add more event handlers as needed
      }

      res.json({ received: true });
    } catch (error) {
      console.error('Webhook processing failed:', error);
      res.status(400).json({ error: error.message });
    }
  }
  async verifySubscription(req, res) {
    try {
        const userId = req.user.id;

        // Find the most recent subscription for the user
        const subscription = await Subscription.findOne({ userId })
            .sort({ createdAt: -1 }) 
            .lean(); 

        if (!subscription) {
          return res.status(200).json({
            success: true,
            message: 'No subscription found for the user',
            subscription: null, 
        });
        }

        // Calculate subscription status based on the current date
        const currentDate = new Date();
        const isExpired = currentDate > new Date(subscription.endDate);
        const subscriptionStatus = isExpired ? 'expired' : subscription.status;

        // Build response with detailed subscription info
        res.status(200).json({
            success: true,
            subscription: {
                userId: subscription.userId,
                planId: subscription.planId,
                status: subscriptionStatus,
                startDate: subscription.startDate,
                endDate: subscription.endDate,
                credit: subscription.credit,
                paymentId: subscription.paymentId,
                orderId: subscription.orderId,
                amount: subscription.amount,
                createdAt: subscription.createdAt,
                updatedAt: subscription.updatedAt,
            },
        });
    } catch (error) {
        console.error('Error verifying subscription:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred while verifying the subscription',
            error: error.message,
        });
    }
}


  
}
module.exports = new PaymentController();