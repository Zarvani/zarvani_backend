// ============= middleware/circuitBreaker.js =============
const logger = require('../utils/logger');

/**
 * Circuit Breaker States
 */
const CircuitState = {
    CLOSED: 'CLOSED',     // Normal operation
    OPEN: 'OPEN',         // Service is down, fail fast
    HALF_OPEN: 'HALF_OPEN' // Testing if service recovered
};

/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures when services are down
 */
class CircuitBreaker {
    constructor(name, options = {}) {
        this.name = name;
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.nextAttempt = Date.now();

        // Configuration
        this.failureThreshold = options.failureThreshold || 5;
        this.successThreshold = options.successThreshold || 2;
        this.timeout = options.timeout || 60000; // 60 seconds

        logger.info(`Circuit Breaker initialized for ${name}`);
    }

    /**
     * Execute function with circuit breaker protection
     */
    async execute(fn, fallback = null) {
        // Check if circuit is open
        if (this.state === CircuitState.OPEN) {
            if (Date.now() < this.nextAttempt) {
                logger.warn(`Circuit OPEN for ${this.name}, failing fast`);

                if (fallback) {
                    return await fallback();
                }

                throw new Error(`Service ${this.name} is temporarily unavailable`);
            }

            // Timeout expired, try half-open
            this.state = CircuitState.HALF_OPEN;
            logger.info(`Circuit HALF_OPEN for ${this.name}, testing recovery`);
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure(error);

            if (fallback) {
                logger.info(`Using fallback for ${this.name}`);
                return await fallback();
            }

            throw error;
        }
    }

    /**
     * Handle successful execution
     */
    onSuccess() {
        this.failureCount = 0;

        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;

            if (this.successCount >= this.successThreshold) {
                this.state = CircuitState.CLOSED;
                this.successCount = 0;
                logger.info(`✅ Circuit CLOSED for ${this.name} - Service recovered`);
            }
        }
    }

    /**
     * Handle failed execution
     */
    onFailure(error) {
        this.failureCount++;
        logger.error(`Circuit failure for ${this.name}: ${error.message} (${this.failureCount}/${this.failureThreshold})`);

        if (this.state === CircuitState.HALF_OPEN) {
            this.state = CircuitState.OPEN;
            this.nextAttempt = Date.now() + this.timeout;
            this.successCount = 0;
            logger.warn(`❌ Circuit OPEN for ${this.name} - Recovery failed`);
            return;
        }

        if (this.failureCount >= this.failureThreshold) {
            this.state = CircuitState.OPEN;
            this.nextAttempt = Date.now() + this.timeout;
            logger.warn(`❌ Circuit OPEN for ${this.name} - Threshold reached`);
        }
    }

    /**
     * Get current circuit status
     */
    getStatus() {
        return {
            name: this.name,
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            nextAttempt: this.state === CircuitState.OPEN ? new Date(this.nextAttempt) : null
        };
    }

    /**
     * Manually reset circuit breaker
     */
    reset() {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.nextAttempt = Date.now();
        logger.info(`Circuit manually reset for ${this.name}`);
    }
}

/**
 * Circuit Breaker Manager
 * Manages multiple circuit breakers for different services
 */
class CircuitBreakerManager {
    constructor() {
        this.breakers = new Map();
    }

    /**
     * Get or create circuit breaker for service
     */
    getBreaker(serviceName, options = {}) {
        if (!this.breakers.has(serviceName)) {
            this.breakers.set(serviceName, new CircuitBreaker(serviceName, options));
        }
        return this.breakers.get(serviceName);
    }

    /**
     * Execute function with circuit breaker
     */
    async execute(serviceName, fn, fallback = null, options = {}) {
        const breaker = this.getBreaker(serviceName, options);
        return await breaker.execute(fn, fallback);
    }

    /**
     * Get status of all circuit breakers
     */
    getAllStatus() {
        const status = {};
        for (const [name, breaker] of this.breakers) {
            status[name] = breaker.getStatus();
        }
        return status;
    }

    /**
     * Reset specific circuit breaker
     */
    reset(serviceName) {
        const breaker = this.breakers.get(serviceName);
        if (breaker) {
            breaker.reset();
        }
    }

    /**
     * Reset all circuit breakers
     */
    resetAll() {
        for (const breaker of this.breakers.values()) {
            breaker.reset();
        }
        logger.info('All circuit breakers reset');
    }
}

// Export singleton instance
const circuitBreakerManager = new CircuitBreakerManager();

module.exports = {
    CircuitBreaker,
    CircuitBreakerManager,
    circuitBreaker: circuitBreakerManager,
    CircuitState
};
