// ============= middleware/idempotency.js =============
const redisClient = require('../config/passport');
const logger = require('../utils/logger');
const ResponseHandler = require('../utils/responseHandler');

/**
 * Idempotency Middleware
 * Prevents duplicate processing of the same request
 */
const idempotency = async (req, res, next) => {
    // Only apply to POST/PUT/PATCH requests
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
        return next();
    }

    const idempotencyKey = req.headers['x-idempotency-key'];
    if (!idempotencyKey) {
        return next();
    }

    const key = `idem:${req.user?._id || req.ip}:${idempotencyKey}`;
    const lockKey = `lock:${key}`;

    try {
        // 1. Check if we already have a cached response for this key
        const cachedResponse = await redisClient.get(key);

        if (cachedResponse) {
            const { statusCode, body } = JSON.parse(cachedResponse);
            logger.info(`Idempotency HIT: ${key} - Returning cached response`);
            return res.status(statusCode).json(body);
        }

        // 2. Acquire Lock (CRITICAL FIX: Prevent 2 simultaneous rapid-fire requests)
        const isLocked = await redisClient.set(lockKey, "1", { NX: true, EX: 10 });
        if (!isLocked) {
            return res.status(409).json({
                success: false,
                message: "Duplicate request in progress"
            });
        }

        // 3. Wrap res.json to cache the response before sending
        const originalJson = res.json;
        res.json = function(body) {
            // Only cache successful or client-error responses (not 5xx)
            if (res.statusCode < 500) {
                const responseData = JSON.stringify({
                    statusCode: res.statusCode,
                    body
                });
                
                // Cache for 24 hours
                redisClient.setEx(key, 86400, responseData).catch(err => {
                    logger.error(`Idempotency Cache Error: ${err.message}`);
                });
            }
            
            // Release lock
            redisClient.del(lockKey).catch(() => {});

            return originalJson.call(this, body);
        };

        next();
    } catch (error) {
        logger.error(`Idempotency Middleware Error: ${error.message}`);
        next();
    }
};

module.exports = idempotency;
