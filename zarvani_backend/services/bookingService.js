// ============= services/bookingService.js =============
const Booking = require('../models/Booking');
const ServiceProvider = require('../models/ServiceProvider');
const { Service } = require("../models/Service");
const Product = require("../models/Product");
const NotificationService = require('./notificationService');
const GeoService = require('./geoService');
const CacheService = require('./cacheService');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

class BookingService {
    /**
     * Helper: Calculate ETA based on distance
     */
    static calculateEstimatedTime(distance) {
        return Math.max(10, Math.round(distance * 4));
    }

    /**
     * Create a new booking and initiate provider search
     */
    static async createBooking(data, app = null) {
        const { userId, body } = data;
        const {
            service, scheduledDate, scheduledTime, isImmediate,
            address, products, notes, phone
        } = body;

        const serviceData = await Service.findById(service);
        if (!serviceData) throw new Error('Service not found');

        let totalAmount = serviceData.pricing.discountedPrice || serviceData.pricing.basePrice;
        if (products?.length > 0) {
            const productIds = products.map(p => p.product);
            const productDocs = await Product.find({ _id: { $in: productIds } });
            const productMap = new Map(productDocs.map(p => [p._id.toString(), p]));

            for (const item of products) {
                const prod = productMap.get(item.product.toString());
                if (prod) totalAmount += prod.price.sellingPrice * item.quantity;
            }
        }

        const bookingId = `BK${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const booking = await Booking.create({
            bookingId,
            user: userId,
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
            phone,
            status: 'searching',
            timestamps: { searchingAt: new Date() }
        });

        this.searchAndNotifyProviders(booking, app).catch(e => logger.error(`Provider Search Error: ${e.message}`));
        return booking;
    }

    /**
     * Search and notify nearby providers
     */
    static async searchAndNotifyProviders(booking, app = null) {
        try {
            const serviceCategory = booking.serviceDetails.category;
            const userLocation = booking.address.location.coordinates;
            const searchRadius = booking.providerSearchRadius || 5;

            const providers = await ServiceProvider.find({
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

            if (providers.length === 0) return this.handleNoProvidersFound(booking, app);

            const notifiedList = [];
            for (const provider of providers) {
                const distance = GeoService.calculateDistance(
                    provider.address.location.coordinates[1],
                    provider.address.location.coordinates[0],
                    userLocation[1],
                    userLocation[0]
                );
                const eta = this.calculateEstimatedTime(distance);

                notifiedList.push({
                    provider: provider._id,
                    notifiedAt: new Date(),
                    response: "pending",
                    metadata: { distance, estimatedTime: eta, providerName: provider.name }
                });

                NotificationService.send({
                    recipient: provider._id,
                    recipientType: 'ServiceProvider',
                    type: 'booking',
                    title: 'New Service Request!',
                    message: `${booking.serviceDetails.title} - ₹${booking.totalAmount} (${distance.toFixed(1)}km away)`,
                    data: { bookingId: booking._id, distance, eta }
                }, app).catch(e => logger.error(`Provider Notify Error: ${e.message}`));
            }

            booking.notifiedProviders = notifiedList;
            await booking.save();
        } catch (error) {
            logger.error(`Search Workflow Error: ${error.message}`);
        }
    }

    static async handleNoProvidersFound(booking, app = null) {
        booking.status = "no-provider-found";
        await booking.save();
        NotificationService.send({
            recipient: booking.user, recipientType: 'User', type: 'alert',
            title: 'No Providers Found', message: 'No providers available. Please try again later.'
        }, app);
    }

    static async acceptBooking(bookingId, providerId, app = null) {
        const booking = await Booking.findOne({ $or: [{ _id: bookingId }, { bookingId }], status: 'searching' });
        if (!booking) throw new Error('Booking no longer available');

        booking.provider = providerId;
        booking.status = "provider-assigned";
        await booking.save();

        NotificationService.send({
            recipient: booking.user, recipientType: 'User', type: 'booking',
            title: 'Provider Assigned!', message: 'Provider has accepted your booking.',
            data: { bookingId: booking._id }
        }, app);
        return booking;
    }

    static async rejectBooking(bookingId, providerId) {
        const booking = await Booking.findById(bookingId);
        if (!booking) throw new Error('Booking not found');

        const np = booking.notifiedProviders.find(p => p.provider.toString() === providerId.toString());
        if (np) {
            np.response = 'rejected';
            np.respondedAt = new Date();
            await booking.save();
        }
        return booking;
    }

    static async updateStatus(bookingId, providerId, { status, completionNotes, latitude, longitude }, app = null) {
        const booking = await Booking.findOne({ _id: bookingId, provider: providerId }).populate('user');
        if (!booking) throw new Error('Booking not found');

        booking.status = status;

        // Update timestamps based on status
        const timestampMap = {
            'on-the-way': 'onTheWayAt',
            'reached': 'reachedAt',
            'in-progress': 'inProgressAt',
            'completed': 'completedAt'
        };

        if (timestampMap[status]) {
            booking.timestamps = booking.timestamps || {};
            booking.timestamps[timestampMap[status]] = new Date();
        }

        if (status === 'completed') {
            booking.completedAt = new Date();
            if (completionNotes) booking.completionNotes = completionNotes;

            // Update provider performance and availability
            await ServiceProvider.findByIdAndUpdate(providerId, {
                $inc: { completedServices: 1 },
                'availability.isAvailable': true,
                'availability.lastStatusUpdate': new Date()
            });
        }

        // Update location if provided
        if (latitude && longitude) {
            booking.tracking = booking.tracking || {};
            booking.tracking.providerLocation = {
                type: 'Point',
                coordinates: [longitude, latitude],
                updatedAt: new Date()
            };
        }

        await booking.save();

        // Notify user with context-aware message
        const statusMessages = {
            'on-the-way': `Provider is on the way to your location`,
            'reached': `Provider has reached your location`,
            'in-progress': `Service is now in progress`,
            'completed': `Service completed successfully`
        };

        if (statusMessages[status]) {
            NotificationService.send({
                recipient: booking.user._id,
                recipientType: 'User',
                type: 'booking',
                title: 'Booking Update',
                message: statusMessages[status],
                data: { bookingId: booking._id, status }
            }, app).catch(e => logger.error(`Booking Update Notification Error: ${e.message}`));
        }

        return booking;
    }
}

module.exports = BookingService;
