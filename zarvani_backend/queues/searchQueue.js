const Bull = require('bull');
const ServiceProvider = require('../models/ServiceProvider');
const Booking = require('../models/Booking');
const PushNotificationService = require('../services/pushNotification');
const Notification = require('../models/Notification');
const GeoService = require('../services/geoService');
const BookingService = require('../services/bookingService');
const logger = require('../utils/logger');

const searchQueue = new Bull('provider-search', {
    redis: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: process.env.REDIS_PORT || 6379,
    },
    defaultJobOptions: {
        attempts: 1, // We handle retries manually by adding new jobs with delay
        removeOnComplete: true,
        removeOnFail: 10
    }
});

// Process Search Job
searchQueue.process(async (job) => {
    const { bookingId } = job.data;
    const booking = await Booking.findById(bookingId).populate('user');

    if (!booking || !['pending', 'searching'].includes(booking.status)) {
        return { status: 'skipped', reason: 'Booking already assigned or cancelled' };
    }

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

    if (availableProviders.length === 0) {
        // Expand radius if possible
        if (booking.searchAttempts < 3 && booking.providerSearchRadius < booking.maxSearchRadius) {
            booking.providerSearchRadius += 5;
            booking.searchAttempts += 1;
            await booking.save();

            logger.info(`Expanding radius to ${booking.providerSearchRadius}km for booking ${booking.bookingId}`);

            // Re-queue with 30s delay (DURABLE RETRY)
            await searchQueue.add({ bookingId: booking._id }, { delay: 30000 });
            return { status: 'expanded', radius: booking.providerSearchRadius };
        }

        // Exhausted options
        booking.status = "no-provider-found";
        await booking.save();

        await PushNotificationService.sendToUser(
            booking.user._id,
            "No Providers Found",
            "Sorry, no providers are available near your location."
        );
        return { status: 'failed', reason: 'No providers after max retries' };
    }

    // Providers found - Calculate distances and trigger notifications
    const providersWithDistance = await Promise.all(
        availableProviders.map(async (provider) => {
            const distance = GeoService.calculateDistance(
                provider.address.location.coordinates[1],
                provider.address.location.coordinates[0],
                userLocation[1],
                userLocation[0]
            );

            // Calculate estimated arrival time
            const estimatedTime = BookingService.calculateEstimatedTime(distance);

            return {
                provider,
                distance,
                estimatedTime
            };
        })
    );

    // Sort by distance (nearest first)
    providersWithDistance.sort((a, b) => a.distance - b.distance);

    // Update booking with notified providers
    const notifiedProviders = providersWithDistance.map(pwd => ({
        provider: pwd.provider._id,
        notifiedAt: new Date(),
        response: "pending",
        metadata: {
            distance: pwd.distance,
            estimatedTime: pwd.estimatedTime,
            providerName: pwd.provider.name,
            providerRating: pwd.provider.ratings?.average || 5.0
        }
    }));

    booking.notifiedProviders = notifiedProviders;
    await booking.save();

    // Trigger push notifications
    await Promise.all(
        providersWithDistance.map(async (pwd) => {
            const provider = pwd.provider;
            const notificationData = {
                bookingId: booking._id,
                bookingIdDisplay: booking.bookingId,
                service: booking.serviceDetails.title,
                amount: booking.totalAmount,
                address: `${booking.address.addressLine1}, ${booking.address.city}`,
                distance: pwd.distance.toFixed(2),
                estimatedTime: pwd.estimatedTime,
                priority: pwd.distance < 3 ? 'high' : pwd.distance < 10 ? 'medium' : 'low'
            };

            // Save in DB
            await Notification.create({
                recipient: provider._id,
                recipientModel: "ServiceProvider",
                type: "booking_request",
                title: "🚀 New Booking Request",
                message: `${booking.serviceDetails.title} - ₹${booking.totalAmount}\nDistance: ${pwd.distance.toFixed(1)}km • ETA: ${pwd.estimatedTime} min`,
                data: notificationData,
                channels: { push: true, email: false, sms: false }
            });

            // Send Push
            await PushNotificationService.sendToProvider(provider._id, {
                title: `New ${booking.serviceDetails.category} Request`,
                body: `₹${booking.totalAmount} • ${pwd.distance.toFixed(1)}km away • ${pwd.estimatedTime} min`,
                data: notificationData
            }).catch(e => logger.error(`Push notify error in worker: ${e.message}`));
        })
    );

    return { status: 'found', count: availableProviders.length };
});

module.exports = searchQueue;
