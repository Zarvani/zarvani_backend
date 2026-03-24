// ============= queues/stockTtlQueue.js =============
const Bull = require('bull');
const logger = require('../utils/logger');
const Order = require('../models/Order');
const Product = require('../models/Product');
const mongoose = require('mongoose');

const stockTtlQueue = new Bull('stock-ttl', {
    redis: { port: 6379, host: '127.0.0.1' }
});

// Process stock release
stockTtlQueue.process(async (job) => {
    const { orderId } = job.data;
    logger.info(`Checking stock TTL for Order: ${orderId}`);

    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const order = await Order.findById(orderId).session(session);
        
        // If order doesn't exist or is already paid/cancelled, don't release stock
        if (!order || order.paymentStatus !== 'pending' || order.status !== 'pending') {
            logger.info(`Stock TTL skipped for Order ${orderId}: Status is ${order?.status}`);
            await session.commitTransaction();
            return;
        }

        // Release stock for each product in the order
        for (const item of order.items) {
            await Product.findByIdAndUpdate(
                item.product,
                { $inc: { 'stock.quantity': item.quantity } },
                { session }
            );
        }

        // Move order to "expired" status
        order.status = 'cancelled';
        order.cancellationReason = 'Payment timeout (Stock released)';
        await order.save({ session });

        await session.commitTransaction();
        logger.info(`✅ Stock RELEASED for Order ${orderId} due to timeout`);
    } catch (error) {
        await session.abortTransaction();
        logger.error(`❌ Stock TTL Error for Order ${orderId}: ${error.message}`);
        throw error;
    } finally {
        session.endSession();
    }
});

module.exports = {
    addStockReleaseJob: (orderId, delay = 600000) => { // Default 10 mins
        stockTtlQueue.add({ orderId }, { delay });
    }
};
