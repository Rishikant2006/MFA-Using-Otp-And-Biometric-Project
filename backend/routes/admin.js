const express = require('express');
const jwt = require('jsonwebtoken');
const { query, body, param, validationResult } = require('express-validator');
const User = require('../models/User');
const Session = require('../models/Session');
const AuditLog = require('../models/AuditLog');
const Announcement = require('../models/Announcement');
const Notification = require('../models/Notification');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const { protect, requireRole } = require('../middleware/auth');
const { recordAudit } = require('../utils/audit');
const { sendPasswordResetEmail, sendSecurityAlertEmail } = require('../utils/mailer');
const { isAllowedFrontendOrigin, primaryOrigin, publicFrontendOrigin } = require('../config/security');

const router = express.Router();
const administrators = [protect, requireRole('admin', 'security_admin')];
const PASSWORD_RESET_TTL_SECONDS = 15 * 60;
const educationEmailRule = body('email')
  .trim()
  .isEmail()
  .withMessage('Email is not valid.')
  .bail()
  .normalizeEmail()
  .matches(/^[^@\s]+@iilm\.edu$/i)
  .withMessage('Use your @iilm.edu education email address.');
const passwordRule = body('password')
  .isString()
  .isLength({ min: 12, max: 128 })
  .matches(/[a-z]/)
  .matches(/[A-Z]/)
  .matches(/[0-9]/)
  .matches(/[^A-Za-z0-9]/)
  .withMessage('Password must be 12+ characters with uppercase, lowercase, number, and symbol.');
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
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const safeUser = (user) => ({
  id: user._id,
  studentId: user.studentId,
  fullName: user.fullName,
  email: user.email,
  department: user.department,
  semester: user.semester,
  role: user.role,
  adminCreated: user.adminCreated,
  locked: Boolean(user.lockUntil && user.lockUntil > new Date()),
  lockUntil: user.lockUntil,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
});

router.get(
  '/users',
  ...administrators,
  validate([
    query('page').optional().isInt({ min: 1, max: 100000 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('search').optional().trim().isLength({ max: 80 }),
  ]),
  async (req, res) => {
    const page = req.query.page || 1;
    const limit = req.query.limit || 25;
    const search = req.query.search || '';
    const filter = search
      ? {
          $or: [
            { studentId: { $regex: search, $options: 'i' } },
            { fullName: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
          ],
        }
      : {};
    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select('-password -otpHash -lastLoginIpHash -lastLoginUserAgent')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);
    return res.json({ success: true, page, limit, total, users: users.map(safeUser) });
  },
);

router.post(
  '/students',
  ...administrators,
  validate([
    body('studentId')
      .trim()
      .isLength({ min: 4, max: 32 })
      .matches(/^[A-Za-z0-9-]+$/),
    body('fullName').trim().isLength({ min: 2, max: 100 }),
    educationEmailRule,
    passwordRule,
    body('department').trim().isLength({ min: 2, max: 80 }),
    body('semester').isInt({ min: 1, max: 12 }).toInt(),
  ]),
  async (req, res) => {
    try {
      const { studentId, fullName, email, password, department, semester } = req.body;
      const normalizedId = studentId.trim().toUpperCase();
      const exists = await User.exists({
        $or: [{ email: email.toLowerCase() }, { studentId: normalizedId }],
      });
      if (exists)
        return res
          .status(409)
          .json({ success: false, message: 'An account with that ID or email already exists.' });
      const student = await User.create({
        studentId: normalizedId,
        fullName: fullName.trim(),
        email: email.toLowerCase(),
        password,
        department: department.trim(),
        semester,
        role: 'student',
        adminCreated: true,
      });
      await recordAudit(req, {
        user: req.user._id,
        event: 'ADMIN_STUDENT_REGISTERED',
        outcome: 'success',
        details: { studentId: normalizedId },
      });
      return res
        .status(201)
        .json({ success: true, message: 'Student account created.', user: safeUser(student) });
    } catch {
      return res.status(500).json({
        success: false,
        message: 'Student account could not be created. Check the account details and try again.',
      });
    }
  },
);

router.post(
  '/students/:id/password-reset',
  ...administrators,
  validate([param('id').isMongoId()]),
  async (req, res) => {
    const student = await User.findOne({ _id: req.params.id, role: 'student' });
    if (!student) return res.status(404).json({ success: false, message: 'Student account not found.' });
    const token = jwt.sign({ id: student._id.toString(), type: 'password_reset' }, process.env.JWT_SECRET, {
      expiresIn: `${PASSWORD_RESET_TTL_SECONDS}s`,
    });
    const requestOrigin = isAllowedFrontendOrigin(req.get('origin'))
      ? req.get('origin')
      : publicFrontendOrigin || primaryOrigin;
    const resetUrl = new URL('/', requestOrigin);
    resetUrl.searchParams.set('resetToken', token);
    try {
      await sendPasswordResetEmail(student.email, resetUrl.toString(), student.fullName);
    } catch {
      await recordAudit(req, {
        user: req.user._id,
        event: 'ADMIN_PASSWORD_RESET_DELIVERY_FAILED',
        outcome: 'failure',
        details: { targetUserId: student._id.toString() },
      });
      return res
        .status(503)
        .json({ success: false, message: 'Could not send the reset link to the student.' });
    }
    await recordAudit(req, {
      user: req.user._id,
      event: 'ADMIN_PASSWORD_RESET_REQUESTED',
      outcome: 'success',
      details: { targetUserId: student._id.toString() },
    });
    return res.json({ success: true, message: 'Password reset link sent to the student.' });
  },
);

router.patch(
  '/students/:id/password',
  ...administrators,
  validate([param('id').isMongoId(), passwordRule]),
  async (req, res) => {
    const student = await User.findOne({ _id: req.params.id, role: 'student', adminCreated: true });
    if (!student) return res.status(404).json({ success: false, message: 'Student account not found.' });
    student.password = req.body.password;
    student.passwordChangedAt = new Date();
    student.loginAttempts = 0;
    student.lockUntil = null;
    await student.save();
    await Session.updateMany({ user: student._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await recordAudit(req, {
      user: req.user._id,
      event: 'ADMIN_PASSWORD_CHANGED',
      outcome: 'success',
      details: { targetUserId: student._id.toString() },
    });
    sendSecurityAlertEmail(student.email, student.fullName, {
      title: 'Password changed by an administrator',
      message: 'An administrator changed your password and signed out your active sessions.',
    }).catch(() => {});
    return res.json({
      success: true,
      message: 'Student password changed. All previous sessions were signed out.',
    });
  },
);

router.patch(
  '/users/:id',
  ...administrators,
  validate([param('id').isMongoId(), body('locked').optional().isBoolean().toBoolean()]),
  async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (typeof req.body.locked === 'boolean') {
      user.lockUntil = req.body.locked ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;
      user.loginAttempts = 0;
      await user.save();
      if (req.body.locked)
        await Session.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
      await recordAudit(req, {
        user: req.user._id,
        event: req.body.locked ? 'ADMIN_ACCOUNT_LOCKED' : 'ADMIN_ACCOUNT_UNLOCKED',
        outcome: 'success',
        details: { targetUserId: user._id.toString() },
      });
    }
    return res.json({ success: true, user: safeUser(user) });
  },
);

router.patch(
  '/users/:id/role',
  ...administrators,
  validate([param('id').isMongoId(), body('role').isIn(['student', 'faculty', 'admin', 'security_admin'])]),
  async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'User not found.' });
    const requestedRole = req.body.role;
    if (req.user.role !== 'security_admin' && ['admin', 'security_admin'].includes(requestedRole)) {
      return res
        .status(403)
        .json({ success: false, message: 'Only a security administrator can grant privileged roles.' });
    }
    if (target._id.equals(req.user._id))
      return res.status(400).json({ success: false, message: 'You cannot change your own role.' });
    const previousRole = target.role;
    target.role = requestedRole;
    await target.save();
    await Session.updateMany({ user: target._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await recordAudit(req, {
      user: req.user._id,
      event: 'ROLE_CHANGED',
      outcome: 'success',
      details: { targetUserId: target._id.toString(), previousRole, role: requestedRole },
    });
    return res.json({ success: true, user: safeUser(target) });
  },
);

router.get('/security/overview', ...administrators, async (req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [
    totalUsers,
    activeUsers,
    successfulLogins,
    failedLogins,
    otpFailures,
    webauthnFailures,
    lockedAccounts,
    suspiciousAttempts,
    recentEvents,
  ] = await Promise.all([
    User.countDocuments(),
    Session.distinct('user', { type: 'access', revokedAt: null, expiresAt: { $gt: new Date() } }).then(
      (users) => users.length,
    ),
    AuditLog.countDocuments({ event: 'LOGIN_SUCCESS', createdAt: { $gte: since } }),
    AuditLog.countDocuments({ event: 'LOGIN_FAILURE', createdAt: { $gte: since } }),
    AuditLog.countDocuments({ event: 'OTP_VERIFICATION_FAILURE', createdAt: { $gte: since } }),
    AuditLog.countDocuments({ event: 'WEBAUTHN_AUTHENTICATION_FAILURE', createdAt: { $gte: since } }),
    User.countDocuments({ lockUntil: { $gt: new Date() } }),
    AuditLog.countDocuments({ event: 'SUSPICIOUS_NEW_DEVICE', createdAt: { $gte: since } }),
    AuditLog.find({ createdAt: { $gte: since } })
      .populate('user', 'studentId fullName role')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
  ]);
  return res.json({
    success: true,
    periodDays: 30,
    metrics: {
      totalUsers,
      activeUsers,
      successfulLogins,
      failedLogins,
      otpFailures,
      webauthnFailures,
      lockedAccounts,
      suspiciousAttempts,
    },
    events: recentEvents.map((event) => ({
      id: event._id,
      event: event.event,
      outcome: event.outcome,
      at: event.createdAt,
      user: event.user
        ? {
            id: event.user._id,
            name: event.user.fullName,
            studentId: event.user.studentId,
            role: event.user.role,
          }
        : null,
      details: event.details,
    })),
  });
});

router.get(
  '/security/logs',
  ...administrators,
  validate([
    query('page').optional().isInt({ min: 1, max: 100000 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('event').optional().trim().isLength({ max: 80 }),
    query('outcome').optional().isIn(['success', 'failure', 'info']),
  ]),
  async (req, res) => {
    const page = req.query.page || 1;
    const limit = req.query.limit || 50;
    const filter = {};
    if (req.query.event) filter.event = req.query.event;
    if (req.query.outcome) filter.outcome = req.query.outcome;
    const [total, logs] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter)
        .populate('user', 'studentId fullName role')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);
    return res.json({
      success: true,
      page,
      limit,
      total,
      logs: logs.map((log) => ({
        id: log._id,
        event: log.event,
        outcome: log.outcome,
        at: log.createdAt,
        user: log.user
          ? { studentId: log.user.studentId, name: log.user.fullName, role: log.user.role }
          : null,
        details: log.details,
      })),
    });
  },
);

router.get(
  '/security/logs/export',
  ...administrators,
  validate([
    query('event').optional().trim().isLength({ max: 80 }),
    query('outcome').optional().isIn(['success', 'failure', 'info']),
  ]),
  async (req, res) => {
    const filter = {};
    if (req.query.event) filter.event = req.query.event;
    if (req.query.outcome) filter.outcome = req.query.outcome;
    const logs = await AuditLog.find(filter)
      .populate('user', 'studentId fullName role')
      .sort({ createdAt: -1 })
      .limit(10000)
      .lean();
    const lines = [
      ['Timestamp', 'Event', 'Outcome', 'Student ID', 'Name', 'Role', 'Details'],
      ...logs.map((log) => [
        log.createdAt.toISOString(),
        log.event,
        log.outcome,
        log.user?.studentId || '',
        log.user?.fullName || '',
        log.user?.role || '',
        JSON.stringify(log.details || {}),
      ]),
    ];
    await recordAudit(req, {
      user: req.user._id,
      event: 'SECURITY_LOG_EXPORT',
      outcome: 'success',
      details: { count: logs.length },
    });
    res.type('text/csv').attachment(`security-audit-${new Date().toISOString().slice(0, 10)}.csv`);
    return res.send(lines.map((row) => row.map(csvCell).join(',')).join('\n'));
  },
);

// ===== ANNOUNCEMENTS =====
router.post(
  '/announcements',
  ...administrators,
  validate([
    body('title').trim().isLength({ min: 3, max: 200 }),
    body('body').trim().isLength({ min: 3, max: 2000 }),
    body('priority').isIn(['high', 'medium', 'low']),
    body('targetRoles').isArray({ min: 1 }),
  ]),
  async (req, res) => {
    try {
      const ann = await Announcement.create({
        title: req.body.title.trim(),
        body: req.body.body.trim(),
        priority: req.body.priority,
        targetRoles: req.body.targetRoles,
        createdBy: req.user._id,
      });
      // Notify all targeted users
      const roleFilter = req.body.targetRoles.includes('all') ? {} : { role: { $in: req.body.targetRoles } };
      const users = await User.find(roleFilter).select('_id').lean();
      if (users.length) {
        await Notification.insertMany(
          users.map((u) => ({
            user: u._id,
            title: ann.title,
            body: ann.body.slice(0, 120),
            type: ann.priority === 'high' ? 'danger' : ann.priority === 'medium' ? 'warning' : 'info',
          })),
        );
      }
      await recordAudit(req, {
        user: req.user._id,
        event: 'ANNOUNCEMENT_CREATED',
        outcome: 'success',
        details: { announcementId: ann._id.toString() },
      });
      return res.status(201).json({ success: true, message: 'Announcement posted.', announcement: ann });
    } catch {
      return res.status(500).json({ success: false, message: 'Failed to create announcement.' });
    }
  },
);

router.delete(
  '/announcements/:id',
  ...administrators,
  validate([param('id').isMongoId()]),
  async (req, res) => {
    const result = await Announcement.deleteOne({ _id: req.params.id });
    if (!result.deletedCount)
      return res.status(404).json({ success: false, message: 'Announcement not found.' });
    return res.json({ success: true, message: 'Announcement deleted.' });
  },
);

// ===== COURSES =====
router.get('/courses', ...administrators, async (req, res) => {
  const courses = await Course.find().sort({ code: 1 }).lean();
  return res.json({ success: true, courses });
});

router.post(
  '/courses',
  ...administrators,
  validate([
    body('code').trim().isLength({ min: 2, max: 20 }),
    body('name').trim().isLength({ min: 3, max: 120 }),
    body('credits').isInt({ min: 1, max: 6 }).toInt(),
    body('instructor').trim().isLength({ min: 2, max: 100 }),
    body('schedule').trim().isLength({ min: 2, max: 100 }),
    body('room').trim().isLength({ min: 1, max: 50 }),
    body('department').trim().isLength({ min: 2, max: 80 }),
    body('semester').isInt({ min: 1, max: 12 }).toInt(),
  ]),
  async (req, res) => {
    try {
      const course = await Course.create({
        code: req.body.code.trim().toUpperCase(),
        name: req.body.name.trim(),
        credits: req.body.credits,
        instructor: req.body.instructor.trim(),
        schedule: req.body.schedule.trim(),
        room: req.body.room.trim(),
        department: req.body.department.trim(),
        semester: req.body.semester,
      });
      return res.status(201).json({ success: true, course });
    } catch (err) {
      if (err.code === 11000)
        return res.status(409).json({ success: false, message: 'Course code already exists.' });
      return res.status(500).json({ success: false, message: 'Failed to create course.' });
    }
  },
);

router.post(
  '/enrollments',
  ...administrators,
  validate([
    body('studentId').isMongoId(),
    body('courseId').isMongoId(),
    body('grade').optional().isString().isLength({ max: 3 }),
    body('attendancePresent').optional().isInt({ min: 0 }).toInt(),
    body('attendanceTotal').optional().isInt({ min: 0 }).toInt(),
  ]),
  async (req, res) => {
    try {
      const enrollment = await Enrollment.findOneAndUpdate(
        { student: req.body.studentId, course: req.body.courseId },
        {
          grade: req.body.grade || 'N/A',
          attendancePresent: req.body.attendancePresent || 0,
          attendanceTotal: req.body.attendanceTotal || 0,
        },
        { upsert: true, new: true },
      );
      return res.status(201).json({ success: true, enrollment });
    } catch {
      return res.status(500).json({ success: false, message: 'Failed to create enrollment.' });
    }
  },
);

module.exports = router;
