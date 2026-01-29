const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * MongoDB Connection Configuration for Extreme Scale
 * Optimized for 1B users, 50M concurrent, 50M daily orders
 */
const connectDB = async () => {
  try {
    // Connection options optimized for high concurrency
    const options = {
      // Connection Pool Settings (CRITICAL for 100K+ concurrent users)
      maxPoolSize: 100,           // Max connections per instance (increase for production)
      minPoolSize: 20,            // Maintain minimum connections
      maxIdleTimeMS: 30000,       // Close idle connections after 30s

      // Timeout Settings
      serverSelectionTimeoutMS: 5000,   // Fail fast if no server available
      socketTimeoutMS: 45000,           // Socket timeout for long queries
      connectTimeoutMS: 10000,          // Initial connection timeout

      // Performance Settings
      family: 4,                        // Use IPv4 (faster than IPv6 in most cases)

      // Monitoring
      heartbeatFrequencyMS: 10000,      // Check server health every 10s

      // Write Concern (adjust based on your needs)
      // w: 'majority',                 // Wait for majority acknowledgment (safer)
      // w: 1,                          // Wait for primary only (faster)

      // Read Preference
      // readPreference: 'secondaryPreferred', // Read from replicas when possible
    };

    const conn = await mongoose.connect(process.env.MONGODB_URI, options);

    logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);
    logger.info(`📊 Connection Pool: Min=${options.minPoolSize}, Max=${options.maxPoolSize}`);
    logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);

    // Log connection pool stats periodically (every 60 seconds)
    setInterval(() => {
      const poolStats = mongoose.connection.db?.serverConfig?.s?.pool;
      if (poolStats) {
        logger.debug(`MongoDB Pool Stats: Available=${poolStats.availableCount}, In-Use=${poolStats.inUseCount}, Total=${poolStats.totalCount}`);
      }
    }, 60000);

  } catch (error) {
    logger.error(`❌ MongoDB Connection Error: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);
    console.error(`❌ MongoDB Connection Error: ${error.message}`);

    // Retry connection after 5 seconds
    logger.info('Retrying connection in 5 seconds...');
    setTimeout(connectDB, 5000);
  }
};

// Connection event handlers
mongoose.connection.on('connected', () => {
  logger.info('🔗 Mongoose connected to MongoDB');
});

mongoose.connection.on('disconnected', () => {
  logger.warn('⚠️ Mongoose disconnected from MongoDB');
});

mongoose.connection.on('reconnected', () => {
  logger.info('🔄 Mongoose reconnected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  logger.error(`❌ Mongoose connection error: ${err.message}`);
});

// Graceful shutdown
const gracefulShutdown = async (msg) => {
  logger.info(`🛑 Mongoose disconnecting through ${msg}`);
  await mongoose.connection.close();
  logger.info('✅ Mongoose disconnected');
};

process.on('SIGINT', async () => {
  await gracefulShutdown('app termination (SIGINT)');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await gracefulShutdown('app termination (SIGTERM)');
  process.exit(0);
});

module.exports = connectDB;