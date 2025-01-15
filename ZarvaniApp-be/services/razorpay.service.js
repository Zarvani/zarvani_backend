const Razorpay = require('razorpay');
const crypto = require('crypto');

class RazorpayService {
  // Initialize Razorpay with dynamic keys
  initializeRazorpay() {
    return new Razorpay({
      key_id: "rzp_test_TzdLYDjiaegAyF",
      key_secret:"wxg4P62dyQoeldMFUOxnaNdg",
    });
  }

  // Create an order
  async createOrder(amount, currency = 'INR') {
    try {
      const razorpay = this.initializeRazorpay(); // Initialize Razorpay with keys
      const order = await razorpay.orders.create({
        amount: amount * 100, // Convert to smallest currency unit
        currency,
      });

      return order;
    } catch (error) {
      console.error('Razorpay order creation failed:', error);
      throw error;
    }
  }

  // Verify payment signature
  verifyPaymentSignature(orderId, paymentId, signature) {
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    return generatedSignature === signature;
  }

  // Fetch payment details
  async fetchPaymentDetails(paymentId) {
    try {
      const razorpay = this.initializeRazorpay(); // Initialize Razorpay with keys
      const paymentDetails = await razorpay.payments.fetch(paymentId);
      return paymentDetails;
    } catch (error) {
      console.error('Failed to fetch payment details:', error);
      throw error;
    }
  }
}

module.exports = new RazorpayService();
