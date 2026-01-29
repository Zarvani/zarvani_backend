// ============= middleware/errorHandler.js =============
const logger = require('../utils/logger');

/**
 * Error Types Classification
 */
const ErrorTypes = {
  RATE_LIMIT: { code: 429, recoverable: true, message: 'Too many requests' },
  CIRCUIT_OPEN: { code: 503, recoverable: true, message: 'Service temporarily unavailable' },
  QUEUE_FULL: { code: 503, recoverable: true, message: 'Server overloaded' },
  DATABASE_ERROR: { code: 500, recoverable: false, message: 'Database error' },
  REDIS_ERROR: { code: 500, recoverable: true, message: 'Cache error' },
  VALIDATION_ERROR: { code: 400, recoverable: true, message: 'Validation failed' },
  AUTH_ERROR: { code: 401, recoverable: true, message: 'Authentication failed' },
  NOT_FOUND: { code: 404, recoverable: true, message: 'Resource not found' }
};

/**
 * Enhanced Error Handler Middleware
 * Prevents app crashes and provides graceful error responses
 */
const errorHandler = (err, req, res, next) => {
  // Log error details
  logger.error(`Error occurred: ${err.message}`);
  logger.error(`Stack: ${err.stack}`);
  logger.error(`Path: ${req.method} ${req.path}`);
  logger.error(`IP: ${req.ip}`);
  logger.error(`User: ${req.user?._id || 'Anonymous'}`);

  let error = { ...err };
  error.message = err.message;

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { message, statusCode: 404, type: 'NOT_FOUND' };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `${field} already exists`;
    error = { message, statusCode: 400, type: 'VALIDATION_ERROR' };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(e => e.message).join(', ');
    error = { message, statusCode: 400, type: 'VALIDATION_ERROR' };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = { message: 'Invalid token', statusCode: 401, type: 'AUTH_ERROR' };
  }

  if (err.name === 'TokenExpiredError') {
    error = { message: 'Token expired', statusCode: 401, type: 'AUTH_ERROR' };
  }

  // MongoDB errors
  if (err.name === 'MongoError' || err.name === 'MongoServerError') {
    error = {
      message: 'Database operation failed',
      statusCode: 500,
      type: 'DATABASE_ERROR',
      recoverable: false
    };
  }

  // Redis errors (don't crash app)
  if (err.message && err.message.includes('Redis')) {
    error = {
      message: 'Cache temporarily unavailable',
      statusCode: 500,
      type: 'REDIS_ERROR',
      recoverable: true
    };
  }

  // Circuit breaker errors
  if (err.message && err.message.includes('temporarily unavailable')) {
    error = {
      message: err.message,
      statusCode: 503,
      type: 'CIRCUIT_OPEN',
      recoverable: true
    };
  }

  // Determine if error is recoverable
  const isRecoverable = error.recoverable !== false;

  // Send error response
  const statusCode = error.statusCode || 500;
  const response = {
    success: false,
    message: error.message || 'Server Error',
    type: error.type || 'UNKNOWN_ERROR',
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      details: error
    })
  };

  // Don't crash on recoverable errors
  if (!isRecoverable) {
    logger.error(`❌ CRITICAL ERROR (non-recoverable): ${error.message}`);
    // Log to monitoring service (e.g., Sentry)
  }

  res.status(statusCode).json(response);
};

/**
 * Process-level Error Handlers
 * Prevent app crashes from unhandled errors
 */
const setupProcessHandlers = (server) => {
  // Uncaught Exception Handler
  process.on('uncaughtException', (error) => {
    logger.error('💥 UNCAUGHT EXCEPTION! Shutting down gracefully...');
    logger.error(`Error: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);

    gracefulShutdown(server, 'uncaughtException');
  });

  // Unhandled Promise Rejection Handler
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('💥 UNHANDLED REJECTION! Shutting down gracefully...');
    logger.error(`Reason: ${reason}`);
    logger.error(`Promise: ${promise}`);

    gracefulShutdown(server, 'unhandledRejection');
  });

  // SIGTERM Handler (e.g., from PM2 or Docker)
  process.on('SIGTERM', () => {
    logger.info('👋 SIGTERM received. Shutting down gracefully...');
    gracefulShutdown(server, 'SIGTERM');
  });

  // SIGINT Handler (Ctrl+C)
  process.on('SIGINT', () => {
    logger.info('👋 SIGINT received. Shutting down gracefully...');
    gracefulShutdown(server, 'SIGINT');
  });
};

/**
 * Graceful Shutdown
 * Close connections properly before exiting
 */
const gracefulShutdown = (server, signal) => {
  logger.info(`Graceful shutdown initiated by ${signal}`);

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      // Close MongoDB connection
      const mongoose = require('mongoose');
      await mongoose.connection.close();
      logger.info('MongoDB connection closed');
    } catch (error) {
      logger.error(`Error closing MongoDB: ${error.message}`);
    }

    try {
      // Close Redis connection
      const redisClient = require('../config/passport');
      await redisClient.quit();
      logger.info('Redis connection closed');
    } catch (error) {
      logger.error(`Error closing Redis: ${error.message}`);
    }

    logger.info('✅ Graceful shutdown completed');
    process.exit(signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('⚠️ Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

module.exports = errorHandler;
module.exports.setupProcessHandlers = setupProcessHandlers;
module.exports.ErrorTypes = ErrorTypes;

