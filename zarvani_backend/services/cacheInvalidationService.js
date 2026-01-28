// ============= services/cacheInvalidationService.js =============
const CacheService = require('./cacheService');
const logger = require('../utils/logger');

/**
 * Centralized Cache Invalidation Service
 * 
 * Provides a single source of truth for cache invalidation across all entities.
 * Eliminates duplicate cache invalidation functions in controllers.
 */
class CacheInvalidationService {
    /**
     * Generic cache invalidation for any entity type
     * @param {String} entityType - Type of entity (order, product, booking, shop)
     * @param {Object} entity - The entity object
     * @param {Object} options - Additional options for cache invalidation
     */
    static async invalidateEntity(entityType, entity, options = {}) {
        try {
            switch (entityType) {
                case 'order':
                    await this.invalidateOrder(entity);
                    break;
                case 'product':
                    await this.invalidateProduct(entity);
                    break;
                case 'booking':
                    await this.invalidateBooking(entity);
                    break;
                case 'shop':
                    await this.invalidateShop(entity, options.type);
                    break;
                default:
                    logger.warn(`Unknown entity type for cache invalidation: ${entityType}`);
            }
        } catch (error) {
            logger.error(`Cache invalidation error for ${entityType}: ${error.message}`);
        }
    }

    /**
     * Invalidate order cache
     * @param {Object} order - Order document
     */
    static async invalidateOrder(order) {
        const cacheKeys = [
            `user:${order.user}:orders:*`,
            `shop:${order.shop}:orders:*`,
            `order:${order._id}`,
            `order:${order._id}:details`,
            `order:${order._id}:tracking`
        ];

        for (const key of cacheKeys) {
            if (key.includes('*')) {
                await CacheService.delPattern(key);
            } else {
                await CacheService.del(key);
            }
        }

        logger.debug(`Cache invalidated for order ${order._id}`);
    }

    /**
     * Invalidate product cache
     * @param {Object} product - Product document
     */
    static async invalidateProduct(product) {
        try {
            // Invalidate all products cache
            await CacheService.delPattern('products:all:*');

            // Invalidate shop's product cache
            if (product.shop) {
                await CacheService.delPattern(`shop:${product.shop}:*`);
            }

            // Invalidate specific product cache
            if (product._id) {
                await CacheService.delPattern(`product:${product._id}*`);
            }

            logger.debug(`Cache invalidated for product ${product._id}`);
        } catch (error) {
            logger.error(`Product cache invalidation error: ${error.message}`);
        }
    }

    /**
     * Invalidate booking cache
     * @param {Object} booking - Booking document
     */
    static async invalidateBooking(booking) {
        const cacheKeys = [
            `user:${booking.user}:bookings:*`,
            `provider:${booking.provider}:bookings:*`,
            `booking:${booking._id}`,
            `booking:${booking._id}:details`,
            `booking:${booking._id}:tracking`
        ];

        for (const key of cacheKeys) {
            if (key.includes('*')) {
                await CacheService.delPattern(key);
            } else {
                await CacheService.del(key);
            }
        }

        logger.debug(`Cache invalidated for booking ${booking._id}`);
    }

    /**
     * Invalidate shop cache
     * @param {String|Object} shopId - Shop ID or shop object
     * @param {String} type - Type of cache to invalidate (all, products, orders)
     */
    static async invalidateShop(shopId, type = 'all') {
        const id = typeof shopId === 'object' ? shopId._id : shopId;

        const patterns = {
            all: [`shop:${id}:*`],
            products: [`shop:${id}:products:*`],
            orders: [`shop:${id}:orders:*`]
        };

        const keysToInvalidate = patterns[type] || patterns.all;

        for (const pattern of keysToInvalidate) {
            await CacheService.delPattern(pattern);
        }

        logger.debug(`Cache invalidated for shop ${id} (type: ${type})`);
    }

    /**
     * Invalidate user cache
     * @param {String|Object} userId - User ID or user object
     */
    static async invalidateUser(userId) {
        const id = typeof userId === 'object' ? userId._id : userId;

        await CacheService.delPattern(`user:${id}:*`);
        logger.debug(`Cache invalidated for user ${id}`);
    }

    /**
     * Invalidate provider cache
     * @param {String|Object} providerId - Provider ID or provider object
     */
    static async invalidateProvider(providerId) {
        const id = typeof providerId === 'object' ? providerId._id : providerId;

        await CacheService.delPattern(`provider:${id}:*`);
        logger.debug(`Cache invalidated for provider ${id}`);
    }
}

module.exports = CacheInvalidationService;
