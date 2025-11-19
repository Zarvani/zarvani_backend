const { createClient } = require("redis");

const redisClient = createClient({
  url: "redis://localhost:6379",
  socket: {
    connectTimeout: 20000,   // ⬅ Important: Prevents early timeout
    keepAlive: 5000,
    reconnectStrategy: (retries) => {
      console.log(`🔄 Redis reconnect attempt #${retries}`);
      return Math.min(retries * 100, 3000); // retry every 0.1 → 3 sec
    },
  },
});

// Error listener
redisClient.on("error", (err) => {
  console.error("❌ Redis error:", err.message);
});

// Successful connection listener
redisClient.on("connect", () => {
  console.log("🔗 Redis client connected …");
});

redisClient.on("ready", () => {
  console.log("✅ Redis ready for commands");
});

// 👇 Safe connect function with retry wrapper
const connectRedis = async () => {
  try {
    await redisClient.connect();
    console.log("🚀 Redis connected successfully");
  } catch (err) {
    console.error("❌ Initial Redis connection failed. Retrying in 3 seconds…");
    setTimeout(connectRedis, 3000);
  }
};

connectRedis();

module.exports = redisClient;
