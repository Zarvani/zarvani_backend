const AuditLog = require('../models/AuditLog');
const logger = require('./logger');

class AuditLogger {
  /**
   * Log a critical action
   */
  static async log(req, { action, resource, changes, severity = 'low' }) {
    try {
      const actorId = req.user?._id || '000000000000000000000000'; // System or Unauth
      const actorModel = req.user?.role ? this._getActorModel(req.user.role) : 'System';

      await AuditLog.create({
        actor: {
          id: actorId,
          model: actorModel,
          name: req.user?.name || 'Unknown'
        },
        action,
        resource,
        changes,
        severity,
        metadata: {
          ip: req.ip || req.connection.remoteAddress,
          userAgent: req.headers['user-agent'],
          platform: req.headers['x-platform'] || 'web',
          path: req.originalUrl,
          method: req.method
        }
      });
    } catch (error) {
      logger.error(`Audit Log Failure: ${error.message}`);
    }
  }

  static _getActorModel(role) {
    const map = {
      'user': 'User',
      'provider': 'ServiceProvider',
      'shop': 'Shop',
      'admin': 'Admin',
      'superadmin': 'Admin'
    };
    return map[role] || 'User';
  }
}

module.exports = AuditLogger;
