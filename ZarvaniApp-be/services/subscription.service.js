const Subscription = require('../Model/subscriptionModel');
const Order = require('../Model/orderModel');

class SubscriptionService {
  // Calculate subscription end date based on plan
  calculateEndDate(planId) {
    const now = new Date();
    return new Date(now.setMonth(now.getMonth() + 3)); // 3 months validity
  }

  // Create a new subscription
  async createSubscription(userId, planId, orderId, paymentId, amount) {
    try {
      const endDate = this.calculateEndDate(planId);
      
      const subscription = new Subscription({
        userId,
        planId,
        endDate,
        orderId,
        paymentId,
        amount,
      });

      return await subscription.save();
    } catch (error) {
      console.error('Subscription creation failed:', error);
      throw error;
    }
  }

  // Check if user has active subscription
  async hasActiveSubscription(userId) {
    try {
      const subscription = await Subscription.findOne({
        userId,
        status: 'active',
        endDate: { $gt: new Date() },
      });
      return !!subscription;
    } catch (error) {
      console.error('Subscription check failed:', error);
      throw error;
    }
  }

  async addCreditForPlan(userId, order) {
    try {
        const { planId, amount, status } = order;
        console.log('Plan Details:', planId, amount, status);

        // Get the most recent subscription
        const subscribeModel = await Subscription.findOne({ userId }).sort({ createdAt: -1 });
        if (!subscribeModel) {
            throw new Error('Subscription not found');
        }

        if (status !== 'paid') {
            throw new Error('Order is not paid');
        }

        // Get current credit value before updating
        const currentCredit = subscribeModel.credit || 0;

        // Add credits based on plan (keeping existing credits)
        switch (planId) {
            case 'basic':
                if (amount === 10000) {
                  
                    subscribeModel.credit = currentCredit + 3;
                }
                break;
            case 'standard':
                if (amount === 20000) {
                  
                    subscribeModel.credit =  currentCredit + 6;
                }
                break;
            case 'premium':
                if (amount === 50000) {
      
                    subscribeModel.credit = -1;
                }
                break;
            default:
                throw new Error('Invalid plan or amount');
        }

        console.log('Updated Credit:', subscribeModel.credit);
        await subscribeModel.save();
        return subscribeModel;
    } catch (error) {
        console.error('Credit Update Error:', error);
        throw new Error(`Failed to add credits: ${error.message}`);
    }
}
}



module.exports = new SubscriptionService();