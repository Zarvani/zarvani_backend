// ============= services/socketService.js (NEW - Helper for Socket.IO) =============
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