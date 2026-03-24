const { Notification } = require('../models/Notification');
const PushNotificationService = require('./pushNotification');
const logger = require('../utils/logger');


const YETZO_TEMPLATES = {
    'confirmed': [
        { title: 'Hang tight! 🍔', body: 'Your cravings are being packed right now.' },
        { title: 'Order Confirmed! 🎉', body: 'The chef is doing their magic. Get ready!' },
        { title: 'We got it! 🎯', body: 'Your order is confirmed and prep has started.' }
    ],
    'preparing': [
        { title: 'Fire in the hole! 🔥', body: 'Your order is currently being freshly prepared.' },
        { title: 'Sizzle sizzle! 🍳', body: 'Your items are cooking exactly how you like them.' }
    ],
    'out_for_delivery': [
        { title: 'Zoom zoom! 🛵', body: 'Your rider just picked up your order. Be ready!' },
        { title: 'Incoming! ⚡', body: 'Your package is flying through the streets right now.' },
        { title: 'Almost there! 🕒', body: 'Delivery partner is on the way. Tracking is live.' }
    ],
    'delivered': [
        { title: 'Bon Appétit! 🍽️', body: 'Your order has safely arrived. Enjoy your meal!' },
        { title: 'Mission Accomplished! 🎯', body: 'Delivered safe and sound. Share your rating!' }
    ],
    'service_confirmed': [
        { title: 'Help is on the way! 🛠️', body: 'Your service booking is officially confirmed.' },
        { title: 'Locked in! 📅', body: 'We found the perfect professional for your job.' }
    ],
    'provider_assigned': [
        { title: 'Expert matched! 🦸‍♂️', body: 'A top-rated professional has been assigned to you.' },
        { title: 'Say hello! 🤝', body: 'Your service partner is assigned and ready.' }
    ],
    'in_progress': [
        { title: 'Work mode: ON ⚡', body: 'The service has officially started. Watch the magic.' }
    ],
    'service_completed': [
        { title: 'Job well done! ✅', body: 'Your service is completed securely. Rate your professional!' }
    ]
};

// Helper: Match and randomize
const getEngagingCopy = (title, defaultTitle, defaultMsg, isService) => {
    const tLower = title.toLowerCase();
    let key = '';

    if (tLower.includes('confirm') && isService) key = 'service_confirmed';
    else if (tLower.includes('confirm')) key = 'confirmed';
    else if (tLower.includes('prepar')) key = 'preparing';
    else if (tLower.includes('out') && tLower.includes('deliver')) key = 'out_for_delivery';
    else if (tLower.includes('deliver') && !tLower.includes('out')) key = 'delivered';
    else if (tLower.includes('assign')) key = 'provider_assigned';
    else if (tLower.includes('progress') || tLower.includes('start')) key = 'in_progress';
    else if (tLower.includes('complet')) key = 'service_completed';

    if (key && YETZO_TEMPLATES[key]) {
        const templates = YETZO_TEMPLATES[key];
        const selected = templates[Math.floor(Math.random() * templates.length)];
        return { title: selected.title, message: selected.body };
    }
    return { title: defaultTitle, message: defaultMsg }; // Fallback to original
};

class NotificationService {
    /**
     * Send notification to a specific user/provider/shop
     * ...
     */
    static async send(params, app = null) {
        try {
            let {
                recipient, recipientType, type, title, message,
                data = {}, channels = { push: true, socket: true }
            } = params;

            // ✅ Inject Zomato-style copy ONLY for Users
            if (recipientType === 'User' && title) {
                const isService = data?.bookingId !== undefined;
                const engaging = getEngagingCopy(title, title, message, isService);
                title = engaging.title;
                message = engaging.message;
            }

            // 1. Save to Database
            const notification = await Notification.create({
                recipient,
                recipientModel: recipientType,
                type,
                title,
                message,
                data,
                channels: {
                    push: channels.push || false,
                    email: channels.email || false
                }
            });

            // 2. Real-time via Socket.IO
            if (channels.socket && app) {
                const io = app.get('io');
                if (io) {
                    io.to(`user_${recipient}`).emit('new-notification', {
                        id: notification._id,
                        type,
                        title,
                        message,
                        data,
                        createdAt: notification.createdAt
                    });
                    logger.info(`Socket notification sent to user_${recipient}`);
                }
            }

            // 3. Push Notification (FCM Placeholder)
            if (channels.push) {
                // This will use the existing PushNotificationService logic
                if (recipientType === 'Shop') {
                    await PushNotificationService.sendToShop(recipient, title, message, data);
                } else if (recipientType === 'ServiceProvider') {
                    await PushNotificationService.sendToDeliveryPerson(recipient, title, message, data);
                } else {
                    await PushNotificationService.sendToUser(recipient, title, message, data);
                }
            }

            return notification;
        } catch (error) {
            logger.error(`NotificationService Error: ${error.message}`);
            return null;
        }
    }

    /**
     * Send bulk notifications
     */
    static async sendBulk(recipientIds, recipientType, title, message, data = {}, app = null) {
        const promises = recipientIds.map(id => this.send({
            recipient: id,
            recipientType,
            type: 'alert',
            title,
            message,
            data
        }, app));

        return Promise.all(promises);
    }
}

module.exports = NotificationService;
