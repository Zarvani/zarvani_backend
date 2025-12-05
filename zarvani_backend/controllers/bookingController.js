// ============= controllers/bookingController.js (COMPLETE - NO AUTO TIMEOUT) =============
const Booking = require('../models/Booking');
const ServiceProvider = require('../models/ServiceProvider');
const { Shop } = require('../models/Shop');
const { Product } = require('../models/Product');
const ResponseHandler = require('../utils/responseHandler');
const GeoService = require('../services/geoService');
const PushNotificationService = require('../services/pushNotification');
const logger = require('../utils/logger');
const { Service } = require("../models/Service");
const { Notification } = require("../models/Notification");
const mongoose = require("mongoose");

// ========================== CREATE BOOKING ==========================
exports.createBooking = async (req, res) => {
  try {
    const {
      service,
      scheduledDate,
      scheduledTime,
      isImmediate,
      address,
      products,
      notes,
      phone
    } = req.body;

    // Fetch service
    const serviceData = await Service.findById(service);
    if (!serviceData) {
      return ResponseHandler.error(res, 'Service not found', 404);
    }

    // Convert user address to coordinates
    if (!address.location.coordinates || address.location.coordinates.length !== 2) {
      return ResponseHandler.error(res, "Coordinates required", 400);
    }

    address.location = {
      type: "Point",
      coordinates: address.location.coordinates
    };

    // Total price
    let totalAmount = serviceData.pricing.discountedPrice || serviceData.pricing.basePrice;

    if (products?.length > 0) {
      for (const item of products) {
        const product = await Product.findById(item.product);
        totalAmount += product.price.sellingPrice * item.quantity;
      }
    }

    // Booking ID
    const bookingId = `BK${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // Create booking - NO AUTO TIMEOUT
    const booking = await Booking.create({
      bookingId,
      user: req.user._id,
      service,
      serviceDetails: {
        title: serviceData.title,
        price: totalAmount,
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
      phone: phone || req.user.phone,
      status: 'searching',
      providerSearchRadius: 5,
      maxSearchRadius: 20,
      searchAttempts: 0,
      notifiedProviders: [],
      providerResponseTimeout: 0, // ⚡ NO AUTO TIMEOUT
      timestamps: {
        searchingAt: new Date()
      }
    });

    // Begin nearby provider search
    searchAndNotifyProviders(booking);

    return ResponseHandler.success(
      res,
      { booking },
      'Booking created. Searching for nearby providers...',
      201
    );

  } catch (error) {
    logger.error(`Create booking error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ========================== SEARCH AND NOTIFY PROVIDERS ==========================
async function searchAndNotifyProviders(booking) {
  try {
    const serviceCategory = booking.serviceDetails.category;
    const userLocation = booking.address.location.coordinates;
    const searchRadius = booking.providerSearchRadius;

    // 1. Find available providers within radius
    const availableProviders = await ServiceProvider.find({
      verificationStatus: "approved",
      isActive: true,
      "availability.isAvailable": true,
      serviceCategories: { $in: [serviceCategory] },
      "address.location": {
        $near: {
          $geometry: { type: "Point", coordinates: userLocation },
          $maxDistance: searchRadius * 1000
        }
      }
    }).limit(15);

    // 2. No providers found → expand radius
    if (availableProviders.length === 0) {
      if (booking.searchAttempts < 3 && booking.providerSearchRadius < booking.maxSearchRadius) {
        booking.providerSearchRadius += 5;
        booking.searchAttempts += 1;
        await booking.save();
        
        logger.info(`Expanding search radius to ${booking.providerSearchRadius}km for booking ${booking.bookingId}`);
        
        // Retry with larger radius after 30 seconds
        setTimeout(() => searchAndNotifyProviders(booking), 30000);
        return;
      }

      booking.status = "no-provider-found";
      await booking.save();

      await PushNotificationService.sendToUser(
        booking.user,
        "No Providers Found",
        "Sorry, no providers are available near your location."
      );
      
      // Create notification for user
      await Notification.create({
        recipient: booking.user,
        recipientModel: 'User',
        type: 'booking',
        title: 'No Providers Found',
        message: 'We could not find any available service providers in your area. Please try again later.',
        data: {
          bookingId: booking._id,
          bookingIdDisplay: booking.bookingId
        },
        channels: { push: true, email: true, sms: false }
      });
      
      return;
    }

    // 3. Calculate distances for each provider
    const providersWithDistance = await Promise.all(
      availableProviders.map(async (provider) => {
        const distance = GeoService.calculateDistance(
          provider.address.location.coordinates[1],
          provider.address.location.coordinates[0],
          userLocation[1],
          userLocation[0]
        );
        
        // Calculate estimated arrival time
        const estimatedTime = calculateEstimatedTime(distance);
        
        // Calculate acceptance rate
        const providerStats = await Booking.aggregate([
          { 
            $match: { 
              provider: provider._id,
              'notifiedProviders.response': 'accepted'
            } 
          },
          {
            $group: {
              _id: null,
              accepted: { $sum: 1 }
            }
          }
        ]);
        
        const totalNotified = booking.notifiedProviders.filter(np => 
          np.provider.toString() === provider._id.toString()
        ).length;
        
        const acceptanceRate = totalNotified > 0 ? 
          (providerStats[0]?.accepted || 0) / totalNotified * 100 : 100;
        
        return {
          provider,
          distance,
          estimatedTime,
          acceptanceRate
        };
      })
    );

    // Sort by distance (nearest first)
    providersWithDistance.sort((a, b) => a.distance - b.distance);

    // 4. Add providers to notifiedProviders with distance and ETA
    booking.notifiedProviders.push(
      ...providersWithDistance.map(pwd => ({
        provider: pwd.provider._id,
        notifiedAt: new Date(),
        response: "pending",
        metadata: {
          distance: pwd.distance,
          estimatedTime: pwd.estimatedTime,
          acceptanceRate: pwd.acceptanceRate,
          providerName: pwd.provider.name,
          providerRating: pwd.provider.ratings?.average || 5.0
        }
      }))
    );
    await booking.save();

    // 5. Send notifications with enhanced details
    await Promise.all(
      providersWithDistance.map(async (pwd) => {
        const provider = pwd.provider;
        const distance = pwd.distance;
        const estimatedTime = pwd.estimatedTime;
        
        // Prepare notification data - NO EXPIRY TIME
        const notificationData = {
          bookingId: booking._id,
          bookingIdDisplay: booking.bookingId,
          service: booking.serviceDetails.title,
          amount: booking.totalAmount,
          address: `${booking.address.addressLine1}, ${booking.address.city}`,
          distance: distance.toFixed(2),
          estimatedTime: estimatedTime,
          customerLocation: userLocation,
          priority: distance < 3 ? 'high' : distance < 10 ? 'medium' : 'low'
        };

        // Save notification in DB
        await Notification.create({
          recipient: provider._id,
          recipientModel: "ServiceProvider",
          type: "booking_request",
          title: "🚀 New Booking Request",
          message: `${booking.serviceDetails.title} - ₹${booking.totalAmount}\nDistance: ${distance.toFixed(1)}km • ETA: ${estimatedTime} min`,
          data: notificationData,
          channels: { push: true, email: false, sms: false }
        });

        // Enhanced push notification
        await PushNotificationService.sendToProvider(provider._id, {
          title: `New ${booking.serviceDetails.category} Request`,
          body: `₹${booking.totalAmount} • ${distance.toFixed(1)}km away • ${estimatedTime} min`,
          data: notificationData
        });
      })
    );

    // ⚡ NO AUTO TIMEOUT - Providers can accept anytime
    // Booking stays in 'searching' status until:
    // 1. Provider accepts
    // 2. User cancels
    // 3. No providers found

  } catch (error) {
    logger.error(`Search providers error: ${error.message}`);
  }
}

// ========================== PROVIDER ACCEPTS BOOKING ==========================
exports.acceptBooking = async (req, res) => {
  try {
    const incomingId = req.params.id;
    const providerId = req.user._id;

    console.log("Incoming Booking ID:", incomingId);
    console.log("Provider ID:", providerId);

    let booking;

    // ---------------------------------------------------
    // 1️⃣ Find booking using either ObjectId or bookingId
    // ---------------------------------------------------
    if (mongoose.Types.ObjectId.isValid(incomingId)) {
      booking = await Booking.findById(incomingId);
    } else {
      booking = await Booking.findOne({ bookingId: incomingId });
    }

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // ---------------------------------------------------
    // 2️⃣ Block if booking is already accepted/completed
    // ---------------------------------------------------
    if (booking.status !== "searching") {
      return res.status(400).json({
        success: false,
        message: "This booking is no longer available",
        currentStatus: booking.status,
      });
    }

    // ---------------------------------------------------
    // 3️⃣ Ensure this provider is notified for the booking
    // ---------------------------------------------------
    if (!booking.notifiedProviders.includes(providerId.toString())) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to accept this booking",
      });
    }

    // ---------------------------------------------------
    // 4️⃣ Assign provider + update status
    // ---------------------------------------------------
    booking.provider = providerId;
    booking.status = "accepted";
    await booking.save();

    // ---------------------------------------------------
    // 5️⃣ Send Notification to User
    // ---------------------------------------------------
    try {
      await PushNotificationService.sendToUser(
        booking.user,
        "Booking Accepted",
        "Your booking has been accepted by a service provider.",
        {
          bookingId: booking.bookingId || booking._id.toString(),
          type: "booking_accept",
        }
      );
    } catch (err) {
      console.log("Push notification error:", err.message);
    }

    // ---------------------------------------------------
    // 6️⃣ Success Response
    // ---------------------------------------------------
    return res.status(200).json({
      success: true,
      message: "Booking accepted successfully",
      booking,
    });

  } catch (error) {
    console.error("Accept booking error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


// ========================== PROVIDER REJECTS BOOKING ==========================
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

// ========================== UPDATE PROVIDER LOCATION ==========================
exports.updateProviderLocation = async (req, res) => {
  try {
    const  bookingId  = req.params.id;
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
    
    // Estimate arrival time
    const durationMinutes = calculateEstimatedTime(distance);
    booking.tracking.duration = Math.round(durationMinutes);
    booking.tracking.estimatedArrival = new Date(Date.now() + durationMinutes * 60000);
    
    await booking.save();
    
    // Notify user if provider is very close (< 500m)
    if (distance < 0.5 && booking.status === 'on-the-way') {
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

// ========================== UPDATE BOOKING STATUS ==========================
exports.updateBookingStatus = async (req, res) => {
  try {
    const bookingId = req.params.id;
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
      
      // Make provider available again
      await ServiceProvider.findByIdAndUpdate(providerId, {
        'availability.isAvailable': true,
        'availability.lastStatusUpdate': new Date()
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

// ========================== GET TRACKING INFO ==========================
exports.getTrackingInfo = async (req, res) => {
  try {
    const { bookingId } = req.params;
    
    const booking = await Booking.findOne({
      _id: bookingId,
      user: req.user._id
    }).populate('provider', 'name phone profilePicture vehicle ratings')
      .populate('service', 'title category');
    
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }
    
    // Calculate searching duration if still searching
    let searchingDuration = null;
    if (booking.status === 'searching') {
      const firstNotification = booking.notifiedProviders[0];
      if (firstNotification) {
        const notifiedAt = new Date(firstNotification.notifiedAt);
        const now = new Date();
        const timeElapsed = (now - notifiedAt) / 1000;
        searchingDuration = Math.floor(timeElapsed / 60); // minutes
      }
    }
    
    const trackingInfo = {
      bookingId: booking.bookingId,
      status: booking.status,
      provider: booking.provider,
      service: booking.service,
      providerLocation: booking.tracking?.providerLocation,
      userLocation: booking.address.location,
      distance: booking.tracking?.distance,
      estimatedArrival: booking.tracking?.estimatedArrival,
      duration: booking.tracking?.duration,
      timestamps: booking.timestamps,
      searchingDuration,
      canCancel: booking.status === 'searching'
    };
    
    ResponseHandler.success(res, trackingInfo, 'Tracking info fetched');
  } catch (error) {
    logger.error(`Get tracking error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ========================== GET PENDING REQUESTS ==========================
exports.getPendingRequests = async (req, res) => {
  try {
    const providerId = req.user._id;

    // Find provider with location
    const provider = await ServiceProvider.findById(providerId).lean();
    if (!provider) {
      return ResponseHandler.error(res, "Provider not found", 404);
    }

    if (
      !provider.address ||
      !provider.address.location ||
      !provider.address.location.coordinates ||
      provider.address.location.coordinates.length !== 2
    ) {
      return ResponseHandler.error(res, "Provider location missing", 400);
    }

    const providerLocation = provider.address.location.coordinates;

    // ⚡ IMPORTANT: Only show bookings that are still searching
    const bookings = await Booking.find({
      status: "searching", // Only searching bookings
      "notifiedProviders.provider": providerId,
      "notifiedProviders.response": "pending"
    })
      .populate("user", "name phone profilePicture")
      .populate("service", "title category pricing duration")
      .sort({ createdAt: -1 })
      .lean();

    // No bookings → return empty response
    if (!bookings.length) {
      return ResponseHandler.success(res, { bookings: [], providerLocation }, "No pending requests found");
    }

    // Enhance booking data
    const enhancedBookings = bookings.map((booking) => {
      const userLocation = booking.address?.location?.coordinates || [0, 0];

      // Distance calculation
      let distance = 0;
      try {
        distance = GeoService.calculateDistance(
          providerLocation[1], providerLocation[0],
          userLocation[1], userLocation[0]
        );
      } catch (err) {
        distance = 0;
      }

      // ETA Calculation
      const estimatedTime = calculateEstimatedTime(distance);

      // Find provider notification details
      const notify = booking.notifiedProviders.find(
        (np) => np.provider.toString() === providerId.toString()
      );

      // ⚡ NO TIME REMAINING - Can accept anytime
      const notifiedAt = new Date(notify?.notifiedAt || new Date());
      const now = new Date();
      const timeElapsed = (now - notifiedAt) / 1000; // in seconds
      const timeElapsedMinutes = Math.floor(timeElapsed / 60);

      // Format address
      const formattedAddress = booking.address?.addressLine1
        ? `${booking.address.addressLine1}, ${booking.address.city}`
        : booking.address?.city || "Unknown Location";

      return {
        ...booking,
        distance: distance.toFixed(1),
        estimatedTime,
        formattedAddress,
        timeElapsed: timeElapsedMinutes, // Show how long it's been searching
        urgency: distance < 3 ? "high" : distance < 10 ? "medium" : "low"
      };
    });

    return ResponseHandler.success(
      res,
      { bookings: enhancedBookings, providerLocation },
      "Pending requests fetched"
    );

  } catch (error) {
    logger.error(`Get pending requests error: ${error.message}`);
    return ResponseHandler.error(res, error.message, 500);
  }
};

// ========================== GET BOOKING DETAILS ==========================
exports.getBookingDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    let query = { _id: id };
    if (userRole === 'user') query.user = userId;
    if (userRole === 'provider') query.provider = userId;

    const booking = await Booking.findOne(query)
      .populate('user', 'name phone email profilePicture')
      .populate('provider', 'name phone email profilePicture ratings completedServices vehicle')
      .populate('service', 'title description category pricing duration')
      .populate({ path: 'products.product', select: 'name price images category' })
      .populate({ path: 'products.shop', select: 'name address phone' })
      .populate({ path: 'shopOrderTracking.shop', select: 'name address phone' })
      .populate({ path: 'shopOrderTracking.deliveryPartner', select: 'name phone profilePicture' })
      .populate('payment');

    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }

    // Security checks
    if (userRole === 'user' && booking.user._id.toString() !== userId.toString()) {
      return ResponseHandler.error(res, 'Unauthorized access', 403);
    }
    if (userRole === 'provider' && booking.provider && booking.provider._id.toString() !== userId.toString()) {
      return ResponseHandler.error(res, 'Unauthorized access', 403);
    }

    // Calculate additional info for searching bookings
    let acceptanceInfo = null;
    if (booking.status === 'searching') {
      const firstNotification = booking.notifiedProviders[0];
      if (firstNotification) {
        const notifiedAt = new Date(firstNotification.notifiedAt);
        const now = new Date();
        const timeElapsed = (now - notifiedAt) / 1000;
        
        acceptanceInfo = {
          searchingDuration: Math.floor(timeElapsed / 60), // minutes searching
          searchingDurationSeconds: Math.floor(timeElapsed % 60),
          providersNotified: booking.notifiedProviders.length,
          providersAccepted: booking.notifiedProviders.filter(np => np.response === 'accepted').length,
          providersRejected: booking.notifiedProviders.filter(np => np.response === 'rejected').length,
          providersPending: booking.notifiedProviders.filter(np => np.response === 'pending').length,
          canCancel: true
        };
      }
    }

    const bookingObj = booking.toObject();
    bookingObj.acceptanceInfo = acceptanceInfo;

    ResponseHandler.success(
      res,
      { booking: bookingObj },
      'Booking details fetched successfully'
    );

  } catch (error) {
    logger.error(`Get booking details error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ========================== CANCEL BOOKING ==========================
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
    
    // ⚡ ALLOW CANCELLATION ONLY IF STILL SEARCHING (no charges)
    if (booking.status !== 'searching') {
      // If provider already assigned, apply cancellation charges
      if (['provider-assigned', 'on-the-way', 'reached'].includes(booking.status)) {
        // Calculate cancellation charges (20% fee)
        const cancellationCharge = booking.totalAmount * 0.2;
        const refundAmount = booking.totalAmount - cancellationCharge;
        
        // Update booking status
        booking.status = 'cancelled';
        booking.cancellationReason = cancellationReason || 'Cancelled by user';
        booking.cancelledBy = 'user';
        booking.timestamps.cancelledAt = new Date();
        
        await booking.save();
        
        // Notify provider
        if (booking.provider) {
          await PushNotificationService.sendToUser(
            booking.provider._id,
            'Booking Cancelled',
            `Booking ${booking.bookingId} has been cancelled by the user.`
          );
          
          // Make provider available again
          await ServiceProvider.findByIdAndUpdate(booking.provider._id, {
            'availability.isAvailable': true,
            'availability.lastStatusUpdate': new Date()
          });
        }
        
        return ResponseHandler.success(res, { 
          booking,
          cancellationCharge,
          refundAmount,
          message: 'Booking cancelled. 20% cancellation charge applied.'
        }, 'Booking cancelled with charges');
      }
      
      return ResponseHandler.error(res, 'Cannot cancel booking with current status', 400);
    }
    
    // ⚡ NO CANCELLATION CHARGE FOR SEARCHING BOOKINGS
    // Update booking status
    booking.status = 'cancelled';
    booking.cancellationReason = cancellationReason || 'Cancelled by user';
    booking.cancelledBy = 'user';
    booking.timestamps.cancelledAt = new Date();
    
    await booking.save();
    
    // Notify all pending providers
    const pendingProviders = booking.notifiedProviders.filter(np => np.response === 'pending');
    
    if (pendingProviders.length > 0) {
      const bulkNotifications = pendingProviders.map(notifiedProvider => ({
        recipient: notifiedProvider.provider,
        recipientModel: 'ServiceProvider',
        type: 'booking_cancelled',
        title: 'Booking Cancelled',
        message: `Booking ${booking.bookingId} has been cancelled by the user.`,
        data: {
          bookingId: booking._id,
          bookingIdDisplay: booking.bookingId,
          cancellationReason: booking.cancellationReason
        },
        channels: { push: true, email: false, sms: false }
      }));
      
      await Notification.insertMany(bulkNotifications);
      
      // Send push notifications
      await Promise.all(
        pendingProviders.map(np => 
          PushNotificationService.sendToProvider(np.provider, {
            title: 'Booking Cancelled',
            body: 'This booking has been cancelled by the user'
          })
        )
      );
    }
    
    ResponseHandler.success(res, { 
      booking,
      message: 'Booking cancelled successfully. No cancellation charges applied.'
    }, 'Booking cancelled successfully');
  } catch (error) {
    logger.error(`Cancel booking error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ========================== GET USER BOOKINGS ==========================
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

// ========================== GET PROVIDER BOOKINGS ==========================
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

// ========================== GET PROVIDER STATS ==========================
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
    
    // Calculate acceptance rate
    const notifiedBookings = await Booking.countDocuments({
      'notifiedProviders.provider': providerId
    });
    
    const acceptedBookings = await Booking.countDocuments({
      provider: providerId
    });
    
    const acceptanceRate = notifiedBookings > 0 ? 
      (acceptedBookings / notifiedBookings * 100).toFixed(1) : 0;
    
    // Calculate average rating
    const provider = await ServiceProvider.findById(providerId);
    const averageRating = provider.ratings?.average || 0;
    
    ResponseHandler.success(res, {
      statusStats: stats,
      todayBookings,
      todayEarnings: todayEarnings[0]?.total || 0,
      totalEarnings: totalEarnings[0]?.total || 0,
      acceptanceRate,
      averageRating,
      totalCompleted: acceptedBookings
    }, 'Stats fetched successfully');
  } catch (error) {
    logger.error(`Get provider stats error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ========================== GET BOOKING ACCEPTANCE STATUS ==========================
exports.getBookingAcceptanceStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;
    
    let query = { _id: bookingId };
    if (userRole === 'user') query.user = userId;
    
    const booking = await Booking.findOne(query)
      .populate('user', 'name phone')
      .populate('provider', 'name phone profilePicture ratings address vehicle')
      .lean();
    
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }
    
    // Calculate time elapsed since searching started
    let acceptanceInfo = null;
    if (booking.status === 'searching') {
      const firstNotification = booking.notifiedProviders[0];
      let timeElapsed = 0;
      
      if (firstNotification) {
        const notifiedAt = new Date(firstNotification.notifiedAt);
        const now = new Date();
        timeElapsed = (now - notifiedAt) / 1000; // in seconds
      }
      
      acceptanceInfo = {
        status: 'waiting_for_acceptance',
        searchingDuration: Math.floor(timeElapsed / 60), // minutes searching
        searchingDurationSeconds: Math.floor(timeElapsed % 60),
        providersNotified: booking.notifiedProviders.length,
        providersAccepted: booking.notifiedProviders.filter(np => np.response === 'accepted').length,
        providersRejected: booking.notifiedProviders.filter(np => np.response === 'rejected').length,
        providersPending: booking.notifiedProviders.filter(np => np.response === 'pending').length,
        // ⚡ IMPORTANT: Show user they can cancel anytime
        canCancel: true,
        message: 'Providers can accept anytime. You can cancel and retry if needed.'
      };
    } else if (booking.status === 'provider-assigned' && booking.provider) {
      // Calculate provider's ETA
      const provider = booking.provider;
      const userLocation = booking.address.location.coordinates;
      
      if (provider.address && provider.address.location) {
        const distance = GeoService.calculateDistance(
          provider.address.location.coordinates[1],
          provider.address.location.coordinates[0],
          userLocation[1],
          userLocation[0]
        );
        
        const estimatedTime = calculateEstimatedTime(distance);
        
        acceptanceInfo = {
          status: 'provider_accepted',
          provider: {
            name: provider.name,
            phone: provider.phone,
            profilePicture: provider.profilePicture,
            rating: provider.ratings?.average || 5.0,
            vehicle: provider.vehicle
          },
          distance: distance.toFixed(1),
          estimatedArrival: estimatedTime,
          estimatedArrivalTime: booking.tracking?.estimatedArrival || 
            new Date(Date.now() + estimatedTime * 60000),
          providerLocation: booking.tracking?.providerLocation,
          providerOnTheWay: booking.status === 'on-the-way',
          canCancel: false // Can't cancel once provider assigned
        };
      }
    } else if (booking.status === 'no-provider-found') {
      acceptanceInfo = {
        status: 'no_providers',
        message: 'No providers available in your area. Please try again later.',
        canRetry: true
      };
    } else if (booking.status === 'cancelled') {
      acceptanceInfo = {
        status: 'cancelled',
        message: 'Booking was cancelled.',
        canCreateNew: true
      };
    }
    
    ResponseHandler.success(res, {
      bookingId: booking.bookingId,
      status: booking.status,
      service: booking.serviceDetails,
      acceptanceInfo,
      tracking: booking.tracking || null,
      timestamps: booking.timestamps || {},
      // Important info for frontend
      canCancel: booking.status === 'searching',
      canRetry: ['cancelled', 'no-provider-found'].includes(booking.status)
    }, 'Booking acceptance status fetched');
    
  } catch (error) {
    logger.error(`Get acceptance status error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ========================== ADMIN: GET ALL BOOKINGS ==========================
exports.getAllBookings = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, sortBy = 'createdAt', order = 'desc' } = req.query;
    
    const query = {};
    if (status) {
      query.status = status;
    }
    
    const skip = (page - 1) * limit;
    const sortOrder = order === 'asc' ? 1 : -1;
    
    const bookings = await Booking.find(query)
      .populate('user', 'name phone email')
      .populate('provider', 'name phone')
      .populate('service', 'title category')
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
    }, 'All bookings fetched successfully');
  } catch (error) {
    logger.error(`Get all bookings error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ========================== ADMIN: UPDATE BOOKING STATUS ==========================
exports.adminUpdateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, cancellationReason, cancelledBy } = req.body;
    
    const booking = await Booking.findById(id);
    
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }
    
    const oldStatus = booking.status;
    booking.status = status;
    
    if (status === 'cancelled') {
      booking.cancellationReason = cancellationReason;
      booking.cancelledBy = cancelledBy || 'admin';
      booking.timestamps.cancelledAt = new Date();
    }
    
    await booking.save();
    
    // Notify user about status change
    if (booking.user) {
      await PushNotificationService.sendToUser(
        booking.user,
        'Booking Status Updated',
        `Your booking ${booking.bookingId} status has been updated to ${status}`
      );
    }
    
    ResponseHandler.success(res, { booking }, 'Booking status updated successfully');
  } catch (error) {
    logger.error(`Admin update booking status error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ========================== GET BOOKING ANALYTICS ==========================
exports.getBookingAnalytics = async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const userId = req.user._id;
    const userRole = req.user.role;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    
    let matchQuery = { createdAt: { $gte: startDate } };
    
    if (userRole === 'user') {
      matchQuery.user = userId;
    } else if (userRole === 'provider') {
      matchQuery.provider = userId;
    }
    
    // Daily bookings count
    const dailyBookings = await Booking.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Status distribution
    const statusDistribution = await Booking.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Monthly trend
    const monthlyTrend = await Booking.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          count: { $sum: 1 },
          revenue: { $sum: "$totalAmount" }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    ResponseHandler.success(res, {
      dailyBookings,
      statusDistribution,
      monthlyTrend,
      period: `${days} days`
    }, 'Booking analytics fetched successfully');
  } catch (error) {
    logger.error(`Get booking analytics error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ========================== RESEND PROVIDER NOTIFICATIONS ==========================
exports.resendProviderNotifications = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user._id;
    
    const booking = await Booking.findOne({
      _id: bookingId,
      user: userId
    });
    
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }
    
    if (booking.status !== 'searching') {
      return ResponseHandler.error(res, 'Cannot resend notifications for this booking status', 400);
    }
    
    // Clear existing notifications
    booking.notifiedProviders = [];
    booking.searchAttempts = 0;
    booking.providerSearchRadius = 5;
    
    await booking.save();
    
    // Restart provider search
    searchAndNotifyProviders(booking);
    
    ResponseHandler.success(res, { booking }, 'Provider notifications resent successfully');
  } catch (error) {
    logger.error(`Resend notifications error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ========================== HELPER FUNCTIONS ==========================

// Calculate estimated arrival time based on distance and traffic
function calculateEstimatedTime(distance) {
  // Base time calculation (30 km/h average speed)
  const baseTime = (distance / 30) * 60; // in minutes
  
  // Add traffic factor (random between 1.2 to 1.8)
  const trafficFactor = 1.2 + Math.random() * 0.6;
  
  // Add pickup preparation time (2-5 minutes)
  const preparationTime = 2 + Math.random() * 3;
  
  return Math.ceil(baseTime * trafficFactor + preparationTime);
}

// Calculate estimated arrival datetime
function calculateEstimatedArrivalTime(distance) {
  const estimatedMinutes = calculateEstimatedTime(distance);
  const arrivalTime = new Date();
  arrivalTime.setMinutes(arrivalTime.getMinutes() + estimatedMinutes);
  return arrivalTime;
}

module.exports = exports;