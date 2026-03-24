const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  actor: {
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    model: { type: String, enum: ['User', 'ServiceProvider', 'Shop', 'Admin', 'System'], required: true },
    name: String
  },
  action: {
    type: String,
    required: true,
    index: true
  },
  resource: {
    id: { type: mongoose.Schema.Types.ObjectId },
    model: { type: String, required: true },
    identifier: String // e.g. bookingId, orderId
  },
  changes: {
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed
  },
  metadata: {
    ip: String,
    userAgent: String,
    platform: String,
    path: String,
    method: String,
    statusCode: Number
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'low'
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: false,
  versionKey: false
});

// Index for common queries
AuditLogSchema.index({ 'resource.id': 1, timestamp: -1 });
AuditLogSchema.index({ 'actor.id': 1, timestamp: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
