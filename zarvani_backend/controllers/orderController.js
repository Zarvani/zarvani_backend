// ============= controllers/orderController.js (NEW) =============
const Order = require('../models/Order');
const { Shop } = require('../models/Shop');
const {Product} = require("../models/Product")
const ServiceProvider = require('../models/ServiceProvider');
const ResponseHandler = require('../utils/responseHandler');
const GeoService = require('../services/geoService');
const PushNotificationService = require('../services/pushNotification');
const logger = require('../utils/logger');

// Create Order (User places order)
exports.createOrder = async (req, res) => {
  try {
    const { shopId, items, deliveryAddress, paymentMethod, notes, deliveryInstructions } = req.body;
    
    const shop = await Shop.findById(shopId);
    if (!shop || !shop.isActive) {
      return ResponseHandler.error(res, 'Shop not available', 404);
    }
    
    // Get coordinates for delivery address
    const geoResult = await GeoService.getCoordinatesFromAddress(deliveryAddress);
    if (geoResult.success) {
      deliveryAddress.location = {
        type: 'Point',
        coordinates: geoResult.coordinates
      };
    }
    
    // Validate and calculate total
    let subtotal = 0;
    const orderItems = [];
    
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product || !product.isAvailable) {
        return ResponseHandler.error(res, `Product ${item.product} not available`, 400);
      }
      
      if (product.stock.quantity < item.quantity) {
        return ResponseHandler.error(res, `Insufficient stock for ${product.name}`, 400);
      }
      
      const itemTotal = product.price.sellingPrice * item.quantity;
      subtotal += itemTotal;
      
      orderItems.push({
        product: product._id,
        name: product.name,
        quantity: item.quantity,
        price: product.price.sellingPrice,
        total: itemTotal
      });
    }
    
    // Calculate delivery fee based on distance
    const distance = GeoService.calculateDistance(
      shop.address.location.coordinates[1],
      shop.address.location.coordinates[0],
      deliveryAddress.location.coordinates[1],
      deliveryAddress.location.coordinates[0]
    );
    
    let deliveryFee = 0;
    if (distance > 5) {
      deliveryFee = Math.ceil(distance - 5) * 10; // ₹10 per km after 5km
    }
    
    const totalAmount = subtotal + deliveryFee;
    
    // Generate order ID
    const orderId = `ORD${Date.now()}${Math.floor(Math.random() * 1000)}`;
    
    // Create order
    const order = await Order.create({
      orderId,
      user: req.user._id,
      shop: shopId,
      items: orderItems,
      deliveryAddress,
      subtotal,
      deliveryFee,
      totalAmount,
      paymentMethod,
      notes,
      deliveryInstructions,
      status: 'placed',
      tracking: {
        shopLocation: shop.address.location
      },
      timestamps: {
        placedAt: new Date()
      }
    });
    
    // Notify shop
    await PushNotificationService.sendToUser(
      shopId,
      'New Order Received',
      `Order ${orderId} - ₹${totalAmount}. Accept within 60 seconds.`
    );
    
    // Set timeout for shop response
    setTimeout(() => handleShopTimeout(order._id), 60000); // 60 seconds
    
    await order.populate('shop user items.product');
    
    ResponseHandler.success(res, { order }, 'Order placed successfully. Waiting for shop confirmation.', 201);
  } catch (error) {
    logger.error(`Create order error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Handle Shop Response Timeout
async function handleShopTimeout(orderId) {
  try {
    const order = await Order.findById(orderId);
    
    if (!order || order.status !== 'placed') {
      return;
    }
    
    // Shop didn't respond, cancel order
    order.status = 'cancelled';
    order.cancelledBy = 'system';
    order.cancellationReason = 'Shop did not respond in time';
    order.timestamps.cancelledAt = new Date();
    await order.save();
    
    // Notify user
    await PushNotificationService.sendToUser(
      order.user,
      'Order Cancelled',
      'Shop did not accept your order. Please try another shop.'
    );
    
    // Refund if payment was made
    // ... refund logic
  } catch (error) {
    logger.error(`Shop timeout error: ${error.message}`);
  }
}

// Shop Accepts Order
exports.acceptOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { estimatedPreparationTime } = req.body;
    const shopId = req.user._id;
    
    const order = await Order.findOne({ _id: orderId, shop: shopId }).populate('user items.product');
    
    if (!order) {
      return ResponseHandler.error(res, 'Order not found', 404);
    }
    
    if (order.status !== 'placed') {
      return ResponseHandler.error(res, 'Order already processed', 400);
    }
    
    // Update product stock
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product._id, {
        $inc: { 'stock.quantity': -item.quantity }
      });
    }
    
    order.status = 'accepted';
    order.shopAcceptedAt = new Date();
    order.timestamps.acceptedAt = new Date();
    if (estimatedPreparationTime) {
      order.estimatedPreparationTime = estimatedPreparationTime;
    }
    await order.save();
    
    // Notify user
    await PushNotificationService.sendToUser(
      order.user,
      'Order Accepted',
      `Your order has been accepted and will be ready in ${order.estimatedPreparationTime} minutes.`
    );
    
    ResponseHandler.success(res, { order }, 'Order accepted successfully');
  } catch (error) {
    logger.error(`Accept order error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Shop Rejects Order
exports.rejectOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    const shopId = req.user._id;
    
    const order = await Order.findOne({ _id: orderId, shop: shopId });
    
    if (!order) {
      return ResponseHandler.error(res, 'Order not found', 404);
    }
    
    if (order.status !== 'placed') {
      return ResponseHandler.error(res, 'Order already processed', 400);
    }
    
    order.status = 'rejected';
    order.shopRejectedAt = new Date();
    order.rejectionReason = reason;
    order.cancelledBy = 'shop';
    await order.save();
    
    // Notify user
    await PushNotificationService.sendToUser(
      order.user,
      'Order Rejected',
      `Your order was rejected by the shop. Reason: ${reason}`
    );
    
    ResponseHandler.success(res, null, 'Order rejected');
  } catch (error) {
    logger.error(`Reject order error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Shop Updates Order Status (Preparing, Packed)
exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    const shopId = req.user._id;
    
    const order = await Order.findOne({ _id: orderId, shop: shopId }).populate('user');
    
    if (!order) {
      return ResponseHandler.error(res, 'Order not found', 404);
    }
    
    order.status = status;
    
    if (status === 'preparing') {
      order.timestamps.preparingAt = new Date();
    } else if (status === 'packed') {
      order.timestamps.packedAt = new Date();
      
      // Start searching for delivery partner
      order.status = 'searching-delivery';
      order.timestamps.searchingDeliveryAt = new Date();
      await order.save();
      
      // Search for delivery partners
      await searchDeliveryPartners(order);
      
      return ResponseHandler.success(res, { order }, 'Order packed. Searching for delivery partner...');
    }
    
    await order.save();
    
    // Notify user
    const statusMessages = {
      'preparing': 'Your order is being prepared',
      'packed': 'Your order is packed and ready for delivery'
    };
    
    if (statusMessages[status]) {
      await PushNotificationService.sendToUser(
        order.user._id,
        'Order Update',
        statusMessages[status]
      );
    }
    
    ResponseHandler.success(res, { order }, 'Order status updated');
  } catch (error) {
    logger.error(`Update order status error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Search for Delivery Partners
async function searchDeliveryPartners(order) {
  try {
    const shopLocation = order.tracking.shopLocation.coordinates;
    const searchRadius = order.deliverySearchRadius;
    
    // Find available delivery partners (service providers with delivery capability)
    const availablePartners = await ServiceProvider.find({
      verificationStatus: 'approved',
      isActive: true,
      'availability.isAvailable': true,
      serviceCategories: 'Delivery', // Assuming delivery partners have "Delivery" category
      'address.location': {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: shopLocation
          },
          $maxDistance: searchRadius * 1000
        }
      }
    }).limit(15);
    
    if (availablePartners.length === 0) {
      // No delivery partners found, expand radius
      if (order.deliverySearchAttempts < 3 && order.deliverySearchRadius < 10) {
        order.deliverySearchRadius += 2;
        order.deliverySearchAttempts += 1;
        await order.save();
        
        setTimeout(() => searchDeliveryPartners(order), 10000);
        return;
      } else {
        // Cancel order - no delivery partner found
        order.status = 'cancelled';
        order.cancelledBy = 'system';
        order.cancellationReason = 'No delivery partner available';
        await order.save();
        
        await PushNotificationService.sendToUser(
          order.user,
          'Order Cancelled',
          'Sorry, no delivery partner is available. Your payment will be refunded.'
        );
        return;
      }
    }
    
    // Notify all available delivery partners
    for (const partner of availablePartners) {
      order.notifiedDeliveryPartners.push({
        partner: partner._id,
        notifiedAt: new Date(),
        response: 'pending'
      });
      
      const distanceToShop = GeoService.calculateDistance(
        partner.address.location.coordinates[1],
        partner.address.location.coordinates[0],
        shopLocation[1],
        shopLocation[0]
      );
      
      await PushNotificationService.sendToUser(
        partner._id,
        'New Delivery Request',
        `Pickup from shop - ${order.items.length} items - ₹${order.totalAmount}. Distance: ${distanceToShop.toFixed(1)}km`
      );
    }
    
    await order.save();
    
    // Timeout for delivery partner response (30 seconds)
    setTimeout(() => handleDeliveryPartnerTimeout(order._id), 30000);
  } catch (error) {
    logger.error(`Search delivery partners error: ${error.message}`);
  }
}

// Handle Delivery Partner Timeout
async function handleDeliveryPartnerTimeout(orderId) {
  try {
    const order = await Order.findById(orderId);
    
    if (!order || order.status !== 'searching-delivery') {
      return;
    }
    
    // Mark timed-out partners
    order.notifiedDeliveryPartners.forEach(np => {
      if (np.response === 'pending') {
        np.response = 'timeout';
      }
    });
    
    // Expand search
    if (order.deliverySearchAttempts < 3) {
      order.deliverySearchRadius += 2;
      order.deliverySearchAttempts += 1;
      await order.save();
      await searchDeliveryPartners(order);
    } else {
      order.status = 'cancelled';
      order.cancelledBy = 'system';
      order.cancellationReason = 'No delivery partner accepted';
      await order.save();
    }
  } catch (error) {
    logger.error(`Delivery timeout error: ${error.message}`);
  }
}

// Delivery Partner Accepts Order
exports.acceptDelivery = async (req, res) => {
  try {
    const { orderId } = req.params;
    const partnerId = req.user._id;
    
    const order = await Order.findById(orderId).populate('user shop');
    
    if (!order) {
      return ResponseHandler.error(res, 'Order not found', 404);
    }
    
    if (order.status !== 'searching-delivery') {
      return ResponseHandler.error(res, 'Order already assigned', 400);
    }
    
    const notifiedPartner = order.notifiedDeliveryPartners.find(
      np => np.partner.toString() === partnerId.toString()
    );
    
    if (!notifiedPartner || notifiedPartner.response !== 'pending') {
      return ResponseHandler.error(res, 'Cannot accept this delivery', 400);
    }
    
    // Assign delivery partner
    order.deliveryPartner = partnerId;
    order.status = 'out-for-delivery';
    order.timestamps.outForDeliveryAt = new Date();
    
    notifiedPartner.response = 'accepted';
    notifiedPartner.respondedAt = new Date();
    
    // Mark others as timeout
    order.notifiedDeliveryPartners.forEach(np => {
      if (np.response === 'pending' && np.partner.toString() !== partnerId.toString()) {
        np.response = 'timeout';
      }
    });
    
    await order.save();
    
    // Notify user
    const partner = await ServiceProvider.findById(partnerId);
    await PushNotificationService.sendToUser(
      order.user._id,
      'Out for Delivery',
      `${partner.name} is delivering your order. Track your delivery in real-time.`
    );
    
    // Notify shop
    await PushNotificationService.sendToUser(
      order.shop._id,
      'Delivery Partner Assigned',
      `${partner.name} will pick up the order.`
    );
    
    ResponseHandler.success(res, { order }, 'Delivery accepted');
  } catch (error) {
    logger.error(`Accept delivery error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Update Delivery Location (Real-time tracking)
exports.updateDeliveryLocation = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { latitude, longitude } = req.body;
    const partnerId = req.user._id;
    
    const order = await Order.findOne({
      _id: orderId,
      deliveryPartner: partnerId
    });
    
    if (!order) {
      return ResponseHandler.error(res, 'Order not found', 404);
    }
    
    // Update location
    order.tracking.deliveryPartnerLocation = {
      type: 'Point',
      coordinates: [longitude, latitude],
      updatedAt: new Date()
    };
    
    // Calculate distance to delivery address
    const deliveryLocation = order.deliveryAddress.location.coordinates;
    const distance = GeoService.calculateDistance(
      latitude,
      longitude,
      deliveryLocation[1],
      deliveryLocation[0]
    );
    
    order.tracking.distance = distance;
    const durationMinutes = (distance / 20) * 60; // Assuming 20 km/h average
    order.tracking.duration = Math.round(durationMinutes);
    order.tracking.estimatedDeliveryTime = new Date(Date.now() + durationMinutes * 60000);
    
    await order.save();
    
    // Notify user if very close
    if (distance < 0.5) {
      await PushNotificationService.sendToUser(
        order.user,
        'Delivery Nearby',
        'Your delivery partner is nearby and will reach in a few minutes!'
      );
    }
    
    ResponseHandler.success(res, {
      distance,
      duration: durationMinutes,
      estimatedDelivery: order.tracking.estimatedDeliveryTime
    }, 'Location updated');
  } catch (error) {
    logger.error(`Update delivery location error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Mark Order as Delivered
exports.markDelivered = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { otp } = req.body; // Optional OTP verification
    const partnerId = req.user._id;
    
    const order = await Order.findOne({
      _id: orderId,
      deliveryPartner: partnerId
    }).populate('user');
    
    if (!order) {
      return ResponseHandler.error(res, 'Order not found', 404);
    }
    
    order.status = 'delivered';
    order.timestamps.deliveredAt = new Date();
    await order.save();
    
    // Notify user
    await PushNotificationService.sendToUser(
      order.user._id,
      'Order Delivered',
      'Your order has been delivered successfully!'
    );
    
    ResponseHandler.success(res, { order }, 'Order marked as delivered');
  } catch (error) {
    logger.error(`Mark delivered error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Order Tracking (For User)
exports.getOrderTracking = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await Order.findOne({
      _id: orderId,
      user: req.user._id
    }).populate('shop deliveryPartner', 'name phone profilePicture logo');
    
    if (!order) {
      return ResponseHandler.error(res, 'Order not found', 404);
    }
    
    const trackingInfo = {
      orderId: order.orderId,
      status: order.status,
      shop: order.shop,
      deliveryPartner: order.deliveryPartner,
      deliveryLocation: order.tracking.deliveryPartnerLocation,
      distance: order.tracking.distance,
      estimatedDeliveryTime: order.tracking.estimatedDeliveryTime,
      timestamps: order.timestamps
    };
    
    ResponseHandler.success(res, trackingInfo, 'Tracking info fetched');
  } catch (error) {
    logger.error(`Get order tracking error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    
    const order = await Order.findOne({
      _id: orderId,
      user: req.user._id
    }).populate('shop deliveryPartner');
    
    if (!order) {
      return ResponseHandler.error(res, 'Order not found', 404);
    }
    
    // Check if order can be cancelled
    const cancellableStatuses = ['placed', 'accepted', 'preparing'];
    if (!cancellableStatuses.includes(order.status)) {
      return ResponseHandler.error(
        res, 
        'Order cannot be cancelled at this stage', 
        400
      );
    }
    
    // Restore product stock if order was accepted
    if (order.status === 'accepted' || order.status === 'preparing') {
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product, {
          $inc: { 'stock.quantity': item.quantity }
        });
      }
    }
    
    order.status = 'cancelled';
    order.cancelledBy = 'user';
    order.cancellationReason = reason || 'Cancelled by user';
    order.timestamps.cancelledAt = new Date();
    await order.save();
    
    // Notify shop
    if (order.shop) {
      await PushNotificationService.sendToUser(
        order.shop._id,
        'Order Cancelled',
        `Order ${order.orderId} has been cancelled by the customer.`
      );
    }
    
    // Notify delivery partner if assigned
    if (order.deliveryPartner) {
      await PushNotificationService.sendToUser(
        order.deliveryPartner._id,
        'Delivery Cancelled',
        `Delivery for order ${order.orderId} has been cancelled.`
      );
    }
    
    // Process refund if payment was made
    if (order.paymentStatus === 'paid') {
      order.paymentStatus = 'refunded';
      // Add actual refund logic here
    }
    
    await order.save();
    
    ResponseHandler.success(res, { order }, 'Order cancelled successfully');
  } catch (error) {
    logger.error(`Cancel order error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Shop Pending Orders
exports.getShopPendingOrders = async (req, res) => {
  try {
    const shopId = req.user._id;
    const { status = 'placed' } = req.query;
    
    const query = { shop: shopId };
    
    // Filter by status if provided
    if (status) {
      if (status === 'active') {
        query.status = { 
          $in: ['placed', 'accepted', 'preparing', 'packed', 'searching-delivery', 'out-for-delivery'] 
        };
      } else {
        query.status = status;
      }
    }
    
    const orders = await Order.find(query)
      .populate('user', 'name phone profilePicture')
      .populate('deliveryPartner', 'name phone')
      .populate('items.product', 'name images')
      .sort({ createdAt: -1 })
      .limit(50);
    
    const counts = {
      placed: await Order.countDocuments({ shop: shopId, status: 'placed' }),
      accepted: await Order.countDocuments({ shop: shopId, status: 'accepted' }),
      preparing: await Order.countDocuments({ shop: shopId, status: 'preparing' }),
      packed: await Order.countDocuments({ shop: shopId, status: 'packed' }),
      completed: await Order.countDocuments({ shop: shopId, status: 'delivered' })
    };
    
    ResponseHandler.success(res, { orders, counts }, 'Orders fetched successfully');
  } catch (error) {
    logger.error(`Get shop pending orders error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Pending Deliveries (For Delivery Partners)
exports.getPendingDeliveries = async (req, res) => {
  try {
    const partnerId = req.user._id;
    
    // Get orders where this partner was notified and response is pending
    const pendingOrders = await Order.find({
      'notifiedDeliveryPartners.partner': partnerId,
      'notifiedDeliveryPartners.response': 'pending',
      status: 'searching-delivery'
    })
      .populate('shop', 'name address phone logo')
      .populate('user', 'name phone')
      .populate('items.product', 'name images')
      .sort({ 'notifiedDeliveryPartners.notifiedAt': -1 })
      .limit(20);
    
    // Get active deliveries for this partner
    const activeDeliveries = await Order.find({
      deliveryPartner: partnerId,
      status: { $in: ['out-for-delivery'] }
    })
      .populate('shop', 'name address phone logo')
      .populate('user', 'name phone')
      .populate('items.product', 'name images')
      .sort({ 'timestamps.outForDeliveryAt': -1 });
    
    // Get completed deliveries (recent)
    const completedDeliveries = await Order.find({
      deliveryPartner: partnerId,
      status: 'delivered'
    })
      .populate('shop', 'name address logo')
      .populate('user', 'name')
      .sort({ 'timestamps.deliveredAt': -1 })
      .limit(10);
    
    const stats = {
      pending: pendingOrders.length,
      active: activeDeliveries.length,
      completedToday: await Order.countDocuments({
        deliveryPartner: partnerId,
        status: 'delivered',
        'timestamps.deliveredAt': {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      })
    };
    
    ResponseHandler.success(res, {
      pending: pendingOrders,
      active: activeDeliveries,
      completed: completedDeliveries,
      stats
    }, 'Deliveries fetched successfully');
  } catch (error) {
    logger.error(`Get pending deliveries error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Order Details (General - for any role)
exports.getOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;
    
    let query = { _id: orderId };
    
    // Filter based on role
    if (userRole === 'user') {
      query.user = userId;
    } else if (userRole === 'shop') {
      query.shop = userId;
    } else if (userRole === 'provider') {
      query.deliveryPartner = userId;
    }
    
    const order = await Order.findOne(query)
      .populate('user', 'name phone email profilePicture')
      .populate('shop', 'name phone address logo')
      .populate('deliveryPartner', 'name phone profilePicture')
      .populate('items.product', 'name images category');
    
    if (!order) {
      return ResponseHandler.error(res, 'Order not found', 404);
    }
    
    ResponseHandler.success(res, { order }, 'Order details fetched successfully');
  } catch (error) {
    logger.error(`Get order details error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get User Orders (Order History)
exports.getUserOrders = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, page = 1, limit = 20 } = req.query;
    
    const query = { user: userId };
    
    if (status) {
      query.status = status;
    }
    
    const skip = (page - 1) * limit;
    
    const orders = await Order.find(query)
      .populate('shop', 'name logo address')
      .populate('deliveryPartner', 'name phone')
      .populate('items.product', 'name images')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Order.countDocuments(query);
    
    const statusCounts = {
      active: await Order.countDocuments({
        user: userId,
        status: { $in: ['placed', 'accepted', 'preparing', 'packed', 'searching-delivery', 'out-for-delivery'] }
      }),
      completed: await Order.countDocuments({ user: userId, status: 'delivered' }),
      cancelled: await Order.countDocuments({ user: userId, status: 'cancelled' })
    };
    
    ResponseHandler.success(res, {
      orders,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: total
      },
      statusCounts
    }, 'Orders fetched successfully');
  } catch (error) {
    logger.error(`Get user orders error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};


module.exports = exports;