// ============= services/notificationService.js =============
const { Notification } = require('../models/Notification');
const PushNotificationService = require('./pushNotification');
const logger = require('../utils/logger');

class NotificationService {
    /**
     * Send notification to a specific user/provider/shop
     * @param {Object} params - Notification parameters
     * @param {string} params.recipient - ID of the recipient
     * @param {string} params.recipientType - Model type (User/ServiceProvider/Shop)
     * @param {string} params.type - Notification type
     * @param {string} params.title - Notification title
     * @param {string} params.message - Notification message
     * @param {Object} [params.data] - Extra data for notification
     * @param {Object} [params.channels] - { push: boolean, socket: boolean, email: boolean }
     * @param {Object} [app] - Express app instance to get 'io'
     */
    static async send(params, app = null) {
        try {
            const {
                recipient, recipientType, type, title, message,
                data = {}, channels = { push: true, socket: true }
            } = params;

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
