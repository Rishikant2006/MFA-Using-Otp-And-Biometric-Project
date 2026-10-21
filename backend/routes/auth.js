const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, param, validationResult } = require('express-validator');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const User = require('../models/User');
const Session = require('../models/Session');
const WebAuthnCredential = require('../models/WebAuthnCredential');
const { protect } = require('../middleware/auth');
const { requireMfaSession } = require('../middleware/mfaSession');
const {
  generateOTP,
  sendOTPEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendSecurityAlertEmail,
} = require('../utils/mailer');
const { recordAudit, getClientMeta } = require('../utils/audit');
const {
  cookieBase,
  isAllowedFrontendOrigin,
  primaryOrigin,
  publicFrontendOrigin,
  hashToken,
  rpID,
} = require('../config/security');
const { deviceNameFromUserAgent } = require('../utils/device');

const router = express.Router();
const MFA_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const OTP_TTL_MS = (Number.parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 5) * 60 * 1000;
const OTP_MAX_ATTEMPTS = 3;
const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
const educationEmailRule = (field = 'email') =>
  body(field)
    .trim()
    .isEmail()
    .withMessage('Email is not valid.')
    .bail()
    .normalizeEmail()
    .matches(/^[^@\s]+@iilm\.edu$/i)
    .withMessage('Use your @iilm.edu education email address.');

const validate = (rules) => [
  ...rules,
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({
        success: false,
        message: 'Please correct the highlighted fields.',
        errors: errors.array().map((error) => ({ field: error.path, message: error.msg })),
      });
    next();
  },
];

const passwordRule = body('password')
  .isString()
  .isLength({ min: 12, max: 128 })
  .matches(/[a-z]/)
  .matches(/[A-Z]/)
  .matches(/[0-9]/)
  .matches(/[^A-Za-z0-9]/)
  .withMessage('Password does not meet the security policy.');

const safeUser = (user) => ({
  id: user._id,
  studentId: user.studentId,
  fullName: user.fullName,
  email: user.email,
  department: user.department,
  semester: user.semester,
  role: user.role,
  biometricEnabled: user.biometricEnabled,
  profileImage: user.profileImage,
  lastLogin: user.lastLogin,
  isVerified: user.isVerified,
});

const signSessionToken = (userId, sessionId, type, expiresIn) =>
  jwt.sign({ id: userId.toString(), sid: sessionId.toString(), type }, process.env.JWT_SECRET, { expiresIn });

const createSession = async (req, user, type, stage, ttlMs) => {
  const { ipHash, userAgent } = getClientMeta(req);
  const session = new Session({
    user: user._id,
    tokenHash: 'pending',
    type,
    stage,
    expiresAt: new Date(Date.now() + ttlMs),
    ipHash,
    userAgent,
    deviceName: deviceNameFromUserAgent(userAgent),
  });
  const token = signSessionToken(user._id, session._id, type, `${Math.floor(ttlMs / 1000)}s`);
  session.tokenHash = hashToken(token);
  await session.save();
  return { session, token };
};

const clearMfaCookie = (res) => res.clearCookie('mfa_token', cookieBase);
const clearAccessCookie = (res) => res.clearCookie('access_token', cookieBase);

const makeRecoveryCode = () => {
  const raw = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
};
const normalizeRecoveryCode = (value = '') =>
  String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const revokeMfaSession = async (res, session) => {
  if (session) await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });
  clearMfaCookie(res);
};

const createAccessResponse = async (req, res, user, mfaSession = null) => {
  const { session, token } = await createSession(req, user, 'access', 'complete', ACCESS_TTL_MS);
  const { ipHash, userAgent } = getClientMeta(req);
  const suspicious = Boolean(user.lastLoginIpHash && user.lastLoginIpHash !== ipHash);
  user.lastLogin = new Date();
  user.lastLoginIpHash = ipHash;
  user.lastLoginUserAgent = userAgent;
  user.mfaStep = 'complete';
  await user.save();
  if (mfaSession) await revokeMfaSession(res, mfaSession);
  res.cookie('access_token', token, { ...cookieBase, maxAge: ACCESS_TTL_MS });
  await recordAudit(req, {
    user: user._id,
    event: 'LOGIN_SUCCESS',
    outcome: 'success',
    details: { suspicious },
  });
  if (suspicious) {
    await recordAudit(req, { user: user._id, event: 'SUSPICIOUS_NEW_DEVICE', outcome: 'info' });
    sendSecurityAlertEmail(user.email, user.fullName, {
      title: 'New device signed in',
      message: `A new ${session.deviceName} signed in to your account.`,
    }).catch(() => {});
  }
  return res.json({
    success: true,
    message: 'Authentication complete.',
    user: safeUser(user),
    sessionId: session._id,
    suspicious,
  });
};

const sendAndStoreOtp = async (req, user) => {
  const otp = generateOTP();
  user.otpHash = await bcrypt.hash(otp, 12);
  user.otpExpiry = new Date(Date.now() + OTP_TTL_MS);
  user.otpAttempts = 0;
  user.mfaStep = 'otp_pending';
  await user.save();
  try {
    await sendOTPEmail(user.email, otp, user.fullName);
    await recordAudit(req, { user: user._id, event: 'OTP_GENERATED', outcome: 'success' });
  } catch (error) {
    user.otpHash = null;
    user.otpExpiry = null;
    await user.save();
    await recordAudit(req, {
      user: user._id,
      event: 'OTP_DELIVERY_FAILED',
      outcome: 'failure',
      details: { reason: error.message === 'EMAIL_NOT_CONFIGURED' ? 'not_configured' : 'delivery_error' },
    });
    throw error;
  }
};

router.post('/register', (_req, res) =>
  res.status(403).json({
    success: false,
    message: 'Student accounts can only be created by an administrator.',
  }),
);

router.post('/email-verify/send', protect, async (req, res) => {
  try {
    if (req.user.isVerified)
      return res.status(400).json({ success: false, message: 'Email is already verified.' });
    const token = jwt.sign({ id: req.user._id.toString(), type: 'email_verify' }, process.env.JWT_SECRET, {
      expiresIn: '24h',
    });
    const requestOrigin = isAllowedFrontendOrigin(req.get('origin'))
      ? req.get('origin')
      : publicFrontendOrigin || primaryOrigin;
    const verifyUrl = new URL('/', requestOrigin);
    verifyUrl.searchParams.set('verifyToken', token);
    await sendVerificationEmail(req.user.email, verifyUrl.toString(), req.user.fullName);
    return res.json({ success: true, message: 'Verification email sent.' });
  } catch {
    return res.status(503).json({ success: false, message: 'Could not send verification email.' });
  }
});

router.post(
  '/email-verify/confirm',
  validate([body('token').isString().isLength({ min: 32, max: 512 })]),
  async (req, res) => {
    let payload;
    try {
      payload = jwt.verify(req.body.token, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({ success: false, message: 'Verification link is invalid or expired.' });
    }
    if (payload.type !== 'email_verify')
      return res.status(400).json({ success: false, message: 'Invalid verification link.' });
    const user = await User.findById(payload.id);
    if (!user) return res.status(400).json({ success: false, message: 'User not found.' });
    user.isVerified = true;
    await user.save();
    await recordAudit(req, { user: user._id, event: 'EMAIL_VERIFIED', outcome: 'success' });
    return res.json({ success: true, message: 'Email verified successfully.' });
  },
);

router.post(
  '/login',
  validate([
    body('studentId').trim().isLength({ min: 4, max: 32 }),
    body('password').isString().isLength({ min: 1, max: 128 }),
  ]),
  async (req, res) => {
    try {
      const studentId = req.body.studentId.trim().toUpperCase();
      const user = await User.findOne({ studentId }).select('+otpHash');
      const invalid = () => res.status(401).json({ success: false, message: 'Invalid credentials.' });
      if (user?.role === 'student' && !user.adminCreated) return invalid();
      if (!user) {
        await recordAudit(req, {
          event: 'LOGIN_FAILURE',
          outcome: 'failure',
          details: { reason: 'invalid_credentials' },
        });
        return invalid();
      }
      if (user.isLocked()) {
        await recordAudit(req, { user: user._id, event: 'LOCKED_ACCOUNT_LOGIN', outcome: 'failure' });
        return res.status(423).json({
          success: false,
          message: 'This account is temporarily locked. Contact support or try later.',
        });
      }
      if (!(await user.comparePassword(req.body.password))) {
        user.loginAttempts += 1;
        if (user.loginAttempts >= 5) {
          user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
          user.loginAttempts = 0;
          await recordAudit(req, { user: user._id, event: 'ACCOUNT_LOCKED', outcome: 'info' });
        }
        await user.save();
        await recordAudit(req, {
          user: user._id,
          event: 'LOGIN_FAILURE',
          outcome: 'failure',
          details: { reason: 'invalid_credentials' },
        });
        return invalid();
      }

      user.loginAttempts = 0;
      user.lockUntil = null;
      try {
        await sendAndStoreOtp(req, user);
      } catch {
        return res.status(503).json({
          success: false,
          message: 'We could not deliver a verification code. Please try again later.',
        });
      }
      const { token } = await createSession(req, user, 'mfa', 'otp_pending', MFA_TTL_MS);
      res.cookie('mfa_token', token, { ...cookieBase, maxAge: MFA_TTL_MS });
      return res.json({
        success: true,
        nextStep: 'otp',
        message: 'A verification code was sent to your registered email.',
      });
    } catch {
      return res.status(500).json({ success: false, message: 'Unable to start authentication.' });
    }
  },
);

const verifyOtpRequest = async (req, res) => {
  const { user, mfaSession } = req;
  try {
    if (
      mfaSession.stage !== 'otp_pending' ||
      !user.otpHash ||
      !user.otpExpiry ||
      user.otpExpiry <= new Date()
    ) {
      user.otpHash = null;
      user.otpExpiry = null;
      user.otpAttempts = 0;
      user.mfaStep = 'none';
      await user.save();
      await revokeMfaSession(res, mfaSession);
      await recordAudit(req, { user: user._id, event: 'OTP_EXPIRED', outcome: 'failure' });
      return res
        .status(400)
        .json({ success: false, message: 'The verification code has expired. Sign in again.' });
    }
    const validOtp = await bcrypt.compare(req.body.otp.trim(), user.otpHash);
    if (!validOtp) {
      user.otpAttempts += 1;
      const attemptsLeft = OTP_MAX_ATTEMPTS - user.otpAttempts;
      await recordAudit(req, {
        user: user._id,
        event: 'OTP_VERIFICATION_FAILURE',
        outcome: 'failure',
        details: { attemptsLeft: Math.max(0, attemptsLeft) },
      });
      if (user.otpAttempts >= OTP_MAX_ATTEMPTS) {
        user.otpHash = null;
        user.otpExpiry = null;
        user.otpAttempts = 0;
        user.mfaStep = 'none';
        await user.save();
        await revokeMfaSession(res, mfaSession);
        return res.status(429).json({ success: false, message: 'Too many invalid codes. Sign in again.' });
      }
      await user.save();
      return res.status(400).json({
        success: false,
        message: `Invalid verification code. ${attemptsLeft} attempt(s) remaining.`,
      });
    }

    user.otpHash = null;
    user.otpExpiry = null;
    user.otpAttempts = 0;
    await recordAudit(req, { user: user._id, event: 'OTP_VERIFICATION_SUCCESS', outcome: 'success' });
    const credentialCount = await WebAuthnCredential.countDocuments({ user: user._id });
    if (credentialCount) {
      user.mfaStep = 'biometric_pending';
      await user.save();
      mfaSession.stage = 'webauthn_pending';
      await mfaSession.save();
      return res.json({
        success: true,
        nextStep: 'webauthn',
        message: 'Code verified. Complete passkey authentication.',
      });
    }
    return createAccessResponse(req, res, user, mfaSession);
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to verify the code.' });
  }
};

const sendOtpRequest = async (req, res) => {
  try {
    if (req.mfaSession.stage !== 'otp_pending')
      return res
        .status(409)
        .json({ success: false, message: 'This authentication step is no longer active.' });
    await sendAndStoreOtp(req, req.user);
    return res.json({ success: true, message: 'A new verification code was sent.' });
  } catch {
    return res
      .status(503)
      .json({ success: false, message: 'We could not deliver a verification code. Please try again later.' });
  }
};

router.post(
  '/otp/verify',
  requireMfaSession,
  validate([
    body('otp')
      .trim()
      .matches(/^\d{6}$/),
  ]),
  verifyOtpRequest,
);

router.post(
  '/verify-otp',
  requireMfaSession,
  validate([
    body('otp')
      .trim()
      .matches(/^\d{6}$/),
  ]),
  verifyOtpRequest,
);

router.post('/otp/send', requireMfaSession, sendOtpRequest);
router.post('/resend-otp', requireMfaSession, sendOtpRequest);

router.post('/webauthn/register/options', protect, async (req, res) => {
  try {
    const credentials = await WebAuthnCredential.find({ user: req.user._id }).select(
      'credentialID transports',
    );
    const options = await generateRegistrationOptions({
      rpName: process.env.WEBAUTHN_RP_NAME || 'University Portal',
      rpID,
      userName: req.user.email,
      userDisplayName: req.user.fullName,
      userID: new TextEncoder().encode(req.user._id.toString()),
      attestationType: 'none',
      excludeCredentials: credentials.map((credential) => ({
        id: credential.credentialID,
        transports: credential.transports,
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    });
    req.session.webauthnChallenge = options.challenge;
    await req.session.save();
    return res.json({ success: true, options });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to prepare passkey enrollment.' });
  }
});

router.post(
  '/webauthn/register/verify',
  protect,
  validate([body('response').isObject()]),
  async (req, res) => {
    try {
      const expectedChallenge = req.session.webauthnChallenge;
      if (!expectedChallenge)
        return res
          .status(400)
          .json({ success: false, message: 'Passkey request expired. Start enrollment again.' });
      const verification = await verifyRegistrationResponse({
        response: req.body.response,
        expectedChallenge,
        expectedOrigin: primaryOrigin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      req.session.webauthnChallenge = null;
      await req.session.save();
      if (!verification.verified || !verification.registrationInfo) {
        await recordAudit(req, {
          user: req.user._id,
          event: 'WEBAUTHN_ENROLLMENT_FAILURE',
          outcome: 'failure',
        });
        return res.status(400).json({ success: false, message: 'Passkey enrollment could not be verified.' });
      }
      const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo;
      await WebAuthnCredential.create({
        user: req.user._id,
        credentialID: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports || req.body.response.response.transports || [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        aaguid,
      });
      req.user.biometricEnabled = true;
      await req.user.save();
      await recordAudit(req, { user: req.user._id, event: 'WEBAUTHN_ENROLLED', outcome: 'success' });
      return res.json({ success: true, message: 'Passkey enrolled successfully.' });
    } catch {
      await recordAudit(req, {
        user: req.user?._id,
        event: 'WEBAUTHN_ENROLLMENT_FAILURE',
        outcome: 'failure',
      });
      return res.status(400).json({ success: false, message: 'Passkey enrollment could not be verified.' });
    }
  },
);

router.post('/webauthn/login/options', requireMfaSession, async (req, res) => {
  try {
    if (req.mfaSession.stage !== 'webauthn_pending')
      return res.status(409).json({ success: false, message: 'Verify your email code first.' });
    const credentials = await WebAuthnCredential.find({ user: req.user._id }).select(
      'credentialID transports',
    );
    if (!credentials.length)
      return res.status(400).json({ success: false, message: 'No passkey is enrolled for this account.' });
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialID,
        transports: credential.transports,
      })),
      userVerification: 'required',
    });
    req.mfaSession.webauthnChallenge = options.challenge;
    await req.mfaSession.save();
    return res.json({ success: true, options });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to prepare passkey authentication.' });
  }
});

router.post(
  '/webauthn/login/verify',
  requireMfaSession,
  validate([body('response').isObject()]),
  async (req, res) => {
    const { user, mfaSession } = req;
    try {
      if (mfaSession.stage !== 'webauthn_pending' || !mfaSession.webauthnChallenge)
        return res
          .status(400)
          .json({ success: false, message: 'Passkey request expired. Start authentication again.' });
      const credential = await WebAuthnCredential.findOne({
        user: user._id,
        credentialID: req.body.response.id,
      }).select('+publicKey');
      if (!credential) {
        await recordAudit(req, {
          user: user._id,
          event: 'WEBAUTHN_AUTHENTICATION_FAILURE',
          outcome: 'failure',
          details: { reason: 'unknown_credential' },
        });
        return res.status(401).json({ success: false, message: 'Passkey authentication failed.' });
      }
      const verification = await verifyAuthenticationResponse({
        response: req.body.response,
        expectedChallenge: mfaSession.webauthnChallenge,
        expectedOrigin: primaryOrigin,
        expectedRPID: rpID,
        credential: {
          id: credential.credentialID,
          publicKey: new Uint8Array(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports,
        },
        requireUserVerification: true,
      });
      mfaSession.webauthnChallenge = null;
      await mfaSession.save();
      if (!verification.verified) {
        await recordAudit(req, {
          user: user._id,
          event: 'WEBAUTHN_AUTHENTICATION_FAILURE',
          outcome: 'failure',
        });
        return res.status(401).json({ success: false, message: 'Passkey authentication failed.' });
      }
      credential.counter = verification.authenticationInfo.newCounter;
      credential.lastUsedAt = new Date();
      credential.backedUp = verification.authenticationInfo.credentialBackedUp;
      await credential.save();
      await recordAudit(req, {
        user: user._id,
        event: 'WEBAUTHN_AUTHENTICATION_SUCCESS',
        outcome: 'success',
      });
      return createAccessResponse(req, res, user, mfaSession);
    } catch {
      await recordAudit(req, {
        user: user?._id,
        event: 'WEBAUTHN_AUTHENTICATION_FAILURE',
        outcome: 'failure',
      });
      return res.status(401).json({ success: false, message: 'Passkey authentication failed.' });
    }
  },
);

router.get('/me', protect, async (req, res) => {
  const credentialCount = await WebAuthnCredential.countDocuments({ user: req.user._id });
  return res.json({ success: true, user: { ...safeUser(req.user), biometricEnabled: credentialCount > 0 } });
});

router.get('/sessions', protect, async (req, res) => {
  const sessions = await Session.find({
    user: req.user._id,
    type: 'access',
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .select('createdAt lastSeenAt expiresAt userAgent deviceName')
    .sort({ lastSeenAt: -1 })
    .lean();
  return res.json({
    success: true,
    sessions: sessions.map((session) => ({
      id: session._id,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      device: session.deviceName || session.userAgent || 'Unknown device',
      current: session._id.toString() === req.session._id.toString(),
    })),
  });
});

router.delete('/sessions/:id', protect, validate([param('id').isMongoId()]), async (req, res) => {
  const result = await Session.updateOne(
    { _id: req.params.id, user: req.user._id, type: 'access', revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  if (!result.modifiedCount)
    return res.status(404).json({ success: false, message: 'Active session not found.' });
  await recordAudit(req, {
    user: req.user._id,
    event: 'SESSION_REVOKED',
    outcome: 'success',
    details: { self: req.params.id === req.session._id.toString() },
  });
  if (req.params.id === req.session._id.toString()) clearAccessCookie(res);
  return res.json({ success: true, message: 'Session signed out.' });
});

router.delete('/sessions', protect, async (req, res) => {
  const result = await Session.updateMany(
    {
      user: req.user._id,
      type: 'access',
      _id: { $ne: req.session._id },
      revokedAt: null,
    },
    { $set: { revokedAt: new Date() } },
  );
  await recordAudit(req, {
    user: req.user._id,
    event: 'ALL_OTHER_SESSIONS_REVOKED',
    outcome: 'success',
    details: { count: result.modifiedCount },
  });
  return res.json({ success: true, message: `${result.modifiedCount} other session(s) signed out.` });
});

router.get('/recovery-codes/status', protect, async (req, res) => {
  const user = await User.findById(req.user._id).select('+recoveryCodeHashes');
  return res.json({
    success: true,
    remaining: user?.recoveryCodeHashes?.length || 0,
    generatedAt: user?.recoveryCodesGeneratedAt || null,
  });
});

router.post('/recovery-codes/generate', protect, async (req, res) => {
  const codes = Array.from({ length: 8 }, makeRecoveryCode);
  const user = await User.findById(req.user._id).select('+recoveryCodeHashes');
  user.recoveryCodeHashes = await Promise.all(
    codes.map((code) => bcrypt.hash(normalizeRecoveryCode(code), 12)),
  );
  user.recoveryCodesGeneratedAt = new Date();
  await user.save();
  await recordAudit(req, { user: user._id, event: 'RECOVERY_CODES_GENERATED', outcome: 'success' });
  return res.json({
    success: true,
    message: 'Save these recovery codes somewhere secure. They will not be shown again.',
    codes,
  });
});

router.post(
  '/recovery-codes/verify',
  requireMfaSession,
  validate([body('code').isString().isLength({ min: 8, max: 32 })]),
  async (req, res) => {
    const { user, mfaSession } = req;
    if (mfaSession.stage !== 'webauthn_pending') {
      return res.status(409).json({ success: false, message: 'Verify your email code first.' });
    }
    const recoveryUser = await User.findById(user._id).select('+recoveryCodeHashes');
    const normalizedCode = normalizeRecoveryCode(req.body.code);
    let matchedIndex = -1;
    for (let index = 0; index < recoveryUser.recoveryCodeHashes.length; index += 1) {
      if (await bcrypt.compare(normalizedCode, recoveryUser.recoveryCodeHashes[index])) {
        matchedIndex = index;
        break;
      }
    }
    if (matchedIndex < 0) {
      await recordAudit(req, { user: user._id, event: 'RECOVERY_CODE_FAILURE', outcome: 'failure' });
      return res
        .status(401)
        .json({ success: false, message: 'That recovery code is invalid or has already been used.' });
    }
    recoveryUser.recoveryCodeHashes.splice(matchedIndex, 1);
    await recoveryUser.save();
    await recordAudit(req, {
      user: user._id,
      event: 'RECOVERY_CODE_USED',
      outcome: 'success',
      details: { remaining: recoveryUser.recoveryCodeHashes.length },
    });
    return createAccessResponse(req, res, recoveryUser, mfaSession);
  },
);

router.post('/logout', protect, async (req, res) => {
  await Session.updateOne({ _id: req.session._id }, { $set: { revokedAt: new Date() } });
  clearAccessCookie(res);
  await recordAudit(req, { user: req.user._id, event: 'LOGOUT', outcome: 'success' });
  return res.json({ success: true, message: 'Signed out successfully.' });
});

router.post('/biometric/disable', protect, async (req, res) => {
  try {
    await WebAuthnCredential.deleteMany({ user: req.user._id });
    req.user.biometricEnabled = false;
    await req.user.save();
    await recordAudit(req, { user: req.user._id, event: 'WEBAUTHN_DISABLED', outcome: 'success' });
    return res.json({ success: true, message: 'Biometric authentication disabled.' });
  } catch {
    return res.status(500).json({ success: false, message: 'Could not disable biometric authentication.' });
  }
});

router.post('/password-reset/request', validate([educationEmailRule()]), async (req, res) => {
  const student = await User.findOne({
    email: req.body.email.toLowerCase(),
    role: 'student',
    adminCreated: true,
  });
  const genericMessage =
    'If that student account exists, a password reset link has been sent to its registered email.';
  if (!student) return res.json({ success: true, message: genericMessage });
  const token = jwt.sign({ id: student._id.toString(), type: 'password_reset' }, process.env.JWT_SECRET, {
    expiresIn: `${Math.floor(PASSWORD_RESET_TTL_MS / 1000)}s`,
  });
  const requestOrigin = isAllowedFrontendOrigin(req.get('origin'))
    ? req.get('origin')
    : publicFrontendOrigin || primaryOrigin;
  const resetUrl = new URL('/', requestOrigin);
  resetUrl.searchParams.set('resetToken', token);
  try {
    await sendPasswordResetEmail(student.email, resetUrl.toString(), student.fullName);
    await recordAudit(req, { user: student._id, event: 'PASSWORD_RESET_REQUESTED', outcome: 'success' });
  } catch {
    await recordAudit(req, {
      user: student._id,
      event: 'PASSWORD_RESET_DELIVERY_FAILED',
      outcome: 'failure',
    });
    return res.status(503).json({
      success: false,
      message: 'We could not send the reset link. Check the mail configuration and try again.',
    });
  }
  return res.json({ success: true, message: genericMessage });
});

router.post(
  '/password-reset/confirm',
  validate([body('token').isString().isLength({ min: 32, max: 256 }), passwordRule]),
  async (req, res) => {
    let payload;
    try {
      payload = jwt.verify(req.body.token, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({ success: false, message: 'The reset link is invalid or expired.' });
    }
    if (payload.type !== 'password_reset')
      return res.status(400).json({ success: false, message: 'The reset link is invalid or expired.' });
    const user = await User.findById(payload.id);
    if (!user || (user.passwordChangedAt && user.passwordChangedAt.getTime() >= payload.iat * 1000)) {
      return res.status(400).json({ success: false, message: 'The reset link is invalid or expired.' });
    }
    user.password = req.body.password;
    user.passwordChangedAt = new Date();
    user.loginAttempts = 0;
    user.lockUntil = null;
    await user.save();
    await Session.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await recordAudit(req, { user: user._id, event: 'PASSWORD_RESET_COMPLETED', outcome: 'success' });
    sendSecurityAlertEmail(user.email, user.fullName, {
      title: 'Password changed',
      message: 'Your password was reset and all active sessions were signed out.',
    }).catch(() => {});
    return res.json({ success: true, message: 'Password updated. Please sign in.' });
  },
);

// Compatibility aliases for older endpoint names used in older docs and clients.
router.post(
  '/biometric/verify',
  requireMfaSession,
  validate([body('response').isObject()]),
  async (req, res) => {
    const { user, mfaSession } = req;
    try {
      if (mfaSession.stage !== 'webauthn_pending' || !mfaSession.webauthnChallenge)
        return res
          .status(400)
          .json({ success: false, message: 'Passkey request expired. Start authentication again.' });
      const credential = await WebAuthnCredential.findOne({
        user: user._id,
        credentialID: req.body.response.id,
      }).select('+publicKey');
      if (!credential) {
        await recordAudit(req, {
          user: user._id,
          event: 'WEBAUTHN_AUTHENTICATION_FAILURE',
          outcome: 'failure',
          details: { reason: 'unknown_credential' },
        });
        return res.status(401).json({ success: false, message: 'Passkey authentication failed.' });
      }
      const verification = await verifyAuthenticationResponse({
        response: req.body.response,
        expectedChallenge: mfaSession.webauthnChallenge,
        expectedOrigin: primaryOrigin,
        expectedRPID: rpID,
        credential: {
          id: credential.credentialID,
          publicKey: new Uint8Array(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports,
        },
        requireUserVerification: true,
      });
      mfaSession.webauthnChallenge = null;
      await mfaSession.save();
      if (!verification.verified) {
        await recordAudit(req, {
          user: user._id,
          event: 'WEBAUTHN_AUTHENTICATION_FAILURE',
          outcome: 'failure',
        });
        return res.status(401).json({ success: false, message: 'Passkey authentication failed.' });
      }
      credential.counter = verification.authenticationInfo.newCounter;
      credential.lastUsedAt = new Date();
      credential.backedUp = verification.authenticationInfo.credentialBackedUp;
      await credential.save();
      await recordAudit(req, {
        user: user._id,
        event: 'WEBAUTHN_AUTHENTICATION_SUCCESS',
        outcome: 'success',
      });
      return createAccessResponse(req, res, user, mfaSession);
    } catch {
      await recordAudit(req, {
        user: user?._id,
        event: 'WEBAUTHN_AUTHENTICATION_FAILURE',
        outcome: 'failure',
      });
      return res.status(401).json({ success: false, message: 'Passkey authentication failed.' });
    }
  },
);

module.exports = router;
