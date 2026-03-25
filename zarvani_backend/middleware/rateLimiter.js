// ============= middleware/rateLimiter.js =============
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redisClient = require('../config/redis');
const logger = require('../utils/logger');

/**
 * Fallback handler when Redis is down
 * Uses memory store to prevent app crashes
 */
const createFallbackLimiter = (windowMs, max, message) => {
    logger.warn('⚠️ Using memory-based rate limiter (Redis unavailable)');
    return rateLimit({
        windowMs,
        max,
        message: { success: false, message },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
            res.status(429).json({
                success: false,
                message,
                retryAfter: Math.ceil(windowMs / 1000)
            });
        }
    });
};

/**
 * Create Redis-based rate limiter with fallback
 */
const createRateLimiter = (options) => {
    const { windowMs, max, message, skipSuccessfulRequests = false } = options;

    try {
        return rateLimit({
            windowMs,
            max,
            message: { success: false, message },
            standardHeaders: true,
            legacyHeaders: false,
            skipSuccessfulRequests,

            // Hybrid Key Generator: UserID + IP (prevents authorized users from spamming across IPs)
            keyGenerator: (req) => {
                return req.user ? `${req.user._id}:${req.ip}` : req.ip;
            },

            // Redis store with error handling
            store: new RedisStore({
                sendCommand: (...args) => redisClient.sendCommand(args),
                prefix: 'rl:',
            }),

            // Custom handler for better error messages
            handler: (req, res) => {
                const retryAfter = Math.ceil(windowMs / 1000);
                logger.warn(`Rate limit exceeded - IP: ${req.ip}, Path: ${req.path}`);

                res.status(429).json({
                    success: false,
                    message,
                    retryAfter,
                    limit: max,
                    windowMs
                });
            },

            // Skip rate limiting for certain conditions
            skip: (req) => {
                // Skip for health checks
                if (req.path === '/health') return true;

                // Skip for admin with special header (emergency access)
                if (req.headers['x-admin-override'] === process.env.ADMIN_OVERRIDE_KEY) {
                    logger.info(`Admin override used by IP: ${req.ip}`);
                    return true;
                }

                return false;
            },

            // ✅ Disable validations to allow multiple rate limiters (Defense in Depth)
            validate: false
        });
    } catch (error) {
        logger.error(`Failed to create Redis rate limiter: ${error.message}`);
        return createFallbackLimiter(windowMs, max, message);
    }
};

// ==================== RATE LIMITERS ====================

/**
 * 1. Global API Rate Limiter
 * Applies to all /api/* routes
 */
const globalLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per 15 minutes per IP
    message: 'Too many requests from this IP, please try again after 15 minutes'
});

/**
 * 2. Authentication Rate Limiter (Strictest)
 * Prevents brute force attacks
 */
const authLimiter = createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // 5 requests per minute
    message: 'Too many login attempts, please try again after 1 minute',
    skipSuccessfulRequests: true // Only count failed attempts
});

/**
 * 3. API Rate Limiter (Standard)
 * For general API endpoints
 */
const apiLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // 200 requests per 15 minutes
    message: 'API rate limit exceeded, please try again later'
});

/**
 * 4. Upload Rate Limiter (Strict)
 * Prevents abuse of file upload endpoints
 */
const uploadLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 uploads per hour
    message: 'Upload limit exceeded, please try again after 1 hour'
});

/**
 * 5. User-based Rate Limiter
 * Limits based on authenticated user ID
 */
const createUserLimiter = (max = 500) => {
    return rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max,
        message: { success: false, message: 'User rate limit exceeded' },
        standardHeaders: true,
        legacyHeaders: false,

        // Use user ID as key instead of IP
        keyGenerator: (req) => {
            return req.user?._id?.toString() || req.ip;
        },

        store: new RedisStore({
            sendCommand: (...args) => redisClient.sendCommand(args),
            prefix: 'rl:user:',
        }),

        handler: (req, res) => {
            res.status(429).json({
                success: false,
                message: 'You have exceeded your request limit. Please try again later.',
                retryAfter: 900 // 15 minutes
            });
        },

        // ✅ Disable validations to allow multiple rate limiters
        validate: false
    });
};

/**
 * 6. Endpoint-specific Rate Limiter
 * For critical endpoints that need custom limits
 */
const createEndpointLimiter = (endpoint, max, windowMs) => {
    return createRateLimiter({
        windowMs,
        max,
        message: `Rate limit exceeded for ${endpoint}`
    });
};

/**
 * 7. Strict Throttler (Brute-force protection)
 * Very strict limits for sensitive endpoints
 */
const strictThrottler = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 requests per 15 mins
    message: 'Too many requests. Please try again after 15 minutes.'
});
/**
 * 8. Burst Protection Limiter
 * Short window to prevent sudden spikes
 */
const burstLimiter = createRateLimiter({
    windowMs: 10 * 1000, // 10 seconds
    max: 10, // 10 requests per 10 seconds
    message: 'Too many requests in a short time. Please slow down.'
});

module.exports = {
    globalLimiter,
    authLimiter,
    apiLimiter,
    uploadLimiter,
    createUserLimiter,
    createEndpointLimiter,
    strictThrottler,
    burstLimiter
};
