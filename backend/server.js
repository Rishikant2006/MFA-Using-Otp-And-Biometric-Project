require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const portalRoutes = require('./routes/portal');
const adminRoutes = require('./routes/admin');
const User = require('./models/User');
const { frontendOrigins, isAllowedFrontendOrigin, isProduction, requestId } = require('./config/security');
const { issueCsrfToken, requireCsrf } = require('./middleware/csrf');
const { log } = require('./utils/logger');

const app = express();

app.disable('x-powered-by');
app.use((req, res, next) => {
  req.requestId = requestId();
  res.setHeader('X-Request-Id', req.requestId);
  const startedAt = Date.now();
  res.on('finish', () =>
    log('info', 'http_request', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    }),
  );
  next();
});

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be a unique value with at least 32 characters.');
}
if (isProduction) app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", ...frontendOrigins],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
        fontSrc: ["'self'", 'data:', 'https://cdnjs.cloudflare.com'],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: isProduction ? undefined : false,
  }),
);

app.use(
  cors({
    origin(origin, callback) {
      // API tools without an Origin header are allowed; browsers must be explicitly allowlisted.
      if (isAllowedFrontendOrigin(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS.'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Authorization'],
  }),
);
app.use(compression());
app.use(express.json({ limit: '20kb', type: 'application/json' }));
app.use(cookieParser());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts. Please try again later.' },
});

app.use('/api', limiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/otp/verify', authLimiter);
app.use('/api/auth/password-reset', authLimiter);

app.get('/api/auth/csrf', (req, res) => res.json({ success: true, csrfToken: issueCsrfToken(req, res) }));
app.use('/api', requireCsrf);

app.use('/api/auth', authRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (_req, res) =>
  res.json({
    success: true,
    message: 'University MFA Portal API running.',
    timestamp: new Date().toISOString(),
  }),
);
app.get('/api/ready', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  return res.status(ready ? 200 : 503).json({
    success: ready,
    database: ready ? 'connected' : 'unavailable',
  });
});

const path = require('path');
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.get('*', (req, res, next) => { if (req.path.startsWith('/api')) return next(); res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')); });
app.use((_req, res) => res.status(404).json({ success: false, message: 'Route not found.' }));

app.use((err, req, res, _next) => {
  // The client gets no stack trace or database/internal error details.
  if (err.message === 'Origin is not allowed by CORS.')
    return res.status(403).json({ success: false, message: 'Origin is not allowed.' });
  log('error', 'unhandled_request_error', {
    requestId: req.requestId,
    path: req.path,
    error: err.name || 'Error',
  });
  return res
    .status(500)
    .json({ success: false, message: 'An unexpected server error occurred.', requestId: req.requestId });
});

const seedDemoAccounts = async () => {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER || 'admin@iilm.edu';
  await User.deleteMany({ studentId: { $in: ['STU2024001', 'FAC2024001'] }, adminCreated: { $ne: true } });
  const demoAccounts = [
    {
      studentId: 'ADM2024001',
      fullName: 'Admin User',
      email: adminEmail,
      password: 'Admin@12345!',
      department: 'Administration',
      semester: 1,
      role: 'admin',
    },
    {
      studentId: 'SEC2024001',
      fullName: 'Security Administrator',
      email: 'security@iilm.edu',
      password: 'Security@12345!',
      department: 'Information Security',
      semester: 1,
      role: 'security_admin',
    },
  ];
  for (const account of demoAccounts) {
    const user = await User.findOne({ studentId: account.studentId });
    if (!user) await User.create(account);
    else {
      Object.assign(user, account);
      await user.save();
    }
  }
  log('info', 'demo_users_seeded');
};

const startServer = async () => {
  let mongoUri = process.env.MONGO_URI;
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 3000 });
    log('info', 'database_connected');
  } catch {
    if (isProduction) throw new Error('Production database connection failed.');
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const memoryServer = await MongoMemoryServer.create();
    mongoUri = memoryServer.getUri();
    await mongoose.connect(mongoUri);
    log('info', 'database_memory_fallback');
  }

  // Remove only fields created by the insecure prototype; old credential IDs are not valid WebAuthn credentials.
  await User.updateMany(
    {
      $or: [
        { otp: { $exists: true } },
        { tempToken: { $exists: true } },
        { biometricCredentialId: { $exists: true } },
      ],
    },
    {
      $unset: { otp: '', tempToken: '', biometricCredentialId: '', biometricPublicKey: '' },
      $set: { biometricEnabled: false },
    },
  );
  await seedDemoAccounts();

  const port = Number(process.env.PORT || 5000);
  return app.listen(port, () =>
    log('info', 'server_started', { port, environment: process.env.NODE_ENV || 'development' }),
  );
};

if (require.main === module) {
  startServer().catch(() => {
    // Do not log connection strings or other environment values.
    log('error', 'server_start_failed');
    process.exit(1);
  });
}

module.exports = { app, startServer };
