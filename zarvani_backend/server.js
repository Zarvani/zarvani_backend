// ============= server.js (UPDATED - Add Socket.IO for Real-time) =============
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');

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
const cartRoutes = require('./routes/cartRoutes')
const commission = require('./routes/commissionRoutes')
const app = express();
const server = http.createServer(app);

// Socket.IO setup
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'];

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
  }
});

// Make io accessible to controllers
app.set('io', io);

// Connect to MongoDB
connectDB();

// Middleware
app.use(helmet());
app.use(compression());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes'
  }
});
app.use('/api/', limiter);
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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

app.use(`/api/v1/auth`, authRoutes);
app.use(`/api/v1/users`, userRoutes);
app.use(`/api/v1/providers`, providerRoutes);
app.use(`/api/v1/shops`, shopRoutes);
app.use(`/api/v1/admin`, adminRoutes);
app.use(`/api/v1/bookings`, bookingRoutes);
app.use(`/api/v1/orders`, orderRoutes);
app.use(`/api/v1/products`, productRoutes);
app.use(`/api/v1/payments`, paymentRoutes);
app.use(`/api/v1/cart`, cartRoutes);
app.use(`/api/v1/commission`, commission);
// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  // Join user-specific room
  socket.on('join', (userId) => {
    socket.join(`user_${userId}`);
    logger.info(`User ${userId} joined their room`);
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

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Global Error Handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT;
server.listen(PORT, () => {
  logger.info(`Server running in mode on port ${PORT}`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.IO ready for real-time connections`);
});

