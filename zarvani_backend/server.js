// ============= server.js (ENHANCED - Crash Prevention) =============
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const redisClient = require('./config/passport');

// Import crash prevention middleware
const {
  globalLimiter,
  authLimiter,
  apiLimiter,
  uploadLimiter
} = require('./middleware/rateLimiter');
const requestQueue = require('./middleware/requestQueue');
const { circuitBreaker } = require('./middleware/circuitBreaker');

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const providerRoutes = require('./routes/providerRoutes');
const shopRoutes = require('./routes/shopRoutes');
const adminRoutes = require('./routes/adminRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const orderRoutes = require('./routes/orderRoutes');
const productRoutes = require('./routes/productRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const cartRoutes = require('./routes/cartRoutes');
const commission = require('./routes/commissionRoutes');

const app = express();
const server = http.createServer(app);

// Socket.IO setup
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'];

const { createAdapter } = require("@socket.io/redis-adapter");
const { Cluster } = require("ioredis");

const io = socketIO(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true
  },
  // HIGH-SCALE CONFIGURATION (Blinkit/Uber Style)
  pingTimeout: 60000,    // How many ms without a pong packet to consider the connection closed
  pingInterval: 25000,   // How many ms before sending a new ping packet
  connectTimeout: 45000, // How many ms before giving up on a connection attempt
  transports: ['websocket', 'polling'], // Fallback mechanism
  allowUpgrades: true,
  cookie: false          // Disable cookies for performance if not needed
});

// ✅ SCALABILITY: Multi-node Socket.IO support (Redis Adapter)
// Ensures events on Server-1 are seen by users on Server-2
const pubClient = redisClient.duplicate();
const subClient = redisClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
  logger.info("📡 Socket.IO Redis Adapter initialized");
}).catch(err => {
  logger.error(`❌ Socket.IO Redis Adapter failed: ${err.message}`);
});

// Make io accessible to controllers
app.set('io', io);

// Connect to MongoDB with circuit breaker
connectDB();

// CacheService is already initialized in passport.js when Redis is ready

// ==================== MIDDLEWARE (ORDER MATTERS!) ====================

// 1. Security & Compression
app.use(helmet());
app.use(compression());

// 2. CORS
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// 3. Body Parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. Logging
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// 5. Request Queue (BEFORE rate limiting)
// Prevents database connection pool exhaustion
app.use(requestQueue.middleware());

// ==================== HEALTH CHECK ====================
app.get('/health', async (req, res) => {
  const health = {
    uptime: process.uptime(),
    timestamp: Date.now(),
    status: 'OK',
    services: {},
    queue: requestQueue.getMetrics(),
    circuitBreakers: circuitBreaker.getAllStatus()
  };

  try {
    // Check MongoDB with circuit breaker
    await circuitBreaker.execute(
      'mongodb',
      async () => {
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState === 1) {
          await mongoose.connection.db.admin().ping();
          health.services.mongodb = 'UP';
        } else {
          throw new Error('MongoDB not connected');
        }
      },
      async () => {
        health.services.mongodb = 'DOWN';
        health.status = 'DEGRADED';
      }
    );
  } catch (err) {
    health.services.mongodb = 'DOWN';
    health.status = 'DEGRADED';
    logger.error(`MongoDB health check failed: ${err.message}`);
  }

  try {
    // Check Redis with circuit breaker
    await circuitBreaker.execute(
      'redis',
      async () => {
        await redisClient.ping();
        health.services.redis = 'UP';
      },
      async () => {
        health.services.redis = 'DOWN';
        health.status = 'DEGRADED';
      }
    );
  } catch (err) {
    health.services.redis = 'DOWN';
    health.status = 'DEGRADED';
    logger.error(`Redis health check failed: ${err.message}`);
  }

  const statusCode = health.status === 'OK' ? 200 : 503;
  res.status(statusCode).json(health);
});

// ==================== SWAGGER UI ====================
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ==================== RATE LIMITING ====================
// Apply different rate limiters to different routes

// Authentication routes (strictest - 5 req/min)
app.use('/api/v1/auth', authLimiter);

// Upload routes (strict - 10 req/hour)
app.use('/api/v1/*/upload', uploadLimiter);
app.use('/api/v1/shops/upload', uploadLimiter);
app.use('/api/v1/providers/upload', uploadLimiter);

// API routes (standard - 200 req/15min)
app.use('/api/v1', apiLimiter);

// Global fallback (100 req/15min)
app.use('/api', globalLimiter);

// ==================== ROUTES ====================
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/providers', providerRoutes);
app.use('/api/v1/shops', shopRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/bookings', bookingRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/commission', commission);

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  // Join user-specific room
  socket.on('join', async (userId) => {
    socket.join(`user_${userId}`);
    logger.info(`User ${userId} joined their room`);

    // ✅ RELIABILITY: Fetch and flush missed socket events from Redis
    const queueKey = `socket:missed:${userId}`;
    try {
      const missedEvents = await redisClient.lRange(queueKey, 0, -1);
      if (missedEvents && missedEvents.length > 0) {
        logger.info(`Flushing ${missedEvents.length} missed events for User ${userId}`);
        // Reverse to maintain chronological order (lPush adds to start)
        missedEvents.reverse().forEach(eventStr => {
          const { event, data, eventId } = JSON.parse(eventStr);
          socket.emit(event, { ...data, _eventId: eventId, _isMissed: true });
        });
      }
    } catch (err) {
      logger.error(`Error flushing missed events: ${err.message}`);
    }
  });

  // ✅ RELIABILITY: Acknowledge event received (removes from persistence)
  socket.on('acknowledge_event', async (data) => {
    const { userId, eventId } = data;
    if (!userId || !eventId) return;

    const queueKey = `socket:missed:${userId}`;
    try {
      const missedEvents = await redisClient.lRange(queueKey, 0, -1);
      for (const eventStr of missedEvents) {
        const evt = JSON.parse(eventStr);
        if (evt.eventId === eventId) {
          await redisClient.lRem(queueKey, 1, eventStr);
          logger.debug(`Event ${eventId} acknowledged and removed for User ${userId}`);
          break;
        }
      }
    } catch (err) {
      logger.error(`Error acknowledging event: ${err.message}`);
    }
  });

  // Join booking room for real-time tracking
  socket.on('join-booking', (bookingId) => {
    socket.join(`booking_${bookingId}`);
    logger.info(`Joined booking room: ${bookingId}`);
  });

  // Join order room for real-time tracking
  socket.on('join-order', (orderId) => {
    socket.join(`order_${orderId}`);
    logger.info(`Joined order room: ${orderId}`);
  });

  // Provider location update
  socket.on('provider-location-update', (data) => {
    const { bookingId, orderId, latitude, longitude } = data;

    if (bookingId) {
      io.to(`booking_${bookingId}`).emit('location-updated', {
        latitude,
        longitude,
        timestamp: new Date()
      });
    }

    if (orderId) {
      io.to(`order_${orderId}`).emit('location-updated', {
        latitude,
        longitude,
        timestamp: new Date()
      });
    }
  });

  // Booking status update
  socket.on('booking-status-update', (data) => {
    const { bookingId, status } = data;
    io.to(`booking_${bookingId}`).emit('status-updated', {
      status,
      timestamp: new Date()
    });
  });

  // Order status update
  socket.on('order-status-update', (data) => {
    const { orderId, status } = data;
    io.to(`order_${orderId}`).emit('status-updated', {
      status,
      timestamp: new Date()
    });
  });

  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });
});

// ==================== ERROR HANDLERS ====================

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Global Error Handler
app.use(errorHandler);

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  logger.info(`✅ Server running on port ${PORT}`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.IO ready for real-time connections`);
  console.log(`🛡️  Rate limiting enabled (Redis-based)`);
  console.log(`🔄 Circuit breaker active`);
  console.log(`📊 Request queue: ${requestQueue.getMetrics().maxConcurrent} concurrent, ${requestQueue.getMetrics().maxQueueSize} max queue`);
});

// Setup process-level error handlers (PREVENTS CRASHES)
errorHandler.setupProcessHandlers(server);

// Log startup info
logger.info('='.repeat(60));
logger.info('🚀 Zarvani Backend Started Successfully');
logger.info('='.repeat(60));
logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
logger.info(`Port: ${PORT}`);
logger.info(`MongoDB: ${process.env.MONGO_URI ? 'Configured' : 'Not configured'}`);
logger.info(`Redis: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`);
logger.info('='.repeat(60));
