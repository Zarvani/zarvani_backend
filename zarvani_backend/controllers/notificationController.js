// ============= controllers/notificationController.js =============
const { Notification } = require('../models/Shop');
const User = require('../models/User');
const ServiceProvider = require('../models/ServiceProvider');
const PushNotificationService = require('../services/pushNotification');
const ResponseHandler = require('../utils/responseHandler');

// Get Notifications
exports.getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, isRead } = req.query;
    
    const query = {
      recipient: req.user._id,
      recipientModel: req.userRole === 'user' ? 'User' : 
                     req.userRole === 'provider' ? 'ServiceProvider' : 'Shop'
    };
    
    if (isRead !== undefined) query.isRead = isRead === 'true';
    
    const notifications = await Notification.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
    
    const count = await Notification.countDocuments(query);
    
    ResponseHandler.paginated(res, notifications, page, limit, count);
  } catch (error) {
    logger.error(`Get notifications error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Mark Notification as Read
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    
    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipient: req.user._id },
      { isRead: true, readAt: new Date() },
      { new: true }
    );
    
    if (!notification) {
      return ResponseHandler.error(res, 'Notification not found', 404);
    }
    
    ResponseHandler.success(res, { notification }, 'Notification marked as read');
  } catch (error) {
    logger.error(`Mark notification as read error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Mark All as Read
exports.markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { isRead: true, readAt: new Date() }
    );
    
    ResponseHandler.success(res, null, 'All notifications marked as read');
  } catch (error) {
    logger.error(`Mark all as read error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Delete Notification
exports.deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    
    const notification = await Notification.findOneAndDelete({
      _id: id,
      recipient: req.user._id
    });
    
    if (!notification) {
      return ResponseHandler.error(res, 'Notification not found', 404);
    }
    
    ResponseHandler.success(res, null, 'Notification deleted');
  } catch (error) {
    logger.error(`Delete notification error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Unread Count
exports.getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false
    });
    
    ResponseHandler.success(res, { count }, 'Unread count fetched');
  } catch (error) {
    logger.error(`Get unread count error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};