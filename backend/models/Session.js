const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    type: { type: String, enum: ['mfa', 'access'], required: true, index: true },
    stage: { type: String, enum: ['otp_pending', 'webauthn_pending', 'complete'], default: 'otp_pending' },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null, index: true },
    lastSeenAt: { type: Date, default: Date.now },
    ipHash: { type: String, required: true },
    userAgent: { type: String, default: '' },
    deviceName: { type: String, default: 'Unknown device', maxlength: 80 },
    webauthnChallenge: { type: String, default: null, select: false },
  },
  { timestamps: true },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ user: 1, revokedAt: 1, expiresAt: 1 });

module.exports = mongoose.model('Session', sessionSchema);
