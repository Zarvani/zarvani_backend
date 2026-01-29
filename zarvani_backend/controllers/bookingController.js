const Booking = require('../models/Booking');
const ServiceProvider = require('../models/ServiceProvider');
const ResponseHandler = require('../utils/responseHandler');
const BookingService = require('../services/bookingService');
const logger = require('../utils/logger');
const mongoose = require("mongoose");
const CacheService = require('../services/cacheService');
const CacheInvalidationService = require('../services/cacheInvalidationService');
const { batchLoadAndAttach } = require('../utils/batchLoader');

const searchQueue = require('../queues/searchQueue');

// ========================== CREATE BOOKING ==========================
exports.createBooking = async (req, res) => {
  try {
    const booking = await BookingService.createBooking({
      userId: req.user._id,
      body: req.body
    }, req.app);

    // ✅ DURABILITY: Add to persistent search queue 
    // Ensures provider search continues even if the server restarts
    await searchQueue.add({ bookingId: booking._id });

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

// Note: Internal searchAndNotifyProviders logic moved to queues/searchQueue.js

// ========================== PROVIDER ACCEPTS BOOKING ==========================
exports.acceptBooking = async (req, res) => {
  try {
    const booking = await BookingService.acceptBooking(req.params.id, req.user._id, req.app);
    return ResponseHandler.success(res, { booking }, 'Booking accepted successfully');
  } catch (error) {
    logger.error(`Accept booking error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};


// ========================== PROVIDER REJECTS BOOKING ==========================
exports.rejectBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const providerId = req.user._id;

    const booking = await BookingService.rejectBooking(bookingId, providerId);
    ResponseHandler.success(res, { bookingId: booking._id }, 'Booking rejected');
  } catch (error) {
    logger.error(`Reject booking error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ========================== UPDATE PROVIDER LOCATION ==========================
exports.updateProviderLocation = async (req, res) => {
  try {
    const bookingId = req.params.id;
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
    const durationMinutes = BookingService.calculateEstimatedTime(distance);
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
// ==================== MARK BOOKING AS PAID (PERSONAL PAYMENT) ====================
exports.markBookingPaid = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { paymentMethod = 'cash', transactionId } = req.body;
    const providerId = req.user._id;
    const booking = await Booking.findOne({
      _id: bookingId,
      provider: providerId,
      status: { $in: ['completed', 'in-progress'] }
    });
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found or not authorized', 404);
    }

    // 2️⃣ If payment already done (online at booking time), skip payment logic
    if (booking.payment?.status === 'paid') {
      booking.status = 'completed';  // mark service as completed
      booking.completedAt = new Date();

      await booking.save();

      return ResponseHandler.success(res, {
        booking,
        commission: null
      }, 'Service completed successfully');
    }

    const personalPaymentMethods = ['cash', 'personal_upi', 'cod'];
    const isPersonalPayment = personalPaymentMethods.includes(paymentMethod);
    booking.payment.method = paymentMethod;
    booking.payment.status = 'paid';
    booking.payment.paidAt = new Date();
    booking.payment.receivedBy = isPersonalPayment ? 'provider' : 'company';
    if (transactionId) {
      booking.payment.transactionId = transactionId;
    }
    const payment = await Payment.create({
      transactionId: transactionId || `PAY-${Date.now()}`,
      booking: booking._id,
      user: booking.user,
      provider: providerId,
      amount: booking.totalAmount,
      paymentMethod: paymentMethod,
      paymentDestination: isPersonalPayment ? 'personal_account' : 'company_account',
      paymentType: 'service',
      status: 'success',
      paymentDate: new Date()
    });

    // 6️⃣ Handle commission
    if (isPersonalPayment) {
      // Track pending commission
      await CommissionService.trackPersonalPayment(payment);

      booking.payment.commissionStatus = 'pending';
      booking.payment.commissionAmount = payment.commission.pendingCommission;
      booking.payment.commissionDueDate = payment.pendingCommission.dueDate;
    } else {
      // Auto payout for company payment
      await CommissionService.processAutoPayout(payment);
      booking.payment.commissionStatus = 'not_applicable';
    }

    // 7️⃣ Update service status
    booking.status = 'completed';
    booking.completedAt = new Date();

    await booking.save();

    // 8️⃣ Send notification to user
    await PushNotificationService.sendToUser(
      booking.user,
      'Payment Received ✅',
      `Payment of ₹${booking.totalAmount} has been received for your ${booking.serviceDetails?.title || 'booking'}.`
    );

    // 9️⃣ Return response
    ResponseHandler.success(res, {
      booking,
      commission: isPersonalPayment ? {
        amount: payment.commission.pendingCommission,
        dueDate: payment.pendingCommission.dueDate,
        status: 'pending'
      } : null
    }, 'Payment recorded successfully');

  } catch (error) {
    logger.error(`Mark booking paid error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ✅ Get provider commission summary
exports.getProviderCommissionSummary = async (req, res) => {
  try {
    const providerId = req.user._id;

    const summary = await CommissionService.getCommissionSummary(providerId, 'provider');

    // Get provider model for total earnings
    const provider = await ServiceProvider.findById(providerId);

    ResponseHandler.success(res, {
      summary,
      earnings: {
        total: provider.earnings.total,
        commission: {
          due: provider.commission.due,
          paid: provider.commission.paid
        }
      },
      commissionRate: '20% (personal payments)'
    }, 'Commission summary fetched');

  } catch (error) {
    logger.error(`Get provider commission error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
// ========================== UPDATE BOOKING STATUS ==========================
exports.updateBookingStatus = async (req, res) => {
  try {
    const bookingId = req.params.id;
    const providerId = req.user._id;

    const booking = await BookingService.updateStatus(bookingId, providerId, req.body, req.app);
    ResponseHandler.success(res, { booking }, 'Status updated successfully');
  } catch (error) {
    logger.error(`Update status error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ========================== GET TRACKING INFO ==========================
exports.getTrackingInfo = async (req, res) => {
  try {
    const { id } = req.params;

    const booking = await Booking.findOne({
      _id: id,
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

    // Cache key
    const cacheKey = `provider:${providerId}:pending-requests`;

    // Try cache (30 second TTL for real-time data)
    const cached = await CacheService.get(cacheKey);
    if (cached) {
      logger.debug(`Cache HIT: Pending requests for ${providerId}`);
      return ResponseHandler.success(res, cached, 'Pending requests fetched from cache');
    }

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

    // Use .lean() for faster queries
    const bookings = await Booking.find({
      status: "searching",
      "notifiedProviders.provider": providerId,
      "notifiedProviders.response": "pending"
    })
      .lean()
      .sort({ createdAt: -1 });

    if (!bookings.length) {
      const emptyResponse = { bookings: [], providerLocation };
      await CacheService.set(cacheKey, emptyResponse, 30);
      return ResponseHandler.success(res, emptyResponse, "No pending requests found");
    }

    // Batch load users
    await batchLoadAndAttach(
      bookings,
      'user',
      require('../models/User'),
      'user',
      'name phone profilePicture'
    );

    // Batch load services
    await batchLoadAndAttach(
      bookings,
      'service',
      Service,
      'service',
      'title category pricing duration'
    );

    // Enhance booking data
    const GeoService = require('../services/geoService');
    const enhancedBookings = bookings.map((booking) => {
      const userLocation = booking.address?.location?.coordinates || [0, 0];

      let distance = 0;
      try {
        distance = GeoService.calculateDistance(
          providerLocation[1], providerLocation[0],
          userLocation[1], userLocation[0]
        );
      } catch (err) {
        distance = 0;
      }

      const estimatedTime = BookingService.calculateEstimatedTime(distance);

      const notify = booking.notifiedProviders.find(
        (np) => np.provider.toString() === providerId.toString()
      );

      const notifiedAt = new Date(notify?.notifiedAt || new Date());
      const now = new Date();
      const timeElapsed = (now - notifiedAt) / 1000;
      const timeElapsedMinutes = Math.floor(timeElapsed / 60);

      const formattedAddress = booking.address?.addressLine1
        ? `${booking.address.addressLine1}, ${booking.address.city}`
        : booking.address?.city || "Unknown Location";

      return {
        ...booking,
        distance: distance.toFixed(1),
        estimatedTime,
        formattedAddress,
        timeElapsed: timeElapsedMinutes,
        urgency: distance < 3 ? "high" : distance < 10 ? "medium" : "low"
      };
    });

    const response = { bookings: enhancedBookings, providerLocation };

    // Cache for 30 seconds (real-time data)
    await CacheService.set(cacheKey, response, 30);

    return ResponseHandler.success(res, response, "Pending requests fetched");

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

    // Invalidate cache
    await CacheInvalidationService.invalidateBooking(booking).catch(e => logger.error(`Cache invalidation error: ${e.message}`));

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

    // Build cache key
    const cacheKey = CacheService.userKey(userId, `bookings:${status || 'all'}:p${page}`);

    // Try cache first (for first page only)
    if (page == 1) {
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        logger.debug(`Cache HIT: User bookings for ${userId}`);
        return ResponseHandler.success(res, cached, 'Bookings fetched from cache');
      }
    }

    const query = { user: userId };
    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;
    const sortOrder = order === 'asc' ? 1 : -1;

    // OPTIMIZATION 1: Use .lean() for faster queries
    const bookings = await Booking.find(query)
      .lean()
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(parseInt(limit));

    // OPTIMIZATION 2: Batch load services (1 query instead of N)
    await batchLoadAndAttach(
      bookings,
      'service',
      Service,
      'service',
      'title category pricing'
    );

    // OPTIMIZATION 3: Batch load providers (1 query instead of N)
    await batchLoadAndAttach(
      bookings,
      'provider',
      ServiceProvider,
      'provider',
      'name phone profilePicture ratings'
    );

    const total = await Booking.countDocuments(query);

    const response = {
      bookings,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit)
      }
    };

    // Cache for 2 minutes (first page only)
    if (page == 1) {
      await CacheService.set(cacheKey, response, 120);
    }

    ResponseHandler.success(res, response, 'Bookings fetched successfully');
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

    // Build cache key
    const cacheKey = `provider:${providerId}:bookings:${status || 'all'}:p${page}`;

    // Try cache first
    if (page == 1) {
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        logger.debug(`Cache HIT: Provider bookings for ${providerId}`);
        return ResponseHandler.success(res, cached, 'Bookings fetched from cache');
      }
    }

    const query = { provider: providerId };
    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;
    const sortOrder = order === 'asc' ? 1 : -1;

    // Use .lean() for faster queries
    const bookings = await Booking.find(query)
      .lean()
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(parseInt(limit));

    // Batch load users
    await batchLoadAndAttach(
      bookings,
      'user',
      require('../models/User'),
      'user',
      'name phone address'
    );

    // Batch load services
    await batchLoadAndAttach(
      bookings,
      'service',
      Service,
      'service',
      'title category pricing'
    );

    const total = await Booking.countDocuments(query);

    const response = {
      bookings,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit)
      }
    };

    // Cache for 1 minute
    if (page == 1) {
      await CacheService.set(cacheKey, response, 60);
    }

    ResponseHandler.success(res, response, 'Provider bookings fetched successfully');
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

        const estimatedTime = BookingService.calculateEstimatedTime(distance);

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
  // Assume average speed of 30 km/h in city
  const avgSpeed = 30;
  const timeInHours = distance / avgSpeed;
  const timeInMinutes = timeInHours * 60;
  return Math.ceil(timeInMinutes);
}

// Calculate estimated arrival datetime
function calculateEstimatedArrivalTime(distance) {
  const estimatedMinutes = BookingService.calculateEstimatedTime(distance);
  const arrivalTime = new Date();
  arrivalTime.setMinutes(arrivalTime.getMinutes() + estimatedMinutes);
  return arrivalTime;
}

async function invalidateBookingCache(booking) {
  try {
    // Invalidate user's booking cache
    if (booking.user) {
      await CacheService.delPattern(`user:${booking.user}:bookings:*`);
    }

    // Invalidate provider's booking cache
    if (booking.provider) {
      await CacheService.delPattern(`provider:${booking.provider}:bookings:*`);
      await CacheService.delPattern(`provider:${booking.provider}:pending-requests`);
    }

    // Invalidate all notified providers' pending requests
    if (booking.notifiedProviders && booking.notifiedProviders.length > 0) {
      await Promise.all(
        booking.notifiedProviders.map(np =>
          CacheService.del(`provider:${np.provider}:pending-requests`)
        )
      );
    }
  } catch (error) {
    logger.error(`Cache invalidation error: ${error.message}`);
  }
}

module.exports.invalidateBookingCache = invalidateBookingCache;

module.exports = exports;