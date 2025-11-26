// ============= controllers/bookingController.js (UPDATED) =============
const Booking  = require('../models/Booking');
const ServiceProvider = require('../models/ServiceProvider');
const { Shop } = require('../models/Shop');
const { Product }=require('../models/Product');
const ResponseHandler = require('../utils/responseHandler');
const GeoService = require('../services/geoService');
const PushNotificationService = require('../services/pushNotification');
const logger = require('../utils/logger');
const { Service } =require("../models/Service")
const { Notification } = require("../models/Notification")
const mongoose = require("mongoose");
// Create Booking with Provider Search
exports.createBooking = async (req, res) => {
  try {
    const {
      service,
      scheduledDate,
      scheduledTime,
      isImmediate,
      address,
      products,
      notes
    } = req.body;
    
    // Fetch service details
    const serviceData = await Service.findById(service).populate('provider');
    if (!serviceData) {
      return ResponseHandler.error(res, 'Service not found', 404);
    }
    
    // Get coordinates for address
    const geoResult = await GeoService.getCoordinatesFromAddress(address);
    if (geoResult.success) {
      address.location = {
        type: 'Point',
        coordinates: geoResult.coordinates
      };
    }
    
    // Calculate total amount
    let totalAmount = serviceData.pricing.discountedPrice || serviceData.pricing.basePrice;
    
    if (products && products.length > 0) {
      for (const item of products) {
        const product = await Product.findById(item.product);
        totalAmount += product.price.sellingPrice * item.quantity;
      }
    }
    
    // Generate booking ID
    const bookingId = `BK${Date.now()}${Math.floor(Math.random() * 1000)}`;
    
    // Create booking with "searching" status
    const booking = await Booking.create({
      bookingId,
      user: req.user._id,
      service,
      serviceDetails: {
        title: serviceData.title,
        price: serviceData.pricing.discountedPrice || serviceData.pricing.basePrice,
        duration: serviceData.duration.value,
        category: serviceData.category
      },
      scheduledDate: isImmediate ? new Date() : scheduledDate,
      scheduledTime: isImmediate ? 'Immediate' : scheduledTime,
      isImmediate: isImmediate || false,
      address,
      products,
      totalAmount,
      notes,
      status: 'searching',
      timestamps: {
        searchingAt: new Date()
      }
    });
    
    // Populate booking details
    await booking.populate('service user');
    
    // Start provider search process
    await searchAndNotifyProviders(booking);
    
    ResponseHandler.success(res, { booking }, 'Booking created. Searching for available providers...', 201);
  } catch (error) {
    logger.error(`Create booking error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Search and Notify Nearby Providers
async function searchAndNotifyProviders(booking) {
  try {
    const serviceCategory = booking.serviceDetails.category;
    const userLocation = booking.address.location.coordinates;
    const searchRadius = booking.providerSearchRadius;
    
    // Find available providers in the category within radius
    const availableProviders = await ServiceProvider.find({
      verificationStatus: 'approved',
      isActive: true,
      'availability.isAvailable': true,
      serviceCategories: serviceCategory,
      'address.location': {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: userLocation
          },
          $maxDistance: searchRadius * 1000 // Convert km to meters
        }
      }
    }).limit(20); // Notify maximum 20 providers at once
    
    if (availableProviders.length === 0) {
      // No providers found, expand search radius
      if (booking.searchAttempts < 3 && booking.providerSearchRadius < booking.maxSearchRadius) {
        booking.providerSearchRadius += 5; // Increase by 5km
        booking.searchAttempts += 1;
        await booking.save();
        
        // Retry with expanded radius after 10 seconds
        setTimeout(() => searchAndNotifyProviders(booking), 10000);
        return;
      } else {
        // No providers found even after expanding radius
        booking.status = 'no-provider-found';
        await booking.save();
        
        // Notify user
        await PushNotificationService.sendToUser(
          booking.user,
          'No Provider Available',
          'Sorry, no service providers are available in your area at the moment.'
        );
        return;
      }
    }
    
    // Notify all available providers
    const notificationPromises = availableProviders.map(async (provider) => {
      // Add to notified providers list
      booking.notifiedProviders.push({
        provider: provider._id,
        notifiedAt: new Date(),
        response: 'pending'
      });
      
      // Create notification
      await Notification.create({
        recipient: provider._id,
        recipientModel: 'ServiceProvider',
        type: 'booking',
        title: 'New Booking Request',
        message: `New ${booking.serviceDetails.title} booking near you. Respond within ${booking.providerResponseTimeout} seconds.`,
        data: {
          bookingId: booking._id,
          bookingIdDisplay: booking.bookingId,
          service: booking.serviceDetails.title,
          amount: booking.totalAmount,
          address: `${booking.address.addressLine1}, ${booking.address.city}`,
          distance: GeoService.calculateDistance(
            provider.address.location.coordinates[1],
            provider.address.location.coordinates[0],
            userLocation[1],
            userLocation[0]
          ).toFixed(2),
          expiresAt: new Date(Date.now() + booking.providerResponseTimeout * 1000)
        },
        channels: {
          push: true,
          email: false,
          sms: false
        }
      });
      
      // Send push notification
      await PushNotificationService.sendToUser(
        provider._id,
        'New Booking Request',
        `${booking.serviceDetails.title} - ₹${booking.totalAmount}`
      );
    });
    
    await Promise.all(notificationPromises);
    await booking.save();
    
    // Set timeout for provider responses
    setTimeout(() => handleProviderTimeout(booking._id), booking.providerResponseTimeout * 1000);
    
  } catch (error) {
    logger.error(`Search providers error: ${error.message}`);
  }
}

// Handle Provider Response Timeout
async function handleProviderTimeout(bookingId) {
  try {
    const booking = await Booking.findById(bookingId);
    
    if (!booking || booking.status !== 'searching') {
      return; // Booking already accepted or cancelled
    }
    
    // Mark timed-out providers
    booking.notifiedProviders.forEach(np => {
      if (np.response === 'pending') {
        np.response = 'timeout';
      }
    });
    
    // Try expanding search radius and searching again
    if (booking.searchAttempts < 3 && booking.providerSearchRadius < booking.maxSearchRadius) {
      booking.providerSearchRadius += 5;
      booking.searchAttempts += 1;
      await booking.save();
      
      await searchAndNotifyProviders(booking);
    } else {
      // No provider accepted
      booking.status = 'no-provider-found';
      await booking.save();
      
      await PushNotificationService.sendToUser(
        booking.user,
        'Booking Failed',
        'No service providers accepted your booking. Please try again later.'
      );
    }
  } catch (error) {
    logger.error(`Handle timeout error: ${error.message}`);
  }
}

// Provider Accepts Booking
exports.acceptBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const providerId = req.user._id;
    
    const booking = await Booking.findById(bookingId).populate('user service');
    
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }
    
    // Check if booking is still in searching status
    if (booking.status !== 'searching') {
      return ResponseHandler.error(res, 'Booking already accepted by another provider', 400);
    }
    
    // Check if provider was notified
    const notifiedProvider = booking.notifiedProviders.find(
      np => np.provider.toString() === providerId.toString()
    );
    
    if (!notifiedProvider) {
      return ResponseHandler.error(res, 'You were not notified for this booking', 403);
    }
    
    if (notifiedProvider.response !== 'pending') {
      return ResponseHandler.error(res, 'You already responded to this booking', 400);
    }
    
    // FIRST COME FIRST SERVED - Assign to this provider
    booking.provider = providerId;
    booking.status = 'provider-assigned';
    booking.timestamps.providerAssignedAt = new Date();
    
    // Update provider's response
    notifiedProvider.response = 'accepted';
    notifiedProvider.respondedAt = new Date();
    
    // Mark all other pending responses as expired
    booking.notifiedProviders.forEach(np => {
      if (np.response === 'pending' && np.provider.toString() !== providerId.toString()) {
        np.response = 'timeout';
      }
    });
    
    await booking.save();
    
    // Notify user
    const provider = await ServiceProvider.findById(providerId);
    await PushNotificationService.sendToUser(
      booking.user._id,
      'Provider Assigned',
      `${provider.name} has accepted your booking and will reach you soon.`
    );
    
    // Notify other providers that booking is taken
    const otherProviders = booking.notifiedProviders
      .filter(np => np.provider.toString() !== providerId.toString())
      .map(np => np.provider);
    
    for (const pId of otherProviders) {
      await PushNotificationService.sendToUser(
        pId,
        'Booking Taken',
        'This booking has been accepted by another provider.'
      );
    }
    
    ResponseHandler.success(res, { booking }, 'Booking accepted successfully');
  } catch (error) {
    logger.error(`Accept booking error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Provider Rejects Booking
exports.rejectBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const providerId = req.user._id;
    
    const booking = await Booking.findById(bookingId);
    
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }
    
    const notifiedProvider = booking.notifiedProviders.find(
      np => np.provider.toString() === providerId.toString()
    );
    
    if (!notifiedProvider) {
      return ResponseHandler.error(res, 'You were not notified for this booking', 403);
    }
    
    notifiedProvider.response = 'rejected';
    notifiedProvider.respondedAt = new Date();
    
    await booking.save();
    
    ResponseHandler.success(res, null, 'Booking rejected');
  } catch (error) {
    logger.error(`Reject booking error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Update Provider Live Location (Like Ola/Uber)
exports.updateProviderLocation = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { latitude, longitude } = req.body;
    const providerId = req.user._id;
    
    const booking = await Booking.findOne({
      _id: bookingId,
      provider: providerId
    });
    
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }
    
    if (!['provider-assigned', 'on-the-way', 'in-progress'].includes(booking.status)) {
      return ResponseHandler.error(res, 'Cannot update location for this booking status', 400);
    }
    
    // Update provider location
    booking.tracking.providerLocation = {
      type: 'Point',
      coordinates: [longitude, latitude],
      updatedAt: new Date()
    };
    
    // Calculate distance and ETA to user location
    const userLocation = booking.address.location.coordinates;
    const distance = GeoService.calculateDistance(
      latitude,
      longitude,
      userLocation[1],
      userLocation[0]
    );
    
    booking.tracking.distance = distance;
    
    // Estimate arrival time (assuming average speed of 30 km/h)
    const durationMinutes = (distance / 30) * 60;
    booking.tracking.duration = Math.round(durationMinutes);
    booking.tracking.estimatedArrival = new Date(Date.now() + durationMinutes * 60000);
    
    await booking.save();
    
    // Notify user if provider is very close (< 500m)
    if (distance < 0.5) {
      await PushNotificationService.sendToUser(
        booking.user,
        'Provider Nearby',
        `${req.user.name} is nearby and will reach in ${Math.round(durationMinutes)} minutes.`
      );
    }
    
    ResponseHandler.success(res, {
      distance,
      duration: durationMinutes,
      estimatedArrival: booking.tracking.estimatedArrival
    }, 'Location updated');
  } catch (error) {
    logger.error(`Update location error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Provider Updates Status (On the way, Reached, Started, Completed)
exports.updateBookingStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status, completionNotes, latitude, longitude } = req.body;
    const providerId = req.user._id;
    
    const booking = await Booking.findOne({
      _id: bookingId,
      provider: providerId
    }).populate('user');
    
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }
    
    const oldStatus = booking.status;
    booking.status = status;
    
    // Update timestamps
    if (status === 'on-the-way') {
      booking.timestamps.onTheWayAt = new Date();
    } else if (status === 'reached') {
      booking.timestamps.reachedAt = new Date();
    } else if (status === 'in-progress') {
      booking.timestamps.inProgressAt = new Date();
    } else if (status === 'completed') {
      booking.timestamps.completedAt = new Date();
      booking.completedAt = new Date();
      if (completionNotes) booking.completionNotes = completionNotes;
      
      // Update provider stats
      await ServiceProvider.findByIdAndUpdate(providerId, {
        $inc: { completedServices: 1 }
      });
    }
    
    // Update location if provided
    if (latitude && longitude) {
      booking.tracking.providerLocation = {
        type: 'Point',
        coordinates: [longitude, latitude],
        updatedAt: new Date()
      };
    }
    
    await booking.save();
    
    // Notify user about status change
    const statusMessages = {
      'on-the-way': `${req.user.name} is on the way to your location`,
      'reached': `${req.user.name} has reached your location`,
      'in-progress': `Service is now in progress`,
      'completed': `Service completed successfully`
    };
    
    if (statusMessages[status]) {
      await PushNotificationService.sendToUser(
        booking.user._id,
        'Booking Status Updated',
        statusMessages[status]
      );
    }
    
    ResponseHandler.success(res, { booking }, 'Status updated successfully');
  } catch (error) {
    logger.error(`Update status error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Live Tracking Info (For User)
exports.getTrackingInfo = async (req, res) => {
  try {
    const { bookingId } = req.params;
    
    const booking = await Booking.findOne({
      _id: bookingId,
      user: req.user._id
    }).populate('provider', 'name phone profilePicture');
    
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }
    
    const trackingInfo = {
      bookingId: booking.bookingId,
      status: booking.status,
      provider: booking.provider,
      providerLocation: booking.tracking.providerLocation,
      distance: booking.tracking.distance,
      estimatedArrival: booking.tracking.estimatedArrival,
      duration: booking.tracking.duration,
      timestamps: booking.timestamps
    };
    
    ResponseHandler.success(res, trackingInfo, 'Tracking info fetched');
  } catch (error) {
    logger.error(`Get tracking error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Pending Booking Requests (For Provider)
exports.getPendingRequests = async (req, res) => {
  try {
    const providerId = req.user._id;
    
    const bookings = await Booking.find({
      'notifiedProviders.provider': providerId,
      'notifiedProviders.response': 'pending',
      status: 'searching'
    })
    .populate('user service')
    .sort({ createdAt: -1 });
    
    ResponseHandler.success(res, { bookings }, 'Pending requests fetched');
  } catch (error) {
    logger.error(`Get pending requests error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
// ============= Missing Methods for bookingController.js =============

// Get Booking Details (For Both User and Provider)
exports.getBookingDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role; // 'user' or 'provider'
    
    // Build query based on role
    let query = { _id: id };
    if (userRole === 'user') {
      query.user = userId;
    } else if (userRole === 'provider') {
      query.provider = userId;
    }
    
    const booking = await Booking.findOne(query)
      .populate('user', 'name phone email profilePicture')
      .populate('provider', 'name phone email profilePicture ratings completedServices')
      .populate('service', 'title description category pricing duration')
      .populate({
        path: 'products.product',
        select: 'name price images category'
      })
      .populate({
        path: 'products.shop',
        select: 'name address phone'
      })
      .populate({
        path: 'shopOrderTracking.shop',
        select: 'name address phone'
      })
      .populate({
        path: 'shopOrderTracking.deliveryPartner',
        select: 'name phone profilePicture'
      })
      .populate('payment');
    
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }
    
    // Additional security check
    if (userRole === 'user' && booking.user._id.toString() !== userId.toString()) {
      return ResponseHandler.error(res, 'Unauthorized access', 403);
    }
    
    if (userRole === 'provider' && booking.provider && booking.provider._id.toString() !== userId.toString()) {
      return ResponseHandler.error(res, 'Unauthorized access', 403);
    }
    
    ResponseHandler.success(res, { booking }, 'Booking details fetched successfully');
  } catch (error) {
    logger.error(`Get booking details error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Cancel Booking (User)
exports.cancelBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { cancellationReason } = req.body;
    const userId = req.user._id;
    
    const booking = await Booking.findOne({
      _id: id,
      user: userId
    }).populate('provider');
    
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }
    
    // Check if booking can be cancelled
    if (['completed', 'cancelled'].includes(booking.status)) {
      return ResponseHandler.error(res, 'Cannot cancel booking with current status', 400);
    }
    
    // Calculate cancellation charges based on status
    let refundAmount = booking.totalAmount;
    let cancellationCharge = 0;
    
    if (booking.status === 'in-progress') {
      // Cannot cancel if service is in progress
      return ResponseHandler.error(res, 'Cannot cancel booking when service is in progress', 400);
    } else if (['provider-assigned', 'on-the-way', 'reached'].includes(booking.status)) {
      // Charge 20% cancellation fee
      cancellationCharge = booking.totalAmount * 0.2;
      refundAmount = booking.totalAmount - cancellationCharge;
    }
    
    // Update booking status
    booking.status = 'cancelled';
    booking.cancellationReason = cancellationReason || 'Cancelled by user';
    booking.cancelledBy = 'user';
    booking.timestamps.cancelledAt = new Date();
    
    await booking.save();
    
    // Process refund if payment was made
    if (booking.payment) {
      // TODO: Integrate with payment gateway for refund
      logger.info(`Refund initiated for booking ${booking.bookingId}: ₹${refundAmount}`);
    }
    
    // Notify provider if assigned
    if (booking.provider) {
      await PushNotificationService.sendToUser(
        booking.provider._id,
        'Booking Cancelled',
        `Booking ${booking.bookingId} has been cancelled by the user.`
      );
      
      await Notification.create({
        recipient: booking.provider._id,
        recipientModel: 'ServiceProvider',
        type: 'booking',
        title: 'Booking Cancelled',
        message: `Booking ${booking.bookingId} for ${booking.serviceDetails.title} has been cancelled by the user.`,
        data: {
          bookingId: booking._id,
          bookingIdDisplay: booking.bookingId,
          cancellationReason: booking.cancellationReason,
          cancelledAt: booking.timestamps.cancelledAt
        },
        channels: {
          push: true,
          email: true,
          sms: false
        }
      });
    }
    
    // Send confirmation to user
    await Notification.create({
      recipient: userId,
      recipientModel: 'User',
      type: 'booking',
      title: 'Booking Cancelled',
      message: `Your booking ${booking.bookingId} has been cancelled successfully.${cancellationCharge > 0 ? ` Cancellation charge: ₹${cancellationCharge}. Refund amount: ₹${refundAmount}` : ''}`,
      data: {
        bookingId: booking._id,
        bookingIdDisplay: booking.bookingId,
        cancellationCharge,
        refundAmount
      },
      channels: {
        push: true,
        email: true,
        sms: false
      }
    });
    
    ResponseHandler.success(res, { 
      booking,
      cancellationCharge,
      refundAmount 
    }, 'Booking cancelled successfully');
  } catch (error) {
    logger.error(`Cancel booking error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get User's All Bookings with Filters
exports.getUserBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, page = 1, limit = 10, sortBy = 'createdAt', order = 'desc' } = req.query;
    
    const query = { user: userId };
    if (status) {
      query.status = status;
    }
    
    const skip = (page - 1) * limit;
    const sortOrder = order === 'asc' ? 1 : -1;
    
    const bookings = await Booking.find(query)
      .populate('service', 'title category pricing')
      .populate('provider', 'name phone profilePicture ratings')
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Booking.countDocuments(query);
    
    ResponseHandler.success(res, {
      bookings,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit)
      }
    }, 'Bookings fetched successfully');
  } catch (error) {
    logger.error(`Get user bookings error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Provider's All Bookings with Filters
exports.getProviderBookings = async (req, res) => {
  try {
    const providerId = req.user._id;
    const { status, page = 1, limit = 10, sortBy = 'createdAt', order = 'desc' } = req.query;
    
    const query = { provider: providerId };
    if (status) {
      query.status = status;
    }
    
    const skip = (page - 1) * limit;
    const sortOrder = order === 'asc' ? 1 : -1;
    
    const bookings = await Booking.find(query)
      .populate('user', 'name phone address')
      .populate('service', 'title category pricing')
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Booking.countDocuments(query);
    
    ResponseHandler.success(res, {
      bookings,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit)
      }
    }, 'Bookings fetched successfully');
  } catch (error) {
    logger.error(`Get provider bookings error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Booking Statistics for Provider
exports.getProviderStats = async (req, res) => {
  try {
    const providerId = req.user._id;
    
    const stats = await Booking.aggregate([
      { $match: { provider: new mongoose.Types.ObjectId(providerId) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' }
        }
      }
    ]);
    
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const todayBookings = await Booking.countDocuments({
      provider: providerId,
      createdAt: { $gte: todayStart }
    });
    
    const todayEarnings = await Booking.aggregate([
      {
        $match: {
          provider: new mongoose.Types.ObjectId(providerId),
          status: 'completed',
          completedAt: { $gte: todayStart }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalAmount' }
        }
      }
    ]);
    
    const totalEarnings = await Booking.aggregate([
      {
        $match: {
          provider: new mongoose.Types.ObjectId(providerId),
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalAmount' }
        }
      }
    ]);
    
    ResponseHandler.success(res, {
      statusStats: stats,
      todayBookings,
      todayEarnings: todayEarnings[0]?.total || 0,
      totalEarnings: totalEarnings[0]?.total || 0
    }, 'Stats fetched successfully');
  } catch (error) {
    logger.error(`Get provider stats error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

module.exports = exports;