// ============= middleware/requestQueue.js =============
const logger = require('../utils/logger');

/**
 * Request Queue with Backpressure
 * Prevents database connection pool exhaustion
 */
class RequestQueue {
    constructor(options = {}) {
        this.maxConcurrent = options.maxConcurrent || 1000;
        this.maxQueueSize = options.maxQueueSize || 5000;
        this.timeout = options.timeout || 30000; // 30 seconds

        this.currentRequests = 0;
        this.queue = [];
        this.priorityRoutes = new Set(options.priorityRoutes || []);

        // Metrics
        this.metrics = {
            totalProcessed: 0,
            totalQueued: 0,
            totalRejected: 0,
            totalTimeout: 0,
            avgWaitTime: 0
        };

        logger.info(`Request Queue initialized - Max Concurrent: ${this.maxConcurrent}, Max Queue: ${this.maxQueueSize}`);
    }

    /**
     * Check if request should have priority
     */
    isPriority(req) {
        return Array.from(this.priorityRoutes).some(route => {
            if (route.includes('*')) {
                const pattern = route.replace(/\*/g, '.*');
                return new RegExp(pattern).test(req.path);
            }
            return req.path === route;
        });
    }

    /**
     * Middleware function
     */
    middleware() {
        return async (req, res, next) => {
            // Check if we can process immediately
            if (this.currentRequests < this.maxConcurrent) {
                this.currentRequests++;
                this.metrics.totalProcessed++;

                // Process request
                res.on('finish', () => {
                    this.currentRequests--;
                    this.processNext();
                });

                return next();
            }

            // Check if queue is full
            if (this.queue.length >= this.maxQueueSize) {
                this.metrics.totalRejected++;
                logger.warn(`Request queue full (${this.queue.length}/${this.maxQueueSize}), rejecting request from ${req.ip}`);

                return res.status(503).json({
                    success: false,
                    message: 'Service temporarily unavailable due to high load. Please try again later.',
                    retryAfter: 60,
                    queueSize: this.queue.length,
                    maxQueueSize: this.maxQueueSize
                });
            }

            // Queue the request
            const queuedAt = Date.now();
            const isPriority = this.isPriority(req);

            const queueItem = {
                req,
                res,
                next,
                queuedAt,
                isPriority,
                timeout: setTimeout(() => {
                    this.removeFromQueue(queueItem);
                    this.metrics.totalTimeout++;

                    if (!res.headersSent) {
                        logger.warn(`Request timeout after ${this.timeout}ms in queue`);
                        res.status(504).json({
                            success: false,
                            message: 'Request timeout - server is overloaded',
                            waitTime: Date.now() - queuedAt
                        });
                    }
                }, this.timeout)
            };

            // Add to queue (priority at front, normal at back)
            if (isPriority) {
                this.queue.unshift(queueItem);
                logger.info(`Priority request queued: ${req.path}`);
            } else {
                this.queue.push(queueItem);
            }

            this.metrics.totalQueued++;

            // Set header to indicate queuing
            res.setHeader('X-Queue-Position', this.queue.length);
            res.setHeader('X-Queue-Size', this.queue.length);

            logger.debug(`Request queued (${this.queue.length}/${this.maxQueueSize}) - Path: ${req.path}, Priority: ${isPriority}`);
        };
    }

    /**
     * Process next request in queue
     */
    processNext() {
        if (this.queue.length === 0) return;
        if (this.currentRequests >= this.maxConcurrent) return;

        const queueItem = this.queue.shift();
        if (!queueItem) return;

        clearTimeout(queueItem.timeout);

        const waitTime = Date.now() - queueItem.queuedAt;
        this.updateAvgWaitTime(waitTime);

        // Check if response already sent (timeout)
        if (queueItem.res.headersSent) {
            this.processNext(); // Try next item
            return;
        }

        this.currentRequests++;
        this.metrics.totalProcessed++;

        // Set header to indicate wait time
        queueItem.res.setHeader('X-Queue-Time', waitTime);

        logger.debug(`Processing queued request after ${waitTime}ms - Path: ${queueItem.req.path}`);

        // Process request
        queueItem.res.on('finish', () => {
            this.currentRequests--;
            this.processNext();
        });

        queueItem.next();
    }

    /**
     * Remove item from queue
     */
    removeFromQueue(item) {
        const index = this.queue.indexOf(item);
        if (index > -1) {
            this.queue.splice(index, 1);
        }
    }

    /**
     * Update average wait time
     */
    updateAvgWaitTime(waitTime) {
        const alpha = 0.1; // Smoothing factor
        this.metrics.avgWaitTime = (alpha * waitTime) + ((1 - alpha) * this.metrics.avgWaitTime);
    }

    /**
     * Get current metrics
     */
    getMetrics() {
        return {
            currentRequests: this.currentRequests,
            queueSize: this.queue.length,
            maxConcurrent: this.maxConcurrent,
            maxQueueSize: this.maxQueueSize,
            utilization: (this.currentRequests / this.maxConcurrent * 100).toFixed(2) + '%',
            queueUtilization: (this.queue.length / this.maxQueueSize * 100).toFixed(2) + '%',
            ...this.metrics,
            avgWaitTime: Math.round(this.metrics.avgWaitTime)
        };
    }

    /**
     * Reset metrics
     */
    resetMetrics() {
        this.metrics = {
            totalProcessed: 0,
            totalQueued: 0,
            totalRejected: 0,
            totalTimeout: 0,
            avgWaitTime: 0
        };
        logger.info('Request queue metrics reset');
    }
}

// Create singleton instance
const requestQueue = new RequestQueue({
    maxConcurrent: parseInt(process.env.REQUEST_QUEUE_MAX_CONCURRENT) || 1000,
    maxQueueSize: parseInt(process.env.REQUEST_QUEUE_MAX_SIZE) || 5000,
    timeout: parseInt(process.env.REQUEST_QUEUE_TIMEOUT) || 30000,
    priorityRoutes: [
        '/api/v1/bookings/create',
        '/api/v1/orders/create',
        '/api/v1/payments/*',
        '/api/v1/auth/login',
        '/api/v1/auth/register'
    ]
});

module.exports = requestQueue;
