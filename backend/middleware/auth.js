const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Session = require('../models/Session');
const { hashToken } = require('../config/security');

const protect = async (req, res, next) => {
  const bearerToken = req.headers.authorization?.split(' ')[1];
  const token = req.cookies?.access_token || bearerToken;
  if (!token) return res.status(401).json({ success: false, message: 'Access denied. No token.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'access' || !decoded.sid) throw new Error('Invalid token type');
    const session = await Session.findOne({
      _id: decoded.sid,
      user: decoded.id,
      type: 'access',
      tokenHash: hashToken(token),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).select('+tokenHash +webauthnChallenge');
    if (!session) return res.status(401).json({ success: false, message: 'Session expired or revoked.' });

    req.user = await User.findById(decoded.id).select('-password -otpHash');
    if (!req.user) return res.status(401).json({ success: false, message: 'User not found.' });
    req.session = session;
    Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role))
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions.' });
    next();
  };

module.exports = { protect, requireRole };
