const Order = require('../models/Order');
const Shop = require('../models/Shop');
const Product = require('../models/Product');
const User = require('../models/User');
const ResponseHandler = require('../utils/responseHandler');
const OrderService = require('../services/orderService');
const logger = require('../utils/logger');
const mongoose = require('mongoose');
const CacheService = require('../services/cacheService');
const CacheInvalidationService = require('../services/cacheInvalidationService');
const { batchLoadAndAttach, batchLoadNested } = require('../utils/batchLoader');

// Helper: Generate unique order ID
const generateOrderId = () => {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `ORD${timestamp}${random}`;
};

// Helper: Calculate delivery fee
const calculateDeliveryFee = (shop, distance, orderAmount) => {
  const settings = shop.deliverySettings;

  // Check for free delivery
  if (orderAmount >= settings.deliveryFee.freeDeliveryAbove) {
    return 0;
  }

  // Base fee + per km charge
  let fee = settings.deliveryFee.baseFee;
  if (distance > 1) { // First km free or included in base
    fee += Math.ceil(distance - 1) * settings.deliveryFee.perKm;
  }

  // Cap at maximum if needed
  const maxFee = settings.deliveryFee.baseFee +
    (settings.radius * settings.deliveryFee.perKm);
  return Math.min(fee, maxFee);
};

// ==================== USER ORDER FLOW ====================

// 1. Create New Order
exports.createOrder = async (req, res) => {
  try {
    const order = await OrderService.createOrder({
      userId: req.user._id,
      body: req.body,
      platformInfo: {
        platform: req.headers['x-platform'] || 'app',
        device: {
          platform: req.headers['x-device-platform'] || 'unknown',
          version: req.headers['x-app-version'] || '1.0.0'
        }
      }
    }, req.app);

    ResponseHandler.success(res, { order }, 'Order placed successfully', 201);
  } catch (error) {
    logger.error(`Create order error: ${error.message}`);
    ResponseHandler.error(res, error.message, 400);
  }
};


// 2. Shop Accepts Order
exports.acceptOrder = async (req, res) => {
  try {
    const order = await OrderService.acceptOrder(req.params.orderId, req.user._id, req.app);
    ResponseHandler.success(res, { order }, 'Order accepted successfully');
  } catch (error) {
    logger.error(`Accept order error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// 3. Shop Rejects Order
// 3. Shop Rejects Order
exports.rejectOrder = async (req, res) => {
  try {
    const order = await OrderService.rejectOrder(req.params.orderId, req.user._id, req.body.reason, req.app);
    ResponseHandler.success(res, { order }, 'Order rejected successfully');
  } catch (error) {
    logger.error(`Reject order error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// 4. Update Order Status (Shop: Preparing, Ready, Packed, etc.)

// 4. Update Order Status
exports.updateOrderStatus = async (req, res) => {
  try {
    const order = await OrderService.updateStatus(req.params.orderId, req.user._id, req.body.status, req.app);
    ResponseHandler.success(res, { order }, `Order status updated to ${req.body.status}`);
  } catch (error) {
    logger.error(`Update status error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};


// 5. Delivery Boy Picks Up Order
exports.pickupOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { latitude, longitude, address } = req.body;
    const deliveryBoyId = req.user._id;

    const order = await Order.findOne({
      _id: orderId,
      deliveryBoy: deliveryBoyId,
      status: 'ready'
    });

    if (!order) {
      return ResponseHandler.error(res, 'Order not found or not ready for pickup', 404);
    }

    // Update delivery boy location
    const shop = await Shop.findById(order.shop);
    const deliveryBoy = shop.deliveryBoys.id(deliveryBoyId);

    if (deliveryBoy) {
      deliveryBoy.currentLocation = {
        type: 'Point',
        coordinates: [longitude, latitude],
        address: address,
        updatedAt: new Date()
      };
      await shop.save();
    }

    // Update order
    order.status = 'out_for_delivery';
    order.timestamps.pickedUpAt = new Date();
    order.timestamps.outForDeliveryAt = new Date();
    order._updatedBy = 'delivery_boy';

    await order.updateDeliveryBoyLocation(latitude, longitude, address);
    await order.save();

    // Update shop stats
    await Shop.findByIdAndUpdate(order.shop, {
      $inc: {
        'orderStats.ready': -1,
        'orderStats.outForDelivery': 1
      }
    });

    // Send notifications
    await PushNotificationService.sendToUser(
      order.user,
      'Out for Delivery',
      `Your order is on the way! Estimated delivery: ${order.tracking.estimatedDeliveryTime ? new Date(order.tracking.estimatedDeliveryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Soon'}`
    );

    ResponseHandler.success(res, { order }, 'Order picked up successfully');

  } catch (error) {
    logger.error(`Pickup order error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// 6. Update Delivery Location (Real-time tracking)
exports.updateDeliveryLocation = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { latitude, longitude, address } = req.body;
    const deliveryBoyId = req.user._id;

    const order = await Order.findOne({
      _id: orderId,
      deliveryBoy: deliveryBoyId,
      status: 'out_for_delivery'
    });

    if (!order) {
      return ResponseHandler.error(res, 'Order not found', 404);
    }

    // Update shop's delivery boy location
    const shop = await Shop.findById(order.shop);
    const deliveryBoy = shop.deliveryBoys.id(deliveryBoyId);

    if (deliveryBoy) {
      deliveryBoy.currentLocation = {
        type: 'Point',
        coordinates: [longitude, latitude],
        address: address,
        updatedAt: new Date()
      };
      await shop.save();
    }

    // Update order tracking
    await order.updateDeliveryBoyLocation(latitude, longitude, address);

    // Check if delivery boy is close to destination (within 500m)
    const distanceToUser = order.tracking.distance.boyToUser;
    if (distanceToUser < 0.5 && order.status !== 'arriving') {
      order.status = 'arriving';
      order.timestamps.arrivingAt = new Date();
      order._updatedBy = 'system';
      await order.save();

      await PushNotificationService.sendToUser(
        order.user,
        'Delivery Partner Arriving',
        'Your delivery partner is arriving in 2-3 minutes!'
      );
    }

    ResponseHandler.success(res, {
      distance: distanceToUser,
      eta: order.tracking.estimatedDeliveryTime,
      status: order.status
    }, 'Location updated');

  } catch (error) {
    logger.error(`Update delivery location error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// 7. Mark Order as Delivered
exports.markDelivered = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderId } = req.params;
    const { otp } = req.body;
    const deliveryBoyId = req.user._id;

    const order = await Order.findOne({
      _id: orderId,
      deliveryBoy: deliveryBoyId,
      status: { $in: ['out_for_delivery', 'arriving'] }
    }).session(session);

    if (!order) {
      await session.abortTransaction();
      return ResponseHandler.error(res, 'Order not found', 404);
    }

    // Verify OTP (optional)
    if (order.deliveryInfo.otp && otp !== order.deliveryInfo.otp.code) {
      await session.abortTransaction();
      return ResponseHandler.error(res, 'Invalid OTP', 400);
    }

    if (order.deliveryInfo.otp) {
      order.deliveryInfo.otp.verified = true;
    }

    // Update order
    order.status = 'delivered';
    order.timestamps.deliveredAt = new Date();
    order._updatedBy = 'delivery_boy';
    order.payment.status = order.payment.method === 'cod' ? 'paid' : order.payment.status;
    order.payment.paidAt = new Date();

    // Update shop stats
    await Shop.findByIdAndUpdate(
      order.shop,
      {
        $inc: {
          'orderStats.outForDelivery': -1,
          'orderStats.delivered': 1,
          'earnings.pending': order.payment.method === 'cod' ? -order.pricing.totalAmount : 0
        }
      },
      { session }
    );

    // Update delivery boy stats
    const shop = await Shop.findById(order.shop).session(session);
    const deliveryBoy = shop.deliveryBoys.id(deliveryBoyId);

    if (deliveryBoy) {
      // Remove order from assigned orders
      deliveryBoy.assignedOrders = deliveryBoy.assignedOrders.filter(
        order => order.toString() !== orderId
      );

      // Update stats
      deliveryBoy.totalDeliveries += 1;
      deliveryBoy.earnings.today += order.pricing.deliveryFee;
      deliveryBoy.earnings.weekly += order.pricing.deliveryFee;
      deliveryBoy.earnings.monthly += order.pricing.deliveryFee;
      deliveryBoy.earnings.total += order.pricing.deliveryFee;

      // Update status if no more assigned orders
      if (deliveryBoy.assignedOrders.length === 0) {
        deliveryBoy.status = 'active';
      }

      await shop.save({ session });
    }

    // Update user stats
    await User.findByIdAndUpdate(
      order.user,
      {
        $inc: {
          'orderStats.totalOrders': 1,
          'orderStats.totalSpent': order.pricing.totalAmount,
          'loyaltyPoints': Math.floor(order.pricing.totalAmount / 10) // 1 point per ₹10
        }
      },
      { session }
    );

    await order.save({ session });
    await session.commitTransaction();

    // Invalidate cache
    await CacheInvalidationService.invalidateOrder(order).catch(e => logger.error(`Cache invalidation error: ${e.message}`));

    // Send notifications
    await PushNotificationService.sendToUser(
      order.user,
      'Order Delivered',
      `Your order #${order.orderId} has been delivered successfully!`
    );

    await PushNotificationService.sendToShop(
      order.shop,
      'Order Delivered',
      `Order #${order.orderId} delivered successfully`
    );

    ResponseHandler.success(res, { order }, 'Order delivered successfully');

  } catch (error) {
    await session.abortTransaction();
    logger.error(`Mark delivered error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  } finally {
    session.endSession();
  }
};
// ==================== MARK ORDER AS PAID (PERSONAL PAYMENT) ====================
// ✅ Mark order as paid (for personal payments)
exports.markOrderPaid = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { paymentMethod = 'cash', transactionId } = req.body;
    const shopId = req.user._id;

    const order = await Order.findOne({
      _id: orderId,
      shop: shopId,
      status: { $in: ['delivered', 'arriving'] }
    });

    if (!order) {
      return ResponseHandler.error(res, 'Order not found or not authorized', 404);
    }
    if (order.payment?.status === 'paid') {
      order.status = 'delivered'; // or whatever marks completion
      order.completedAt = new Date();

      await order.save();

      return ResponseHandler.success(res, {
        order,
        commission: null
      }, 'Service completed successfully');
    }

    const personalPaymentMethods = ['cash', 'personal_upi', 'cod'];
    const isPersonalPayment = personalPaymentMethods.includes(paymentMethod);

    // Update order payment info
    order.payment.method = paymentMethod;
    order.payment.status = 'paid';
    order.payment.paidAt = new Date();
    order.payment.receivedBy = isPersonalPayment ? 'shop' : 'company';

    if (transactionId) {
      order.payment.transactionId = transactionId;
    }

    // Create payment record
    const payment = await Payment.create({
      transactionId: transactionId || `PAY-${Date.now()}`,
      order: order._id,
      user: order.user,
      shop: shopId,
      amount: order.pricing.totalAmount,
      paymentMethod: paymentMethod,
      paymentDestination: isPersonalPayment ? 'personal_account' : 'company_account',
      paymentType: 'product_order',
      status: 'success',
      paymentDate: new Date()
    });

    // Process commission based on payment destination
    if (isPersonalPayment) {
      await CommissionService.trackPersonalPayment(payment);

      order.payment.commissionStatus = 'pending';
      order.payment.commissionAmount = payment.commission.pendingCommission;
      order.payment.commissionDueDate = payment.pendingCommission.dueDate;
    } else {
      await CommissionService.processAutoPayout(payment);
      order.payment.commissionStatus = 'not_applicable';
    }

    await order.save();

    // Send notification to user
    await PushNotificationService.sendToUser(
      order.user,
      'Payment Received ✅',
      `Payment of ₹${order.pricing.totalAmount} has been received for your order #${order.orderId}.`
    );

    ResponseHandler.success(res, {
      order,
      commission: isPersonalPayment ? {
        amount: payment.commission.pendingCommission,
        dueDate: payment.pendingCommission.dueDate,
        status: 'pending'
      } : null
    }, 'Payment recorded successfully');

  } catch (error) {
    logger.error(`Mark order paid error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ==================== GET SHOP COMMISSION SUMMARY ====================
exports.getShopCommissionSummary = async (req, res) => {
  try {
    const shopId = req.user._id;

    // Get all personal payments from shop
    const personalPayments = await Order.find({
      shop: shopId,
      'payment.status': 'paid',
      'payment.receivedBy': 'shop'
    });

    // Calculate totals
    let totalEarnings = 0;
    let totalCommissionDue = 0;
    let totalCommissionPaid = 0;
    const pendingCommissions = [];

    personalPayments.forEach(order => {
      totalEarnings += order.pricing.totalAmount;

      if (order.payment.commissionStatus === 'pending') {
        totalCommissionDue += order.payment.commissionAmount || 0;
        pendingCommissions.push({
          orderId: order.orderId,
          amount: order.pricing.totalAmount,
          commission: order.payment.commissionAmount,
          dueDate: order.payment.commissionDueDate,
          customer: order.customerInfo?.name || 'Customer',
          date: order.payment.paidAt
        });
      } else if (order.payment.commissionStatus === 'paid') {
        totalCommissionPaid += order.payment.commissionAmount || 0;
      }
    });

    // Get paid commissions from Payment model
    const paidCommissions = await Payment.find({
      shop: shopId,
      paymentDestination: 'personal_account',
      'pendingCommission.status': 'paid'
    }).sort({ 'pendingCommission.paidDate': -1 }).limit(10);

    const commissionHistory = paidCommissions.map(p => ({
      date: p.pendingCommission.paidDate,
      amount: p.commission.pendingCommission,
      paymentMethod: p.pendingCommission.paymentMethod,
      transactionId: p.pendingCommission.transactionId
    }));

    ResponseHandler.success(res, {
      summary: {
        totalEarnings,
        totalCommissionDue,
        totalCommissionPaid,
        netEarnings: totalEarnings - totalCommissionDue - totalCommissionPaid,
        pendingCount: pendingCommissions.length
      },
      pendingCommissions,
      commissionHistory,
      commissionRate: '12%'
    }, 'Commission summary fetched');

  } catch (error) {
    console.error(`Get shop commission error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
// ==================== CANCELLATION FLOW ====================

// User Cancels Order
exports.cancelOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    const userId = req.user._id;

    const order = await Order.findOne({
      _id: orderId,
      user: userId
    }).session(session);

    if (!order) {
      await session.abortTransaction();
      return ResponseHandler.error(res, 'Order not found', 404);
    }

    // Check if order can be cancelled
    const cancellableStatuses = ['pending', 'confirmed', 'preparing'];
    if (!cancellableStatuses.includes(order.status)) {
      await session.abortTransaction();
      return ResponseHandler.error(
        res,
        `Order cannot be cancelled in ${order.status} status`,
        400
      );
    }

    // Restore product stock
    for (const item of order.items) {
      await Product.findByIdAndUpdate(
        item.product,
        { $inc: { 'stock.quantity': item.quantity } },
        { session }
      );
    }

    // Update order
    order.status = 'cancelled';
    order.cancellation = {
      requestedBy: 'user',
      reason: reason,
      refundAmount: order.payment.method !== 'cod' ? order.pricing.totalAmount : 0,
      refundStatus: order.payment.method !== 'cod' ? 'pending' : 'not_applicable'
    };
    order.timestamps.cancelledAt = new Date();
    order._updatedBy = 'user';

    // Update shop stats
    await Shop.findByIdAndUpdate(
      order.shop,
      {
        $inc: {
          [`orderStats.${order.status}`]: -1,
          'orderStats.cancelled': 1,
          'earnings.pending': order.payment.method === 'cod' ? -order.pricing.totalAmount : 0,
          'earnings.today': -order.pricing.totalAmount,
          'earnings.weekly': -order.pricing.totalAmount,
          'earnings.monthly': -order.pricing.totalAmount,
          'earnings.total': -order.pricing.totalAmount
        }
      },
      { session }
    );

    // Process refund if online payment
    if (order.payment.method !== 'cod' && order.payment.status === 'paid') {
      order.payment.status = 'refunded';
      order.payment.refundedAt = new Date();
      order.cancellation.refundStatus = 'processed';
      // Add actual refund logic here
    }

    await order.save({ session });
    await session.commitTransaction();

    // Invalidate cache
    await invalidateOrderCache(order).catch(e => logger.error(`Cache invalidation error: ${e.message}`));

    // Send notifications
    await PushNotificationService.sendToShop(
      order.shop,
      'Order Cancelled',
      `Order #${order.orderId} has been cancelled by customer. Reason: ${reason}`
    );

    // Notify delivery boy if assigned
    if (order.deliveryBoy) {
      const shop = await Shop.findById(order.shop);
      const deliveryBoy = shop.deliveryBoys.id(order.deliveryBoy);

      if (deliveryBoy) {
        // Remove from assigned orders
        deliveryBoy.assignedOrders = deliveryBoy.assignedOrders.filter(
          o => o.toString() !== orderId
        );

        if (deliveryBoy.assignedOrders.length === 0) {
          deliveryBoy.status = 'active';
        }

        await shop.save();

        await PushNotificationService.sendToDeliveryBoy(
          order.deliveryBoy,
          order.shop,
          'Delivery Cancelled',
          `Delivery for order #${order.orderId} has been cancelled.`
        );
      }
    }

    ResponseHandler.success(res, { order }, 'Order cancelled successfully');

  } catch (error) {
    await session.abortTransaction();
    logger.error(`Cancel order error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  } finally {
    session.endSession();
  }
};

// Shop Cancels Order
exports.shopCancelOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    const shopId = req.user._id;

    const order = await Order.findOne({
      _id: orderId,
      shop: shopId,
      status: { $in: ['confirmed', 'preparing', 'ready'] }
    }).session(session);

    if (!order) {
      await session.abortTransaction();
      return ResponseHandler.error(res, 'Order not found or cannot be cancelled', 404);
    }

    // Restore product stock
    for (const item of order.items) {
      await Product.findByIdAndUpdate(
        item.product,
        { $inc: { 'stock.quantity': item.quantity } },
        { session }
      );
    }

    // Update order
    order.status = 'cancelled';
    order.cancellation = {
      requestedBy: 'shop',
      reason: reason,
      refundAmount: order.payment.method !== 'cod' ? order.pricing.totalAmount : 0,
      refundStatus: order.payment.method !== 'cod' ? 'pending' : 'not_applicable'
    };
    order.timestamps.cancelledAt = new Date();
    order._updatedBy = 'shop';

    // Update shop stats
    await Shop.findByIdAndUpdate(
      shopId,
      {
        $inc: {
          [`orderStats.${order.status}`]: -1,
          'orderStats.cancelled': 1,
          'earnings.pending': order.payment.method === 'cod' ? -order.pricing.totalAmount : 0,
          'earnings.today': -order.pricing.totalAmount,
          'earnings.weekly': -order.pricing.totalAmount,
          'earnings.monthly': -order.pricing.totalAmount,
          'earnings.total': -order.pricing.totalAmount
        }
      },
      { session }
    );

    // Process refund
    if (order.payment.method !== 'cod' && order.payment.status === 'paid') {
      order.payment.status = 'refunded';
      order.payment.refundedAt = new Date();
      order.cancellation.refundStatus = 'processed';
    }

    await order.save({ session });
    await session.commitTransaction();

    // Invalidate cache
    await invalidateOrderCache(order).catch(e => logger.error(`Cache invalidation error: ${e.message}`));

    // Send notifications
    await PushNotificationService.sendToUser(
      order.user,
      'Order Cancelled',
      `Shop cancelled your order #${order.orderId}. Reason: ${reason}. Amount will be refunded if paid online.`
    );

    // Notify delivery boy if assigned
    if (order.deliveryBoy) {
      const shop = await Shop.findById(shopId);
      const deliveryBoy = shop.deliveryBoys.id(order.deliveryBoy);

      if (deliveryBoy) {
        deliveryBoy.assignedOrders = deliveryBoy.assignedOrders.filter(
          o => o.toString() !== orderId
        );

        if (deliveryBoy.assignedOrders.length === 0) {
          deliveryBoy.status = 'active';
        }

        await shop.save();
      }
    }

    ResponseHandler.success(res, { order }, 'Order cancelled successfully');

  } catch (error) {
    await session.abortTransaction();
    logger.error(`Shop cancel order error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  } finally {
    session.endSession();
  }
};

// ==================== ORDER MANAGEMENT ====================

// Get User Orders
/**
 * OPTIMIZED getUserOrders - Fixes N+1 queries and adds caching
 * 
 * BEFORE: 20 orders = 1 + 20 + 20 = 41 queries
 * AFTER: 20 orders = 1 + 1 + 1 + 1 = 4 queries (10x faster!)
 */
exports.getUserOrders = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      status,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = { user: userId };

    if (status) {
      if (status === 'active') {
        query.status = { $in: ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'arriving'] };
      } else if (status === 'completed') {
        query.status = { $in: ['delivered', 'cancelled', 'rejected'] };
      } else {
        query.status = status;
      }
    }

    // Try cache first (for first page only)
    const cacheKey = `user:${userId}:orders:${status || 'all'}:p${page}`;
    if (page == 1) {
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        logger.debug(`Cache HIT: User orders for ${userId}`);
        return ResponseHandler.success(res, cached, 'Orders fetched from cache');
      }
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // ✅ OPTIMIZATION 1: Use .lean() for faster queries
    const orders = await Order.find(query)
      .lean()
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // ✅ OPTIMIZATION 2: Batch load shops (1 query instead of N)
    await batchLoadAndAttach(
      orders,
      'shop',
      Shop,
      'shop',
      'name logo address rating'
    );

    // ✅ OPTIMIZATION 3: Batch load delivery boys (1 query instead of N)
    await batchLoadNested(
      orders,
      'deliveryBoy',
      Shop,
      'deliveryBoys',
      '_id',
      'deliveryBoy'
    );

    // ✅ OPTIMIZATION 4: Parallel count queries
    const [total, statsTotal, statsActive, statsDelivered, statsCancelled] = await Promise.all([
      Order.countDocuments(query),
      Order.countDocuments({ user: userId }),
      Order.countDocuments({
        user: userId,
        status: { $in: ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'arriving'] }
      }),
      Order.countDocuments({ user: userId, status: 'delivered' }),
      Order.countDocuments({ user: userId, status: 'cancelled' })
    ]);

    const stats = {
      total: statsTotal,
      active: statsActive,
      delivered: statsDelivered,
      cancelled: statsCancelled
    };

    const response = {
      orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      stats
    };

    // Cache for 2 minutes (first page only)
    if (page == 1) {
      await CacheService.set(cacheKey, response, 120);
    }

    ResponseHandler.success(res, response, 'Orders fetched successfully');

  } catch (error) {
    logger.error(`Get user orders error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Shop Orders
exports.getShopOrders = async (req, res) => {
  try {
    const shopId = req.user._id;
    const {
      page = 1,
      limit = 20,
      status,
      sortBy = 'timestamps.placedAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = { shop: shopId };
    if (status) {
      if (Array.isArray(status)) {
        query.status = { $in: status };
      } else {
        query.status = status;
      }
    }

    // Try cache first (for first page only)
    const cacheKey = CacheService.shopKey(shopId, `orders:${status || 'all'}:p${page}`);
    if (page == 1) {
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        logger.debug(`Cache HIT: Shop orders for ${shopId}`);
        return ResponseHandler.success(res, cached, 'Orders fetched from cache');
      }
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // Use .lean() for faster queries
    const orders = await Order.find(query)
      .lean()
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // Batch load delivery boys
    await batchLoadNested(
      orders,
      'deliveryBoy',
      Shop,
      'deliveryBoys',
      '_id',
      'deliveryBoy'
    );

    // Parallel count queries
    const [total, statsTotal, statsPending, statsActive, statsDelivered] = await Promise.all([
      Order.countDocuments(query),
      Order.countDocuments({ shop: shopId }),
      Order.countDocuments({ shop: shopId, status: 'pending' }),
      Order.countDocuments({
        shop: shopId,
        status: { $in: ['confirmed', 'preparing', 'ready', 'out_for_delivery', 'arriving'] }
      }),
      Order.countDocuments({ shop: shopId, status: 'delivered' })
    ]);

    const stats = {
      total: statsTotal,
      pending: statsPending,
      active: statsActive,
      delivered: statsDelivered
    };

    const response = {
      orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      stats
    };

    // Cache for 1 minute (first page only)
    if (page == 1) {
      await CacheService.set(cacheKey, response, 60);
    }

    ResponseHandler.success(res, response, 'Shop orders fetched successfully');

  } catch (error) {
    logger.error(`Get shop orders error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Order Details
exports.getOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    let query = { _id: orderId };

    if (userRole === 'user') query.user = userId;
    if (userRole === 'shop') query.shop = userId;
    if (userRole === 'delivery_boy') query.deliveryBoy = userId;

    const order = await Order.findOne(query)
      .populate('user', 'name phone email profilePicture')
      .populate('shop', 'name phone address logo rating deliveryBoys')
      .populate('items.product', 'name images category');

    if (!order) {
      return ResponseHandler.error(res, "Order not found", 404);
    }

    //-----------------------------
    // 🔥 FIND DELIVERY BOY FROM SHOP
    //-----------------------------
    let assignedBoy = null;

    if (order.deliveryBoy && order.shop?.deliveryBoys?.length) {
      assignedBoy = order.shop.deliveryBoys.find(
        (boy) => boy._id.toString() === order.deliveryBoy.toString()
      );
    }

    //-----------------------------
    // 🔥 Delivery Address
    //-----------------------------
    const deliveryAddress = order.deliveryInfo
      ? {
        house: order.deliveryInfo.house,
        area: order.deliveryInfo.area,
        city: order.deliveryInfo.city,
        pincode: order.deliveryInfo.pincode,
        coordinates: order.deliveryInfo.coordinates || null,
      }
      : null;

    //-----------------------------
    // 🔥 Delivery Boy Full Data
    //-----------------------------
    const deliveryBoy = assignedBoy
      ? {
        _id: assignedBoy._id,
        name: assignedBoy.name,
        phone: assignedBoy.phone,
        vehicle: assignedBoy.vehicle,
        profilePicture: assignedBoy.profilePicture,

        location: order.tracking?.deliveryBoyLocation || null,
        distance: order.tracking?.distance?.boyToUser || null,
      }
      : null;

    //-----------------------------
    // 🔥 Final Response
    //-----------------------------
    const orderData = {
      orderId: order.orderId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,

      items: order.items,
      shop: order.shop,
      user: order.user,

      deliveryAddress,
      deliveryBoy,

      timestamps: order.timestamps,
      estimatedDeliveryTime: order.tracking?.estimatedDeliveryTime || null,
      tracking: order.tracking || null,
    };

    ResponseHandler.success(res, orderData, "Order details fetched successfully");

  } catch (error) {
    logger.error(`Get order details error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Order Tracking
exports.getOrderTracking = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user._id;

    // Fetch order + shop (including deliveryBoys)
    const order = await Order.findOne({
      _id: orderId,
      user: userId
    })
      .populate('shop', 'name logo phone address deliveryBoys')
      .populate('deliveryBoy', 'name phone vehicle profilePicture'); // in case you also store global deliveryBoy

    if (!order) {
      return ResponseHandler.error(res, 'Order not found', 404);
    }

    //----------------------------------------------------
    // 1️⃣ FIND EMBEDDED SHOP DELIVERY BOY
    //----------------------------------------------------
    let assignedBoy = null;

    if (order.deliveryBoy) {
      // Match embedded deliveryBoy of shop
      assignedBoy = order.shop?.deliveryBoys?.find(
        (boy) => boy._id.toString() === order.deliveryBoy.toString()
      );
    }

    //----------------------------------------------------
    // 2️⃣ BUILD RESPONSE
    //----------------------------------------------------
    const trackingInfo = {
      orderId: order.orderId,
      status: order.status,

      shop: {
        name: order.shop?.name,
        phone: order.shop?.phone,
        address: order.shop?.address,
        location: order.tracking?.shopLocation
      },

      deliveryBoy: assignedBoy
        ? {
          _id: assignedBoy._id,
          name: assignedBoy.name,
          phone: assignedBoy.phone,
          vehicle: assignedBoy.vehicle,
          profilePicture: assignedBoy.profilePicture,
          location: order.tracking?.deliveryBoyLocation,
          distance: order.tracking?.distance?.boyToUser
        }
        : null,

      estimatedDeliveryTime: order.tracking?.estimatedDeliveryTime,
      timestamps: order.timestamps,
      statusHistory: order.statusHistory,
      deliveryInfo: order.deliveryInfo
    };

    //----------------------------------------------------
    // 3️⃣ SEND SUCCESS
    //----------------------------------------------------
    ResponseHandler.success(res, trackingInfo, 'Tracking info fetched successfully');

  } catch (error) {
    logger.error(`Get order tracking error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};


// ==================== DELIVERY BOY ROUTES ====================

// Get Delivery Boy's Active Orders
exports.getDeliveryBoyOrders = async (req, res) => {
  try {
    const deliveryBoyId = req.user._id;
    const shopId = req.user.shop; // Assuming delivery boy has shop reference

    const shop = await Shop.findById(shopId);
    const deliveryBoy = shop.deliveryBoys.id(deliveryBoyId);

    if (!deliveryBoy) {
      return ResponseHandler.error(res, 'Delivery boy not found', 404);
    }

    const activeOrders = await Order.find({
      _id: { $in: deliveryBoy.assignedOrders },
      status: { $in: ['ready', 'out_for_delivery', 'arriving'] }
    })
      .populate('user', 'name phone')
      .populate('shop', 'name address phone')
      .sort({ 'timestamps.readyAt': 1 });

    const completedToday = await Order.countDocuments({
      deliveryBoy: deliveryBoyId,
      status: 'delivered',
      'timestamps.deliveredAt': {
        $gte: new Date(new Date().setHours(0, 0, 0, 0))
      }
    });

    ResponseHandler.success(res, {
      activeOrders,
      stats: {
        assigned: deliveryBoy.assignedOrders.length,
        completedToday,
        totalDeliveries: deliveryBoy.totalDeliveries,
        earnings: deliveryBoy.earnings
      }
    }, 'Orders fetched successfully');

  } catch (error) {
    logger.error(`Get delivery boy orders error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Delivery Boy Update Status
exports.updateDeliveryBoyStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const deliveryBoyId = req.user._id;
    const shopId = req.user.shop;

    const validStatuses = ['active', 'inactive', 'offline'];
    if (!validStatuses.includes(status)) {
      return ResponseHandler.error(res, 'Invalid status', 400);
    }

    const shop = await Shop.findById(shopId);
    const deliveryBoy = shop.deliveryBoys.id(deliveryBoyId);

    if (!deliveryBoy) {
      return ResponseHandler.error(res, 'Delivery boy not found', 404);
    }

    deliveryBoy.status = status;
    await shop.save();

    ResponseHandler.success(res, { status: deliveryBoy.status }, 'Status updated');

  } catch (error) {
    logger.error(`Update delivery boy status error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ==================== HELPER FUNCTIONS ====================

// Check if shop has accepted order (called after timeout)
async function checkShopAcceptance(orderId) {
  try {
    const order = await Order.findById(orderId);

    if (!order || order.status !== 'pending') {
      return;
    }

    // Order still pending after 5 minutes
    // We don't auto-cancel, just send reminder to shop
    await PushNotificationService.sendToShop(
      order.shop,
      'Order Reminder',
      `Order #${order.orderId} is still pending. Please accept or reject.`,
      {
        orderId: order._id,
        type: 'reminder'
      }
    );

    // Send notification to user
    await PushNotificationService.sendToUser(
      order.user,
      'Order Status',
      'Shop is still processing your order. You can cancel if taking too long.'
    );

  } catch (error) {
    logger.error(`Check shop acceptance error: ${error.message}`);
  }
}

// Get Available Shops for User Location
exports.getAvailableShops = async (req, res) => {
  try {
    const { latitude, longitude, category, search } = req.query;

    if (!latitude || !longitude) {
      return ResponseHandler.error(res, 'Location required', 400);
    }

    const userLocation = {
      type: 'Point',
      coordinates: [parseFloat(longitude), parseFloat(latitude)]
    };

    // Find shops within 10km radius
    const shops = await Shop.find({
      isActive: true,
      isOpen: true,
      verificationStatus: 'approved',
      'address.location': {
        $near: {
          $geometry: userLocation,
          $maxDistance: 10000 // 10km
        }
      }
    })
      .select('name logo address deliverySettings ratings categories workingHours isShopOpenNow')
      .lean();

    // Calculate distance and delivery time for each shop
    const shopsWithDetails = shops.map(shop => {
      const distance = GeoService.calculateDistance(
        latitude,
        longitude,
        shop.address.location.coordinates[1],
        shop.address.location.coordinates[0]
      );

      const deliveryFee = calculateDeliveryFee(shop, distance, 0);
      const deliveryTime = shop.deliverySettings.estimatedDeliveryTime;

      return {
        ...shop,
        distance: parseFloat(distance.toFixed(1)),
        deliveryFee,
        deliveryTime: `${deliveryTime.min}-${deliveryTime.max} min`,
        isOpen: shop.isShopOpenNow ? shop.isShopOpenNow() : false
      };
    });

    // Filter by category if provided
    let filteredShops = shopsWithDetails;
    if (category) {
      filteredShops = shopsWithDetails.filter(shop =>
        shop.categories.includes(category)
      );
    }

    // Filter by search if provided
    if (search) {
      filteredShops = shopsWithDetails.filter(shop =>
        shop.name.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Sort by distance
    filteredShops.sort((a, b) => a.distance - b.distance);

    ResponseHandler.success(res, { shops: filteredShops }, 'Shops fetched successfully');

  } catch (error) {
    logger.error(`Get available shops error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ==================== ADMIN ORDER MANAGEMENT ====================

// Get all orders with filters
exports.getAllOrders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      status,
      shopId,
      userId,
      deliveryBoyId,
      paymentMethod,
      paymentStatus,
      dateFrom,
      dateTo,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};

    // Filters
    if (status) query.status = status;
    if (shopId) query.shop = shopId;
    if (userId) query.user = userId;
    if (deliveryBoyId) query.deliveryBoy = deliveryBoyId;
    if (paymentMethod) query['payment.method'] = paymentMethod;
    if (paymentStatus) query['payment.status'] = paymentStatus;

    // Date range filter
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    // Search filter
    if (search) {
      query.$or = [
        { orderId: { $regex: search, $options: 'i' } },
        { 'customerInfo.name': { $regex: search, $options: 'i' } },
        { 'customerInfo.phone': { $regex: search, $options: 'i' } },
        { 'customerInfo.email': { $regex: search, $options: 'i' } },
        { 'shopInfo.name': { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // Get orders with population
    const orders = await Order.find(query)
      .populate('user', 'name phone email profilePicture')
      .populate('shop', 'name logo phone address verificationStatus')
      .populate('deliveryBoy', 'name phone vehicle')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count
    const total = await Order.countDocuments(query);

    // Get aggregated statistics
    const stats = await Order.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$pricing.totalAmount' },
          totalItems: { $sum: { $size: '$items' } },
          avgOrderValue: { $avg: '$pricing.totalAmount' }
        }
      }
    ]);

    // Get status-wise counts
    const statusCounts = await Order.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          revenue: { $sum: '$pricing.totalAmount' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get daily orders for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyStats = await Order.aggregate([
      {
        $match: {
          ...query,
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          orders: { $sum: 1 },
          revenue: { $sum: '$pricing.totalAmount' },
          items: { $sum: { $size: '$items' } }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    ResponseHandler.success(res, {
      orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      stats: stats[0] || {
        totalOrders: 0,
        totalRevenue: 0,
        totalItems: 0,
        avgOrderValue: 0
      },
      statusCounts,
      dailyStats,
      filters: {
        status,
        shopId,
        userId,
        dateFrom,
        dateTo,
        search
      }
    }, 'Orders fetched successfully');

  } catch (error) {
    logger.error(`Get all orders error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get order details for admin
exports.getOrderadminDetails = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .populate('user', 'name phone email profilePicture addresses')
      .populate('shop', 'name logo phone address taxInfo owner')
      .populate('deliveryBoy', 'name phone vehicle profilePicture rating')
      .populate('items.product', 'name images category weight brand');

    if (!order) {
      return ResponseHandler.error(res, 'Order not found', 404);
    }

    // Get detailed timeline
    const timeline = [];
    if (order.timestamps.placedAt) timeline.push({ action: 'Order Placed', time: order.timestamps.placedAt });
    if (order.timestamps.confirmedAt) timeline.push({ action: 'Shop Confirmed', time: order.timestamps.confirmedAt });
    if (order.timestamps.preparingAt) timeline.push({ action: 'Preparing Started', time: order.timestamps.preparingAt });
    if (order.timestamps.readyAt) timeline.push({ action: 'Order Ready', time: order.timestamps.readyAt });
    if (order.timestamps.pickedUpAt) timeline.push({ action: 'Picked Up', time: order.timestamps.pickedUpAt });
    if (order.timestamps.arrivingAt) timeline.push({ action: 'Arriving Soon', time: order.timestamps.arrivingAt });
    if (order.timestamps.deliveredAt) timeline.push({ action: 'Delivered', time: order.timestamps.deliveredAt });
    if (order.timestamps.cancelledAt) timeline.push({ action: 'Cancelled', time: order.timestamps.cancelledAt });
    if (order.timestamps.rejectedAt) timeline.push({ action: 'Rejected', time: order.timestamps.rejectedAt });

    // Get status history
    const statusHistory = order.statusHistory || [];

    // Get payment history if available
    const paymentHistory = order.payment.history || [];

    // Get location tracking points
    const locationHistory = order.tracking.locationHistory || [];

    // Get shop delivery boy info
    let assignedDeliveryBoy = null;
    if (order.deliveryBoy && order.shop) {
      const shop = await Shop.findById(order.shop._id);
      if (shop && shop.deliveryBoys) {
        assignedDeliveryBoy = shop.deliveryBoys.find(
          boy => boy._id.toString() === order.deliveryBoy._id.toString()
        );
      }
    }

    // Calculate metrics
    const metrics = {
      preparationTime: order.timestamps.readyAt && order.timestamps.confirmedAt
        ? (order.timestamps.readyAt - order.timestamps.confirmedAt) / (1000 * 60) // minutes
        : null,
      deliveryTime: order.timestamps.deliveredAt && order.timestamps.pickedUpAt
        ? (order.timestamps.deliveredAt - order.timestamps.pickedUpAt) / (1000 * 60) // minutes
        : null,
      totalTime: order.timestamps.deliveredAt && order.timestamps.placedAt
        ? (order.timestamps.deliveredAt - order.timestamps.placedAt) / (1000 * 60) // minutes
        : null
    };

    const detailedOrder = {
      _id: order._id,
      orderId: order.orderId,
      status: order.status,
      source: order.source,
      deviceInfo: order.deviceInfo,

      user: order.user,
      shop: order.shop,
      deliveryBoy: assignedDeliveryBoy || order.deliveryBoy,

      items: order.items.map(item => ({
        ...item,
        product: item.product || { _id: item.product }
      })),

      deliveryAddress: order.deliveryAddress,
      deliveryInfo: order.deliveryInfo,

      pricing: order.pricing,
      payment: order.payment,

      timeline,
      statusHistory,
      paymentHistory,
      locationHistory,

      tracking: order.tracking,
      notes: order.notes,
      cancellation: order.cancellation,
      rejection: order.rejection,

      timestamps: order.timestamps,
      metrics,
      _updatedBy: order._updatedBy,
      _updatedAt: order._updatedAt
    };

    ResponseHandler.success(res, detailedOrder, 'Order details fetched successfully');

  } catch (error) {
    logger.error(`Get admin order details error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Update order status (admin override)
exports.updateOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderId } = req.params;
    const {
      status,
      deliveryBoyId,
      deliveryFee,
      discountAmount,
      note,
      notifyUser = true,
      notifyShop = true,
      notifyDeliveryBoy = true
    } = req.body;

    const order = await Order.findById(orderId).session(session);
    if (!order) {
      await session.abortTransaction();
      return ResponseHandler.error(res, 'Order not found', 404);
    }

    // Validate status transition
    const validTransitions = {
      pending: ['confirmed', 'rejected', 'cancelled'],
      confirmed: ['preparing', 'ready', 'cancelled'],
      preparing: ['ready', 'cancelled'],
      ready: ['out_for_delivery', 'cancelled'],
      out_for_delivery: ['arriving', 'delivered', 'cancelled'],
      arriving: ['delivered', 'cancelled']
    };

    if (status && status !== order.status) {
      const allowed = validTransitions[order.status];
      if (!allowed || !allowed.includes(status)) {
        await session.abortTransaction();
        return ResponseHandler.error(
          res,
          `Cannot transition from ${order.status} to ${status}`,
          400
        );
      }

      // Update status
      order.status = status;
      order.statusHistory = order.statusHistory || [];
      order.statusHistory.push({
        status,
        changedBy: 'admin',
        changedAt: new Date(),
        note
      });

      // Update timestamps
      const timestampMap = {
        confirmed: 'confirmedAt',
        preparing: 'preparingAt',
        ready: 'readyAt',
        out_for_delivery: 'outForDeliveryAt',
        arriving: 'arrivingAt',
        delivered: 'deliveredAt',
        cancelled: 'cancelledAt',
        rejected: 'rejectedAt'
      };

      if (timestampMap[status]) {
        order.timestamps[timestampMap[status]] = new Date();
      }
    }

    // Update delivery boy
    if (deliveryBoyId && deliveryBoyId !== order.deliveryBoy?.toString()) {
      const shop = await Shop.findById(order.shop).session(session);
      const deliveryBoy = shop.deliveryBoys.id(deliveryBoyId);

      if (!deliveryBoy) {
        await session.abortTransaction();
        return ResponseHandler.error(res, 'Delivery boy not found', 404);
      }

      // Remove from previous delivery boy if exists
      if (order.deliveryBoy) {
        const prevShop = await Shop.findById(order.shop).session(session);
        const prevBoy = prevShop.deliveryBoys.id(order.deliveryBoy);
        if (prevBoy) {
          prevBoy.assignedOrders = prevBoy.assignedOrders.filter(
            id => id.toString() !== orderId
          );
          await prevShop.save({ session });
        }
      }

      // Assign to new delivery boy
      deliveryBoy.assignedOrders.push(order._id);
      deliveryBoy.status = 'busy';
      await shop.save({ session });

      order.deliveryBoy = deliveryBoyId;
    }

    // Update pricing
    if (deliveryFee !== undefined) {
      order.pricing.deliveryFee = deliveryFee;
      order.pricing.subtotal = order.pricing.itemsTotal +
        order.pricing.tax +
        deliveryFee +
        order.pricing.packagingCharge -
        order.pricing.discount.amount +
        order.pricing.tip;
      order.pricing.totalAmount = order.pricing.subtotal;
    }

    if (discountAmount !== undefined) {
      order.pricing.discount.amount = discountAmount;
      order.pricing.subtotal = order.pricing.itemsTotal +
        order.pricing.tax +
        order.pricing.deliveryFee +
        order.pricing.packagingCharge -
        discountAmount +
        order.pricing.tip;
      order.pricing.totalAmount = order.pricing.subtotal;
    }

    order._updatedBy = 'admin';
    order._updatedAt = new Date();

    await order.save({ session });
    await session.commitTransaction();

    // Send notifications
    if (notifyUser && order.user) {
      PushNotificationService.sendToUser(
        order.user,
        'Order Updated',
        `Your order #${order.orderId} has been updated. New status: ${status || 'updated'}`,
        { orderId: order._id, status: order.status }
      ).catch(err => logger.error(err));
    }

    if (notifyShop && order.shop) {
      PushNotificationService.sendToShop(
        order.shop,
        'Order Updated by Admin',
        `Order #${order.orderId} has been updated.`,
        { orderId: order._id, status: order.status }
      ).catch(err => logger.error(err));
    }

    if (notifyDeliveryBoy && order.deliveryBoy && deliveryBoyId) {
      PushNotificationService.sendToDeliveryBoy(
        order.deliveryBoy,
        order.shop,
        'New Delivery Assignment',
        `You have been assigned order #${order.orderId}`,
        { orderId: order._id, shopId: order.shop }
      ).catch(err => logger.error(err));
    }

    const updatedOrder = await Order.findById(orderId)
      .populate('user', 'name phone')
      .populate('shop', 'name logo')
      .populate('deliveryBoy', 'name phone');

    ResponseHandler.success(res, { order: updatedOrder }, 'Order updated successfully');

  } catch (error) {
    await session.abortTransaction();
    logger.error(`Update order error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  } finally {
    session.endSession();
  }
};

// Admin cancel order
exports.AdmincancelOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderId } = req.params;
    const { reason, refund = true, notify = true } = req.body;

    const order = await Order.findById(orderId).session(session);
    if (!order) {
      await session.abortTransaction();
      return ResponseHandler.error(res, 'Order not found', 404);
    }

    // Check if order can be cancelled
    if (['delivered', 'cancelled', 'rejected'].includes(order.status)) {
      await session.abortTransaction();
      return ResponseHandler.error(
        res,
        `Order cannot be cancelled in ${order.status} status`,
        400
      );
    }

    // Restore product stock
    for (const item of order.items) {
      await Product.findByIdAndUpdate(
        item.product,
        { $inc: { 'stock.quantity': item.quantity } },
        { session }
      ).catch(err => logger.error(`Stock restore error: ${err.message}`));
    }

    // Update order
    order.status = 'cancelled';
    order.cancellation = {
      requestedBy: 'admin',
      reason,
      refundAmount: refund && order.payment.method !== 'cod' ? order.pricing.totalAmount : 0,
      refundStatus: refund && order.payment.method !== 'cod' ? 'pending' : 'not_applicable'
    };
    order.timestamps.cancelledAt = new Date();
    order._updatedBy = 'admin';

    // Process refund if needed
    if (refund && order.payment.method !== 'cod' && order.payment.status === 'paid') {
      order.payment.status = 'refunded';
      order.payment.refundedAt = new Date();
      order.cancellation.refundStatus = 'processed';
      // Add actual refund logic here
    }

    // Update shop stats
    await Shop.findByIdAndUpdate(
      order.shop,
      {
        $inc: {
          [`orderStats.${order.status}`]: -1,
          'orderStats.cancelled': 1,
          'earnings.pending': order.payment.method === 'cod' ? -order.pricing.totalAmount : 0,
          'earnings.today': -order.pricing.totalAmount,
          'earnings.weekly': -order.pricing.totalAmount,
          'earnings.monthly': -order.pricing.totalAmount,
          'earnings.total': -order.pricing.totalAmount
        }
      },
      { session }
    );

    // Remove from delivery boy if assigned
    if (order.deliveryBoy) {
      const shop = await Shop.findById(order.shop).session(session);
      const deliveryBoy = shop.deliveryBoys.id(order.deliveryBoy);

      if (deliveryBoy) {
        deliveryBoy.assignedOrders = deliveryBoy.assignedOrders.filter(
          o => o.toString() !== orderId
        );

        if (deliveryBoy.assignedOrders.length === 0) {
          deliveryBoy.status = 'active';
        }

        await shop.save({ session });

        if (notify) {
          PushNotificationService.sendToDeliveryBoy(
            order.deliveryBoy,
            order.shop,
            'Delivery Cancelled',
            `Delivery for order #${order.orderId} has been cancelled by admin.`
          ).catch(err => logger.error(err));
        }
      }
    }

    await order.save({ session });
    await session.commitTransaction();

    // Send notifications
    if (notify) {
      if (order.user) {
        PushNotificationService.sendToUser(
          order.user,
          'Order Cancelled by Admin',
          `Your order #${order.orderId} has been cancelled. Reason: ${reason}.`,
          { orderId: order._id, reason }
        ).catch(err => logger.error(err));
      }

      if (order.shop) {
        PushNotificationService.sendToShop(
          order.shop,
          'Order Cancelled by Admin',
          `Order #${order.orderId} has been cancelled. Reason: ${reason}.`,
          { orderId: order._id, reason }
        ).catch(err => logger.error(err));
      }
    }

    ResponseHandler.success(res, { order }, 'Order cancelled successfully');

  } catch (error) {
    await session.abortTransaction();
    logger.error(`Admin cancel order error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  } finally {
    session.endSession();
  }
};

// Get order analytics
exports.getOrderAnalytics = async (req, res) => {
  try {
    const {
      period = 'today', // today, yesterday, week, month, year, custom
      startDate,
      endDate,
      shopId,
      groupBy = 'day' // hour, day, week, month
    } = req.query;

    let matchStage = {};

    // Set date range based on period
    const now = new Date();
    let start, end;

    switch (period) {
      case 'today':
        start = new Date(now.setHours(0, 0, 0, 0));
        end = new Date(now.setHours(23, 59, 59, 999));
        break;
      case 'yesterday':
        start = new Date(now.setDate(now.getDate() - 1));
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setHours(23, 59, 59, 999);
        break;
      case 'week':
        start = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        start = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case 'year':
        start = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      case 'custom':
        if (startDate) start = new Date(startDate);
        if (endDate) end = new Date(endDate);
        break;
      default:
        start = new Date(now.setDate(now.getDate() - 30));
    }

    if (start) matchStage.createdAt = { $gte: start };
    if (end) matchStage.createdAt = { ...matchStage.createdAt, $lte: end };
    if (shopId) matchStage.shop = shopId;

    // Aggregation pipeline
    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$pricing.totalAmount' },
          totalItems: { $sum: { $size: '$items' } },
          avgOrderValue: { $avg: '$pricing.totalAmount' },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
          },
          cancelledOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          },
          pendingOrders: {
            $sum: {
              $cond: [{
                $in: ['$status', ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'arriving']]
              }, 1, 0]
            }
          },
          totalDeliveryFee: { $sum: '$pricing.deliveryFee' },
          totalTax: { $sum: '$pricing.tax' },
          totalDiscount: { $sum: '$pricing.discount.amount' },
          totalTip: { $sum: '$pricing.tip' }
        }
      }
    ];

    const analytics = await Order.aggregate(pipeline);
    const result = analytics[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      totalItems: 0,
      avgOrderValue: 0,
      completedOrders: 0,
      cancelledOrders: 0,
      pendingOrders: 0,
      totalDeliveryFee: 0,
      totalTax: 0,
      totalDiscount: 0,
      totalTip: 0
    };

    // Time series data
    let groupFormat;
    switch (groupBy) {
      case 'hour':
        groupFormat = { hour: { $hour: '$createdAt' } };
        break;
      case 'week':
        groupFormat = { week: { $week: '$createdAt' } };
        break;
      case 'month':
        groupFormat = { month: { $month: '$createdAt' } };
        break;
      default: // day
        groupFormat = { day: { $dayOfMonth: '$createdAt' }, month: { $month: '$createdAt' }, year: { $year: '$createdAt' } };
    }

    const timeSeriesPipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: groupFormat,
          orders: { $sum: 1 },
          revenue: { $sum: '$pricing.totalAmount' },
          items: { $sum: { $size: '$items' } }
        }
      },
      { $sort: { '_id': 1 } }
    ];

    const timeSeries = await Order.aggregate(timeSeriesPipeline);

    // Top shops
    const topShops = await Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$shop',
          orders: { $sum: 1 },
          revenue: { $sum: '$pricing.totalAmount' },
          avgRating: { $avg: '$shopInfo.rating' }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'shops',
          localField: '_id',
          foreignField: '_id',
          as: 'shopDetails'
        }
      },
      { $unwind: '$shopDetails' },
      {
        $project: {
          shopId: '$_id',
          shopName: '$shopDetails.name',
          orders: 1,
          revenue: 1,
          avgRating: 1
        }
      }
    ]);

    // Top products
    const topProducts = await Order.aggregate([
      { $match: matchStage },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          name: { $first: '$items.name' },
          quantity: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.quantity', '$items.price.sellingPrice'] } }
        }
      },
      { $sort: { quantity: -1 } },
      { $limit: 20 }
    ]);

    ResponseHandler.success(res, {
      summary: result,
      timeSeries,
      topShops,
      topProducts,
      period,
      groupBy,
      dateRange: { start, end }
    }, 'Analytics fetched successfully');

  } catch (error) {
    logger.error(`Get order analytics error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Export orders to CSV/Excel
exports.exportOrders = async (req, res) => {
  try {
    const { format = 'csv', ...filters } = req.query;

    // Build query from filters (similar to getAllOrders)
    const query = {};
    if (filters.status) query.status = filters.status;
    if (filters.shopId) query.shop = filters.shopId;
    if (filters.userId) query.user = filters.userId;
    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {};
      if (filters.dateFrom) query.createdAt.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) query.createdAt.$lte = new Date(filters.dateTo);
    }

    const orders = await Order.find(query)
      .populate('user', 'name phone email')
      .populate('shop', 'name phone')
      .populate('deliveryBoy', 'name phone')
      .sort({ createdAt: -1 })
      .lean();

    // Format data for export
    const data = orders.map(order => ({
      'Order ID': order.orderId,
      'Date': order.createdAt.toISOString().split('T')[0],
      'Time': order.createdAt.toISOString().split('T')[1].split('.')[0],
      'Customer': order.customerInfo.name,
      'Customer Phone': order.customerInfo.phone,
      'Shop': order.shopInfo.name,
      'Status': order.status,
      'Payment Method': order.payment.method,
      'Payment Status': order.payment.status,
      'Items Total': order.pricing.itemsTotal,
      'Delivery Fee': order.pricing.deliveryFee,
      'Tax': order.pricing.tax,
      'Discount': order.pricing.discount.amount,
      'Tip': order.pricing.tip,
      'Total Amount': order.pricing.totalAmount,
      'Delivery Address': order.deliveryAddress?.formattedAddress || '',
      'Delivery Boy': order.deliveryBoy?.name || '',
      'Delivery Boy Phone': order.deliveryBoy?.phone || ''
    }));

    if (format === 'csv') {
      // Convert to CSV
      const csv = json2csv(data, { fields: Object.keys(data[0] || {}) });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=orders_${Date.now()}.csv`);
      return res.send(csv);
    } else if (format === 'excel') {
      // Create Excel workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Orders');

      // Add headers
      const headers = Object.keys(data[0] || {});
      worksheet.addRow(headers);

      // Add data
      data.forEach(row => {
        worksheet.addRow(Object.values(row));
      });

      // Set response headers
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=orders_${Date.now()}.xlsx`);

      // Send file
      await workbook.xlsx.write(res);
      res.end();
    } else {
      ResponseHandler.error(res, 'Invalid format. Use csv or excel', 400);
    }

  } catch (error) {
    logger.error(`Export orders error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
exports.getOrderStats = async (req, res) => {
  try {
    const { period = 'today', shopId } = req.query;

    let matchQuery = {};

    if (shopId) {
      matchQuery.shop = shopId;
    }

    // Set date range if period is specified
    if (period !== 'all') {
      const now = new Date();
      let startDate;

      switch (period) {
        case 'today':
          startDate = new Date(now.setHours(0, 0, 0, 0));
          break;
        case 'yesterday':
          startDate = new Date(now.setDate(now.getDate() - 1));
          startDate.setHours(0, 0, 0, 0);
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
      }

      if (startDate) {
        matchQuery.createdAt = { $gte: startDate };
      }
    }

    // Get status counts
    const statusCounts = await Order.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Calculate totals
    const stats = {
      total: 0,
      pending: 0,
      confirmed: 0,
      preparing: 0,
      ready: 0,
      out_for_delivery: 0,
      arriving: 0,
      delivered: 0,
      cancelled: 0,
      rejected: 0
    };

    // Map status counts to stats object
    statusCounts.forEach(item => {
      const status = item._id;
      const count = item.count;
      stats.total += count;

      if (stats.hasOwnProperty(status)) {
        stats[status] = count;
      }
    });

    // Get revenue stats
    const revenueStats = await Order.aggregate([
      { $match: { ...matchQuery, status: 'delivered' } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$pricing.totalAmount' },
          avgOrderValue: { $avg: '$pricing.totalAmount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get payment stats
    const paymentStats = await Order.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$payment.status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Process payment stats
    const payment = {
      paid: 0,
      pending: 0,
      failed: 0,
      refunded: 0
    };

    paymentStats.forEach(item => {
      if (payment.hasOwnProperty(item._id)) {
        payment[item._id] = item.count;
      }
    });

    // Get recent orders count
    const recentOrdersCount = await Order.countDocuments({
      ...matchQuery,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    ResponseHandler.success(res, {
      stats,
      revenue: revenueStats[0] || {
        totalRevenue: 0,
        avgOrderValue: 0,
        count: 0
      },
      payment,
      recent24Hours: recentOrdersCount,
      period,
      shopId
    }, 'Order statistics fetched successfully');

  } catch (error) {
    logger.error(`Get order stats error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Cache invalidation now handled by CacheInvalidationService

module.exports = exports;