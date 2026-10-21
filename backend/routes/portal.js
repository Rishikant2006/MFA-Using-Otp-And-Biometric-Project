const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { body, param, validationResult } = require('express-validator');
const Enrollment = require('../models/Enrollment');
const Course = require('../models/Course');
const Announcement = require('../models/Announcement');
const Notification = require('../models/Notification');
const Assignment = require('../models/Assignment');
const { requireRole } = require('../middleware/auth');

const validate = (rules) => [
  ...rules,
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
      });
    next();
  },
];
const facultyOrAdmin = [protect, requireRole('faculty', 'admin', 'security_admin')];
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

router.get('/dashboard', protect, async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ student: req.user._id }).populate('course').lean();
    const announcements = await Announcement.find({
      $or: [{ targetRoles: req.user.role }, { targetRoles: 'all' }],
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const courses = enrollments.map((e) => ({
      id: e.course._id,
      code: e.course.code,
      name: e.course.name,
      credits: e.course.credits,
      instructor: e.course.instructor,
      schedule: e.course.schedule,
      room: e.course.room,
      grade: e.grade,
    }));

    const attendance = enrollments.map((e) => ({
      course: e.course.code,
      present: e.attendancePresent,
      total: e.attendanceTotal,
      percentage: e.attendanceTotal > 0 ? Math.round((e.attendancePresent / e.attendanceTotal) * 100) : 0,
    }));

    const totalCredits = enrollments.reduce((sum, e) => sum + (e.course.credits || 0), 0);
    const gradePoints = {
      'A+': 4.0,
      A: 4.0,
      'A-': 3.7,
      'B+': 3.3,
      B: 3.0,
      'B-': 2.7,
      'C+': 2.3,
      C: 2.0,
      D: 1.0,
      F: 0,
    };
    const gradedEnrollments = enrollments.filter((e) => gradePoints[e.grade] !== undefined);
    const cgpa = gradedEnrollments.length
      ? (
          gradedEnrollments.reduce((sum, e) => sum + gradePoints[e.grade] * e.course.credits, 0) /
          gradedEnrollments.reduce((sum, e) => sum + e.course.credits, 0)
        ).toFixed(2)
      : 'N/A';

    return res.json({
      success: true,
      data: {
        courses,
        announcements: announcements.map((a) => ({
          id: a._id,
          title: a.title,
          body: a.body,
          priority: a.priority,
          date: a.createdAt,
        })),
        attendance,
        stats: {
          cgpa,
          totalCredits,
          completedCredits: req.user.completedCredits || 0,
          semesterRank: req.user.semesterRank || 'N/A',
          totalStudents: req.user.totalStudents || 'N/A',
        },
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Failed to load dashboard.' });
  }
});

router.get('/courses', protect, async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ student: req.user._id }).populate('course').lean();
    return res.json({ success: true, data: enrollments.map((e) => ({ ...e.course, grade: e.grade })) });
  } catch {
    return res.status(500).json({ success: false, message: 'Failed to load courses.' });
  }
});

router.get('/academic', protect, async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ student: req.user._id }).populate('course').lean();
    const courseIds = enrollments.map((enrollment) => enrollment.course?._id).filter(Boolean);
    const assignments = await Assignment.find({ course: { $in: courseIds } })
      .populate('course', 'code name')
      .sort({ dueAt: 1 })
      .limit(20)
      .lean();
    return res.json({
      success: true,
      timetable: enrollments.map((enrollment) => ({
        code: enrollment.course.code,
        name: enrollment.course.name,
        schedule: enrollment.course.schedule,
        room: enrollment.course.room,
        instructor: enrollment.course.instructor,
      })),
      assignments: assignments.map((assignment) => ({
        id: assignment._id,
        title: assignment.title,
        description: assignment.description,
        dueAt: assignment.dueAt,
        maxPoints: assignment.maxPoints,
        course: assignment.course ? { code: assignment.course.code, name: assignment.course.name } : null,
      })),
      fees: {
        status: req.user.feeStatus,
        outstandingBalance: req.user.outstandingBalance,
        paymentDueAt: req.user.paymentDueAt,
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Failed to load academic information.' });
  }
});

router.get('/academic/grade-report', protect, async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ student: req.user._id }).populate('course').lean();
    const rows = [
      ['Student ID', req.user.studentId],
      ['Student name', req.user.fullName],
      ['Generated at', new Date().toISOString()],
      [],
      ['Course code', 'Course', 'Credits', 'Grade', 'Attendance'],
      ...enrollments.map((enrollment) => [
        enrollment.course.code,
        enrollment.course.name,
        enrollment.course.credits,
        enrollment.grade,
        enrollment.attendanceTotal ? `${enrollment.attendancePresent}/${enrollment.attendanceTotal}` : 'N/A',
      ]),
    ];
    res.type('text/csv').attachment(`grade-report-${req.user.studentId}.csv`);
    return res.send(rows.map((row) => row.map(csvCell).join(',')).join('\n'));
  } catch {
    return res.status(500).json({ success: false, message: 'Failed to prepare grade report.' });
  }
});

router.get('/attendance', protect, async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ student: req.user._id })
      .populate('course', 'code name')
      .lean();
    return res.json({
      success: true,
      data: enrollments.map((e) => ({
        course: e.course.code,
        name: e.course.name,
        present: e.attendancePresent,
        total: e.attendanceTotal,
        percentage: e.attendanceTotal > 0 ? Math.round((e.attendancePresent / e.attendanceTotal) * 100) : 0,
      })),
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Failed to load attendance.' });
  }
});

router.get('/announcements', protect, async (req, res) => {
  try {
    const announcements = await Announcement.find({
      $or: [{ targetRoles: req.user.role }, { targetRoles: 'all' }],
    })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, data: announcements });
  } catch {
    return res.status(500).json({ success: false, message: 'Failed to load announcements.' });
  }
});

// ===== NOTIFICATIONS =====
router.get('/notifications', protect, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    const unreadCount = await Notification.countDocuments({ user: req.user._id, read: false });
    return res.json({ success: true, notifications, unreadCount });
  } catch {
    return res.status(500).json({ success: false, message: 'Failed to load notifications.' });
  }
});

router.patch('/notifications/read-all', protect, async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user._id, read: false }, { $set: { read: true } });
    return res.json({ success: true, message: 'All notifications marked as read.' });
  } catch {
    return res.status(500).json({ success: false, message: 'Failed to update notifications.' });
  }
});

router.patch('/notifications/:id/read', protect, validate([param('id').isMongoId()]), async (req, res) => {
  try {
    await Notification.updateOne({ _id: req.params.id, user: req.user._id }, { $set: { read: true } });
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ success: false, message: 'Failed to update notification.' });
  }
});

// ===== PROFILE =====
router.patch(
  '/profile',
  protect,
  validate([
    body('fullName').optional().trim().isLength({ min: 2, max: 100 }),
    body('profileImage')
      .optional()
      .isString()
      .isLength({ max: 2 * 1024 * 1024 }),
  ]),
  async (req, res) => {
    try {
      const { fullName, profileImage } = req.body;
      if (fullName) req.user.fullName = fullName;
      if (profileImage !== undefined) {
        if (profileImage && !/^data:image\/(jpeg|png|webp|gif);base64,/.test(profileImage)) {
          return res
            .status(400)
            .json({ success: false, message: 'Invalid image format. Use JPEG, PNG, or WebP.' });
        }
        req.user.profileImage = profileImage || null;
      }
      await req.user.save();
      return res.json({
        success: true,
        message: 'Profile updated.',
        user: {
          fullName: req.user.fullName,
          profileImage: req.user.profileImage,
        },
      });
    } catch {
      return res.status(500).json({ success: false, message: 'Failed to update profile.' });
    }
  },
);

// ===== FACULTY WORKSPACE =====
router.get('/faculty/courses', ...facultyOrAdmin, async (req, res) => {
  try {
    const courseFilter = req.user.role === 'faculty' ? { faculty: req.user._id } : {};
    const courses = await Course.find(courseFilter).sort({ code: 1 }).lean();
    const courseIds = courses.map((course) => course._id);
    const enrollments = await Enrollment.find({ course: { $in: courseIds } })
      .populate('student', 'studentId fullName email')
      .lean();
    const rosters = courses.map((course) => ({
      ...course,
      students: enrollments
        .filter((enrollment) => enrollment.course.equals(course._id))
        .map((enrollment) => ({
          enrollmentId: enrollment._id,
          student: enrollment.student,
          grade: enrollment.grade,
          attendancePresent: enrollment.attendancePresent,
          attendanceTotal: enrollment.attendanceTotal,
        })),
    }));
    return res.json({ success: true, courses: rosters });
  } catch {
    return res.status(500).json({ success: false, message: 'Failed to load faculty courses.' });
  }
});

router.patch(
  '/faculty/enrollments/:id',
  ...facultyOrAdmin,
  validate([
    param('id').isMongoId(),
    body('grade').optional().isString().trim().isLength({ min: 1, max: 3 }),
    body('attendancePresent').optional().isInt({ min: 0 }).toInt(),
    body('attendanceTotal').optional().isInt({ min: 0 }).toInt(),
  ]),
  async (req, res) => {
    const enrollment = await Enrollment.findById(req.params.id).populate('course');
    if (!enrollment) return res.status(404).json({ success: false, message: 'Enrollment not found.' });
    if (req.user.role === 'faculty' && !enrollment.course.faculty?.equals(req.user._id)) {
      return res
        .status(403)
        .json({ success: false, message: 'You can only update students in your assigned courses.' });
    }
    if (req.body.grade !== undefined) enrollment.grade = req.body.grade;
    if (req.body.attendancePresent !== undefined) enrollment.attendancePresent = req.body.attendancePresent;
    if (req.body.attendanceTotal !== undefined) enrollment.attendanceTotal = req.body.attendanceTotal;
    if (enrollment.attendancePresent > enrollment.attendanceTotal) {
      return res
        .status(400)
        .json({ success: false, message: 'Attendance present cannot be higher than total classes.' });
    }
    await enrollment.save();
    return res.json({ success: true, message: 'Student record updated.' });
  },
);

router.post(
  '/faculty/assignments',
  ...facultyOrAdmin,
  validate([
    body('courseId').isMongoId(),
    body('title').trim().isLength({ min: 3, max: 160 }),
    body('description').optional().trim().isLength({ max: 2000 }),
    body('dueAt').isISO8601().toDate(),
    body('maxPoints').optional().isInt({ min: 1, max: 1000 }).toInt(),
  ]),
  async (req, res) => {
    const course = await Course.findById(req.body.courseId);
    if (!course) return res.status(404).json({ success: false, message: 'Course not found.' });
    if (req.user.role === 'faculty' && !course.faculty?.equals(req.user._id)) {
      return res
        .status(403)
        .json({ success: false, message: 'You can only create assignments for your assigned courses.' });
    }
    const assignment = await Assignment.create({
      course: course._id,
      title: req.body.title.trim(),
      description: req.body.description?.trim() || '',
      dueAt: req.body.dueAt,
      maxPoints: req.body.maxPoints || 100,
      createdBy: req.user._id,
    });
    return res.status(201).json({ success: true, assignment });
  },
);

module.exports = router;
