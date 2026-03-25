const { createClient } = require("redis");
const logger = require("../utils/logger");
const CacheService = require("../services/cacheService");

const redisClient = createClient({
  url: "redis://localhost:6379",
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        logger.error("❌ Redis max reconnection attempts reached");
        return new Error("Max reconnection attempts reached");
      }
      logger.info(`🔄 Redis reconnect attempt #${retries}`);
      return Math.min(retries * 100, 3000);
    },
    connectTimeout: 10000,
    keepAlive: 5000,
  },
  // Connection pool settings for high concurrency
  maxRetriesPerRequest: 3,
});

redisClient.on("error", (err) => {
  logger.error(`❌ Redis error: ${err.message}`);
});

redisClient.on("connect", () => {
  logger.info("🔗 Redis client connected");
});

redisClient.on("ready", () => {
  logger.info("✅ Redis ready for commands");

  // Initialize cache service with Redis client
  CacheService.initialize(redisClient);
});

redisClient.on("reconnecting", () => {
  logger.warn("⚠️ Redis reconnecting...");
});

redisClient.on("end", () => {
  logger.warn("⚠️ Redis connection closed");
});

const connectRedis = async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
      logger.info("🚀 Redis connected successfully via passport.js");
    }
  } catch (err) {
    logger.error(`❌ Redis connection failed: ${err.message}`);
  }
};

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("🛑 Closing Redis connection...");
  await redisClient.quit();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("🛑 Closing Redis connection...");
  await redisClient.quit();
  process.exit(0);
});

connectRedis();

module.exports = redisClient;
