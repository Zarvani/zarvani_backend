// ============= utils/distributedLock.js =============
const redisClient = require('../config/redis');
const logger = require('./logger');

class DistributedLock {
    /**
     * Acquire a lock on a resource
     * @param {string} resource - Unique identifier for the resource (e.g., 'booking:123')
     * @param {number} ttl - Lock expiration time in milliseconds (default: 30s)
     * @returns {string|null} - Lock token if acquired, null otherwise
     */
    static async acquire(resource, ttl = 30000) {
        const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
        const lockKey = `lock:${resource}`;

        try {
            // SET key value NX PX ttl
            // NX: Only set if key doesn't exist
            // PX: Set expiration in milliseconds
            const result = await redisClient.set(lockKey, token, {
                NX: true,
                PX: ttl
            });

            if (result === 'OK') {
                logger.debug(`Lock ACQUIRED: ${lockKey} (Token: ${token})`);
                return token;
            }

            return null;
        } catch (error) {
            logger.error(`Distributed Lock Acquisition Error: ${error.message}`);
            return null;
        }
    }

    /**
     * Release a lock safely using a Lua script
     * @param {string} resource - Unique identifier for the resource
     * @param {string} token - The token received when acquiring the lock
     */
    static async release(resource, token) {
        const lockKey = `lock:${resource}`;
        
        // Lua script ensures atomicity: only delete if the token matches
        const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;

        try {
            const result = await redisClient.eval(script, {
                keys: [lockKey],
                arguments: [token]
            });

            if (result === 1) {
                logger.debug(`Lock RELEASED: ${lockKey}`);
                return true;
            } else {
                logger.warn(`Lock RELEASE FAILED: ${lockKey} (Token mismatch or expired)`);
                return false;
            }
        } catch (error) {
            logger.error(`Distributed Lock Release Error: ${error.message}`);
            return false;
        }
    }
}

module.exports = DistributedLock;
