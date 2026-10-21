const AuditLog = require('../models/AuditLog');
const { hashIp } = require('../config/security');

const getClientMeta = (req) => ({
  ipHash: hashIp(req.ip || req.socket?.remoteAddress || ''),
  userAgent: String(req.get('user-agent') || '').slice(0, 255),
});

// Audit failures must never disrupt authentication. Do not put credentials, OTPs, or tokens in details.
const recordAudit = async (req, { user = null, event, outcome = 'info', details = {} }) => {
  try {
    await AuditLog.create({ user, event, outcome, ...getClientMeta(req), details });
  } catch {
    // Deliberately silent: emitting security data to a console can leak sensitive context.
  }
};

module.exports = { getClientMeta, recordAudit };
