// ============= services/pushNotification.js =============
const admin = require('firebase-admin');
const logger = require('../utils/logger');
const User = require('../models/User');
const Shop = require('../models/Shop');
const ServiceProvider = require('../models/ServiceProvider');
const path = require('path');

// Initialize Firebase Admin
try {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (serviceAccountPath) {
    admin.initializeApp({
      credential: admin.credential.cert(path.resolve(serviceAccountPath))
    });
    logger.info('Firebase Admin initialized successfully');
  } else {
    logger.warn('FIREBASE_SERVICE_ACCOUNT_PATH not found in env. Push notifications will be simulated.');
  }
} catch (error) {
  logger.error(`Firebase Initialization Error: ${error.message}`);
}

class PushNotificationService {
  /**
   * Core send method
   */
  static async sendPushNotification(tokens, title, body, data = {}) {
    if (!admin.apps.length || !tokens || (Array.isArray(tokens) && tokens.length === 0)) {
      logger.info(`Simulated Push: ${title} - ${body}`);
      return true;
    }

    const message = {
      notification: { title, body },
      data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
      tokens: Array.isArray(tokens) ? tokens : [tokens]
    };

    try {
      const response = await admin.messaging().sendMulticast(message);
      if (response.failureCount > 0) {
        const failedTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) failedTokens.push(message.tokens[idx]);
        });
        logger.warn(`Push failure count: ${response.failureCount}. Failed tokens: ${failedTokens}`);
      }
      return true;
    } catch (error) {
      logger.error(`FCM Send Error: ${error.message}`);
      return false;
    }
  }

  static async sendToUser(userId, title, body, data = {}) {
    try {
      const user = await User.findById(userId).select('fcmTokens');
      if (!user?.fcmTokens?.length) return false;
      return await this.sendPushNotification(user.fcmTokens, title, body, data);
    } catch (e) {
      logger.error(`PushToUser Error: ${e.message}`);
      return false;
    }
  }

  static async sendToShop(shopId, title, body, data = {}) {
    try {
      const shop = await Shop.findById(shopId).select('fcmTokens');
      if (!shop?.fcmTokens?.length) return false;
      return await this.sendPushNotification(shop.fcmTokens, title, body, data);
    } catch (e) {
      logger.error(`PushToShop Error: ${e.message}`);
      return false;
    }
  }

  static async sendToProvider(providerId, title, body, data = {}) {
    try {
      const provider = await ServiceProvider.findById(providerId).select('fcmTokens');
      if (!provider?.fcmTokens?.length) return false;
      return await this.sendPushNotification(provider.fcmTokens, title, body, data);
    } catch (e) {
      logger.error(`PushToProvider Error: ${e.message}`);
      return false;
    }
  }

  static async sendBulkNotification(userIds, title, body, data = {}) {
    try {
      const users = await User.find({ _id: { $in: userIds } }).select('fcmTokens');
      const allTokens = users.flatMap(u => u.fcmTokens || []);
      if (!allTokens.length) return false;
      return await this.sendPushNotification(allTokens, title, body, data);
    } catch (e) {
      logger.error(`PushBulk Error: ${e.message}`);
      return false;
    }
  }
}

module.exports = PushNotificationService;