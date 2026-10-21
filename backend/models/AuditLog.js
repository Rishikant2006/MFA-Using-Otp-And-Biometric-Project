const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    event: { type: String, required: true, index: true },
    outcome: { type: String, enum: ['success', 'failure', 'info'], required: true, index: true },
    ipHash: { type: String, default: null, index: true },
    userAgent: { type: String, default: '' },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ event: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
