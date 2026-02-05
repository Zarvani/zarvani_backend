// ============= services/orderService.js =============
const Order = require('../models/Order');
const Product = require('../models/Product');
const Shop = require('../models/Shop');
const User = require('../models/User');
const GeoService = require('./geoService');
const NotificationService = require('./notificationService');
const CacheInvalidationService = require('./cacheInvalidationService');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

class OrderService {
    /**
     * Helper: Generate unique order ID
     */
    static generateOrderId() {
        const timestamp = Date.now().toString().slice(-8);
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        return `ORD${timestamp}${random}`;
    }

    /**
     * Calculate delivery fee based on shop settings and distance
     */
    static calculateDeliveryFee(shop, distance, orderAmount) {
        const settings = shop.deliverySettings;
        if (!settings || !settings.deliveryFee) return 0;

        if (orderAmount >= settings.deliveryFee.freeDeliveryAbove) return 0;

        let fee = settings.deliveryFee.baseFee;
        if (distance > 1) {
            fee += Math.ceil(distance - 1) * settings.deliveryFee.perKm;
        }

        const maxFee = settings.deliveryFee.baseFee + (settings.radius * settings.deliveryFee.perKm);
        return Math.min(fee, maxFee);
    }

    /**
     * Comprehensive Order Creation
     */
    static async createOrder(data, app = null) {
        const { userId, body, platformInfo } = data;
        const {
            shopId, items, deliveryAddressId, paymentMethod,
            couponCode, tip = 0, notes, deliveryType = 'standard'
        } = body;

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // 1. Fetch Basic Entities
            const user = await User.findById(userId).session(session);
            if (!user) throw new Error('User not found');

            const deliveryAddress = user.addresses.id(deliveryAddressId);
            if (!deliveryAddress) throw new Error('Delivery address not found');

            const shop = await Shop.findById(shopId).session(session);
            if (!shop || !shop.isActive || !shop.isOpen) throw new Error('Shop is not available');

            // 2. Logistics: Distance & Delivery Validation
            const distance = GeoService.calculateDistance(
                shop.address.location.coordinates[1],
                shop.address.location.coordinates[0],
                deliveryAddress.location.coordinates[1],
                deliveryAddress.location.coordinates[0]
            );

            if (distance > shop.deliverySettings.radius) {
                throw new Error(`Location is outside shop's delivery radius (${shop.deliverySettings.radius}km)`);
            }

            // 3. Product Validation & Batch Stock Check
            const productIds = items.map(i => i.productId);
            const products = await Product.find({ _id: { $in: productIds } }).session(session);
            const productMap = new Map(products.map(p => [p._id.toString(), p]));

            let itemsTotal = 0;
            let savings = 0;
            const orderItems = [];


            for (const item of items) {
                const product = productMap.get(item.productId.toString());
                if (!product || !product.isAvailable) throw new Error(`Product ${product?.name || item.productId} not available`);

                // ATOMIC OPERATION: Deduct stock only if sufficient quantity exists
                const updatedProduct = await Product.findOneAndUpdate(
                    {
                        _id: item.productId,
                        'stock.quantity': { $gte: item.quantity }
                    },
                    { $inc: { 'stock.quantity': -item.quantity } },
                    { session, new: true }
                );

                if (!updatedProduct) {
                    throw new Error(`Insufficient stock for ${product.name}. Only ${product.stock.quantity} left.`);
                }

                const itemTotal = product.price.sellingPrice * item.quantity;
                const itemSavings = (product.price.mrp - product.price.sellingPrice) * item.quantity;

                itemsTotal += itemTotal;
                savings += itemSavings;

                orderItems.push({
                    product: product._id,
                    name: product.name,
                    image: product.images[0]?.url,
                    quantity: item.quantity,
                    price: product.price,
                    total: itemTotal,
                    weight: product.weight
                });
            }

            if (itemsTotal < shop.deliverySettings.minOrderAmount) {
                throw new Error(`Minimum order amount is ₹${shop.deliverySettings.minOrderAmount}`);
            }

            // 4. Final Pricing Logic
            const deliveryFee = this.calculateDeliveryFee(shop, distance, itemsTotal);
            const packagingCharge = shop.deliverySettings.packagingCharge || 0;
            const tax = Math.round(itemsTotal * 0.05); // 5% GST
            const discountAmount = couponCode ? 0 : 0; // TODO: Implement proper coupon service

            const subtotal = itemsTotal + deliveryFee + packagingCharge + tax - discountAmount;
            const totalAmount = subtotal + tip;

            // 5. Build Order Object
            const order = new Order({
                orderId: this.generateOrderId(),
                user: userId,
                shop: shopId,
                items: orderItems,
                deliveryAddress: deliveryAddress.toObject(),
                status: 'pending',
                pricing: {
                    itemsTotal, tax, deliveryFee, packagingCharge, tip,
                    discount: { couponCode, amount: discountAmount },
                    subtotal, totalAmount, savings
                },
                payment: { method: paymentMethod, status: paymentMethod === 'cod' ? 'pending' : 'paid' },
                customerInfo: { name: user.name, phone: user.phone },
                shopInfo: { name: shop.name, phone: shop.phone, address: shop.address.formattedAddress },
                source: platformInfo.platform,
                deviceInfo: platformInfo.device
            });

            // 6. Update Shop Statistics
            await Shop.findByIdAndUpdate(shopId, {
                $inc: {
                    'orderStats.total': 1,
                    'orderStats.today': 1,
                    'orderStats.pending': 1,
                    'earnings.total': totalAmount,
                    'earnings.pending': paymentMethod === 'cod' ? totalAmount : 0
                }
            }, { session });

            await order.save({ session });
            await session.commitTransaction();
            session.endSession();

            // 7. Invalidate order cache (outside transaction)
            await CacheInvalidationService.invalidateOrder(order).catch(e => logger.error(`Cache invalidation error: ${e.message}`));

            // 8. Trigger Notifications (outside transaction)
            NotificationService.send({
                recipient: shopId,
                recipientType: 'Shop',
                type: 'booking',
                title: 'New Order!',
                message: `Order #${order.orderId} received for ₹${totalAmount}`,
                data: { orderId: order._id }
            }, app).catch(e => logger.error(`Shop Notify Error: ${e.message}`));

            return order;

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            throw error;
        }
    }

    static async updateStatus(orderId, shopId, status, app = null) {
        const order = await Order.findOne({ _id: orderId, shop: shopId });
        if (!order) throw new Error('Order not found');

        order.status = status;
        if (status === 'confirmed') order.timestamps.confirmedAt = new Date();

        await order.save();

        // Invalidate cache
        await CacheInvalidationService.invalidateOrder(order).catch(e => logger.error(`Cache invalidation error: ${e.message}`));

        NotificationService.send({
            recipient: order.user,
            recipientType: 'User',
            type: 'booking',
            title: 'Order Status Update',
            message: `Your order ${order.orderId} is now ${status.replace('_', ' ')}`,
            data: { orderId: order._id, status }
        }, app).catch(err => logger.error(`User Notify Error: ${err.message}`));

        return order;
    }

    /**
     * Shop Accepts Order and assigns delivery boy
     */
    static async acceptOrder(orderId, shopId, app = null) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const order = await Order.findOne({ _id: orderId, shop: shopId, status: 'pending' }).session(session);
            if (!order) throw new Error('Order not found or already processed');

            const shop = await Shop.findById(shopId).session(session);
            const deliveryBoy = await shop.assignDeliveryBoy(orderId, session);
            if (!deliveryBoy) throw new Error('No delivery boy available');

            order.status = 'confirmed';
            order.deliveryBoy = deliveryBoy._id;
            order.timestamps.confirmedAt = new Date();

            await Shop.findByIdAndUpdate(shopId, {
                $inc: { 'orderStats.pending': -1, 'orderStats.preparing': 1 }
            }, { session });

            await order.save({ session });
            await session.commitTransaction();
            session.endSession();

            // Invalidate cache (outside transaction)
            await CacheInvalidationService.invalidateOrder(order).catch(e => logger.error(`Cache invalidation error: ${e.message}`));

            // Send notification (outside transaction)
            NotificationService.send({
                recipient: order.user,
                recipientType: 'User',
                type: 'booking',
                title: 'Order Confirmed',
                message: `Your order ${order.orderId} has been accepted and is being prepared.`,
                data: { orderId: order._id, status: 'confirmed' }
            }, app).catch(e => logger.error(`Confirm Notify Error: ${e.message}`));

            return order;
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            throw error;
        }
    }

    /**
     * Shop Rejects Order
     */
    static async rejectOrder(orderId, shopId, reason, app = null) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const order = await Order.findOne({ _id: orderId, shop: shopId, status: 'pending' }).session(session);
            if (!order) throw new Error('Order not found or already processed');

            order.status = 'cancelled';
            order.notes = reason;
            order.timestamps.cancelledAt = new Date();

            // Restore stock
            for (const item of order.items) {
                await Product.findByIdAndUpdate(item.product, { $inc: { 'stock.quantity': item.quantity } }, { session });
            }

            await Shop.findByIdAndUpdate(shopId, {
                $inc: { 'orderStats.pending': -1, 'orderStats.cancelled': 1 }
            }, { session });

            await order.save({ session });
            await session.commitTransaction();
            session.endSession();

            // Invalidate cache (outside transaction)
            await CacheInvalidationService.invalidateOrder(order).catch(e => logger.error(`Cache invalidation error: ${e.message}`));

            // Send notification (outside transaction)
            NotificationService.send({
                recipient: order.user,
                recipientType: 'User',
                type: 'alert',
                title: 'Order Cancelled',
                message: `Your order ${order.orderId} was rejected by the shop. Reason: ${reason}`,
                data: { orderId: order._id, status: 'cancelled' }
            }, app).catch(e => logger.error(`Reject Notify Error: ${e.message}`));

            return order;
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            throw error;
        }
    }

    // Cache invalidation now handled by CacheInvalidationService
}

module.exports = OrderService;
