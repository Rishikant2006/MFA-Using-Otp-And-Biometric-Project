const jwt = require('jsonwebtoken');
const Session = require('../models/Session');
const User = require('../models/User');
const { hashToken } = require('../config/security');

const requireMfaSession = async (req, res, next) => {
  const token = req.cookies?.mfa_token;
  if (!token) return res.status(401).json({ success: false, message: 'MFA session expired. Sign in again.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'mfa' || !decoded.sid) throw new Error('Invalid MFA token');
    const session = await Session.findOne({
      _id: decoded.sid,
      user: decoded.id,
      type: 'mfa',
      tokenHash: hashToken(token),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).select('+tokenHash +webauthnChallenge');
    if (!session) throw new Error('Session not found');
    const user = await User.findById(decoded.id).select('+otpHash');
    if (!user) throw new Error('User not found');
    req.mfaToken = token;
    req.mfaSession = session;
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'MFA session expired. Sign in again.' });
  }
};

module.exports = { requireMfaSession };
