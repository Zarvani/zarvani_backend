const logger = require('../utils/logger');

/**
 * Simple Circuit Breaker Wrapper
 * Prevents application crashes if Redis becomes unresponsive
 */
const circuitBreaker = {
    execute: async (name, operation, fallback) => {
        try {
            return await operation();
        } catch (error) {
            logger.error(`CircuitBreaker (${name}) Error: ${error.message}`);
            if (fallback) return await fallback();
            return null;
        }
    }
};

/**
 * Cache Service for Redis
 * Provides caching functionality with automatic JSON serialization
 * Supports TTL, invalidation, and pattern-based deletion
 */
class CacheService {
    constructor() {
        this.redis = null;
        this.enabled = false;
    }

    /**
     * Initialize Redis client
     * @param {Object} redisClient - Redis client instance
     */
    initialize(redisClient) {
        this.redis = redisClient;
        this.enabled = true;
        logger.info('✅ CacheService initialized');
    }

    /**
     * Get value from cache
     * @param {string} key - Cache key
     * @returns {Promise<any|null>} Cached value or null
     */
    async get(key) {
        if (!this.enabled || !this.redis) return null;

        return await circuitBreaker.execute('redis', async () => {
            const data = await this.redis.get(key);
            if (!data) return null;

            const parsed = JSON.parse(data);
            logger.debug(`Cache HIT: ${key}`);
            return parsed;
        }, async () => {
            logger.warn(`Redis Circuit OPEN: Cache MISS for ${key}`);
            return null;
        });
    }

    /**
     * Set value in cache
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} ttl - Time to live in seconds (default: 300 = 5 minutes)
     * @returns {Promise<boolean>} Success status
     */
    async set(key, value, ttl = 300) {
        if (!this.enabled || !this.redis) return false;

        return await circuitBreaker.execute('redis', async () => {
            const serialized = JSON.stringify(value);
            await this.redis.set(key, serialized, { EX: ttl });
            logger.debug(`Cache SET: ${key} (TTL: ${ttl}s)`);
            return true;
        }, async () => {
            logger.warn(`Redis Circuit OPEN: Skipping SET for ${key}`);
            return false;
        });
    }

    /**
     * Delete single key from cache
     * @param {string} key - Cache key
     * @returns {Promise<boolean>} Success status
     */
    async del(key) {
        if (!this.enabled || !this.redis) return false;

        return await circuitBreaker.execute('redis', async () => {
            await this.redis.del(key);
            logger.debug(`Cache DEL: ${key}`);
            return true;
        }, async () => {
            logger.warn(`Redis Circuit OPEN: Skipping DEL for ${key}`);
            return false;
        });
    }

    /**
     * Delete multiple keys matching pattern
     * Safely uses SCAN instead of KEYS to prevent Redis blocking
     * @param {string} pattern - Pattern to match (e.g., 'user:*')
     * @returns {Promise<number>} Number of keys deleted
     */
    async delPattern(pattern) {
        if (!this.enabled || !this.redis) return 0;

        try {
            let cursor = '0';
            const keysToDelete = [];

            do {
                const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                // The structure of result might be [cursor, [keys]] depending on redis client version (ioredis vs node-redis)
                // Assuming ioredis format:
                cursor = result[0];
                const matchedKeys = result[1];
                
                if (matchedKeys && matchedKeys.length > 0) {
                    keysToDelete.push(...matchedKeys);
                }
            } while (cursor !== '0');

            if (keysToDelete.length === 0) return 0;

            // Delete in batches if necessary, but native .del handles arrays well
            await this.redis.del(...keysToDelete);
            logger.debug(`Cache DEL pattern: ${pattern} (${keysToDelete.length} keys)`);
            return keysToDelete.length;
        } catch (error) {
            logger.error(`Cache DEL pattern error for ${pattern}: ${error.message}`);
            return 0;
        }
    }

    /**
     * Check if key exists in cache
     * @param {string} key - Cache key
     * @returns {Promise<boolean>} Existence status
     */
    async exists(key) {
        if (!this.enabled || !this.redis) return false;

        try {
            const result = await this.redis.exists(key);
            return result === 1;
        } catch (error) {
            logger.error(`Cache EXISTS error for key ${key}: ${error.message}`);
            return false;
        }
    }

    /**
     * Get or set pattern - fetch from cache or execute function and cache result
     * @param {string} key - Cache key
     * @param {Function} fetchFn - Function to execute if cache miss
     * @param {number} ttl - Time to live in seconds
     * @returns {Promise<any>} Cached or fetched value
     */
    async getOrSet(key, fetchFn, ttl = 300) {
        // Try to get from cache
        const cached = await this.get(key);
        if (cached !== null) {
            return cached;
        }

        // Cache miss - fetch data
        logger.debug(`Cache MISS: ${key} - Fetching...`);
        const data = await fetchFn();

        // Cache the result
        await this.set(key, data, ttl);

        return data;
    }

    /**
     * Increment a counter in cache
     * @param {string} key - Cache key
     * @param {number} increment - Amount to increment (default: 1)
     * @returns {Promise<number>} New value
     */
    async incr(key, increment = 1) {
        if (!this.enabled || !this.redis) return 0;

        try {
            const result = await this.redis.incrby(key, increment);
            return result;
        } catch (error) {
            logger.error(`Cache INCR error for key ${key}: ${error.message}`);
            return 0;
        }
    }

    /**
     * Set expiration time for existing key
     * @param {string} key - Cache key
     * @param {number} ttl - Time to live in seconds
     * @returns {Promise<boolean>} Success status
     */
    async expire(key, ttl) {
        if (!this.enabled || !this.redis) return false;

        try {
            await this.redis.expire(key, ttl);
            return true;
        } catch (error) {
            logger.error(`Cache EXPIRE error for key ${key}: ${error.message}`);
            return false;
        }
    }

    /**
     * Clear all cache (use with caution!)
     * @returns {Promise<boolean>} Success status
     */
    async flush() {
        if (!this.enabled || !this.redis) return false;

        try {
            await this.redis.flushdb();
            logger.warn('⚠️ Cache FLUSHED - All keys deleted');
            return true;
        } catch (error) {
            logger.error(`Cache FLUSH error: ${error.message}`);
            return false;
        }
    }

    /**
     * Generate cache key for user-specific data
     * @param {string} userId - User ID
     * @param {string} suffix - Key suffix
     * @returns {string} Cache key
     */
    userKey(userId, suffix) {
        return `user:${userId}:${suffix}`;
    }

    /**
     * Generate cache key for shop-specific data
     * @param {string} shopId - Shop ID
     * @param {string} suffix - Key suffix
     * @returns {string} Cache key
     */
    shopKey(shopId, suffix) {
        return `shop:${shopId}:${suffix}`;
    }

    /**
     * Generate cache key for product-specific data
     * @param {string} productId - Product ID
     * @param {string} suffix - Key suffix
     * @returns {string} Cache key
     */
    productKey(productId, suffix = '') {
        return suffix ? `product:${productId}:${suffix}` : `product:${productId}`;
    }

    /**
     * Generate cache key for order-specific data
     * @param {string} orderId - Order ID
     * @param {string} suffix - Key suffix
     * @returns {string} Cache key
     */
    orderKey(orderId, suffix = '') {
        return suffix ? `order:${orderId}:${suffix}` : `order:${orderId}`;
    }

    /**
     * Invalidate user-related cache
     * @param {string} userId - User ID
     * @returns {Promise<number>} Number of keys deleted
     */
    async invalidateUser(userId) {
        return await this.delPattern(`user:${userId}:*`);
    }

    /**
     * Invalidate shop-related cache
     * @param {string} shopId - Shop ID
     * @returns {Promise<number>} Number of keys deleted
     */
    async invalidateShop(shopId) {
        return await this.delPattern(`shop:${shopId}:*`);
    }

    /**
     * Invalidate product-related cache
     * @param {string} productId - Product ID
     * @returns {Promise<number>} Number of keys deleted
     */
    async invalidateProduct(productId) {
        return await this.delPattern(`product:${productId}*`);
    }

    /**
     * Invalidate order-related cache
     * @param {string} orderId - Order ID
     * @returns {Promise<number>} Number of keys deleted
     */
    async invalidateOrder(orderId) {
        return await this.delPattern(`order:${orderId}*`);
    }
}

// Export singleton instance
module.exports = new CacheService();
