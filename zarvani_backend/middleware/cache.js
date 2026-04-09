// ============= middleware/cache.js =============
const redisClient = require('../config/redis');
const logger = require('../utils/logger');

/**
 * High-performance Redis Cache Middleware
 * Plugs directly into Express routes to cache GET responses
 * @param {number} duration - Seconds to keep in cache (default 300 / 5 mins)
 */
const cacheMiddleware = (duration = 300) => {
    return async (req, res, next) => {
        // Only cache GET requests
        if (req.method !== 'GET') {
            return next();
        }

        const key = `__express__${req.originalUrl || req.url}`;

        try {
            const cachedResponse = await redisClient.get(key);

            if (cachedResponse) {
                logger.info(`⚡ Cache HIT: ${key}`);
                const data = JSON.parse(cachedResponse);
                return res.status(200).json(data);
            } else {
                logger.info(`⏳ Cache MISS: ${key}`);
                // Intercept res.json to cache the response before sending it
                const originalJson = res.json.bind(res);
                
                res.json = (body) => {
                    // Only cache successful responses
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        redisClient.setEx(key, duration, JSON.stringify(body))
                            .catch(err => logger.error(`Cache set error: ${err.message}`));
                    }
                    return originalJson(body);
                };

                next();
            }
        } catch (error) {
            logger.error(`Redis Cache Middleware Error: ${error.message}`);
            // Fallback to next() if Redis is down
            next();
        }
    };
};

module.exports = cacheMiddleware;
