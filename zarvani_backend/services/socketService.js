// ============= services/socketService.js =============
const redisClient = require('../config/passport');
const logger = require('../utils/logger');
let io;

module.exports = {
  init: (socketIO) => {
    io = socketIO;
    return io;
  },

  getIO: () => {
    if (!io) {
      throw new Error('Socket.io not initialized!');
    }
    return io;
  },

  // Emit to specific user
  emitToUser: (userId, event, data) => {
    if (io) {
      io.to(`user_${userId}`).emit(event, data);
    }
  },

  /**
   * ✅ GUARANTEED DELIVERY: Store event in Redis for persistence.
   * If a user is offline, the event stays in Redis until they reconnect.
   */
  emitGuaranteedToUser: async (userId, event, data) => {
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const payload = { event, data, eventId, timestamp: new Date() };

    // Store in Redis (Missed Events Queue) - 24h TTL
    const queueKey = `socket:missed:${userId}`;
    try {
      await redisClient.lPush(queueKey, JSON.stringify(payload));
      await redisClient.expire(queueKey, 86400);

      if (io) {
        io.to(`user_${userId}`).emit(event, { ...data, _eventId: eventId });
        logger.debug(`Guaranteed event ${event} queued for user_${userId}`);
      }
    } catch (err) {
      logger.error(`Guaranteed Delivery Error: ${err.message}`);
      // Fallback to normal emit if Redis fails
      if (io) io.to(`user_${userId}`).emit(event, data);
    }
  },

  // Emit to booking room
  emitToBooking: (bookingId, event, data) => {
    if (io) {
      io.to(`booking_${bookingId}`).emit(event, data);
    }
  },

  // Emit to order room
  emitToOrder: (orderId, event, data) => {
    if (io) {
      io.to(`order_${orderId}`).emit(event, data);
    }
  },

  // Broadcast new booking request to providers
  broadcastBookingRequest: (providerIds, bookingData) => {
    if (io) {
      providerIds.forEach(providerId => {
        io.to(`user_${providerId}`).emit('new-booking-request', bookingData);
      });
    }
  },

  // Broadcast delivery request
  broadcastDeliveryRequest: (partnerIds, orderData) => {
    if (io) {
      partnerIds.forEach(partnerId => {
        io.to(`user_${partnerId}`).emit('new-delivery-request', orderData);
      });
    }
  }
};