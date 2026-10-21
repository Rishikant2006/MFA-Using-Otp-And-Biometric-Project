require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Course = require('./models/Course');
const Enrollment = require('./models/Enrollment');
const Announcement = require('./models/Announcement');
const Notification = require('./models/Notification');
const Assignment = require('./models/Assignment');

const seed = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  await Promise.all([
    User.deleteMany({ studentId: { $in: ['ADM2024001', 'FAC2024001', 'STU2024001', 'STU2024002'] } }),
    Course.deleteMany({}),
    Announcement.deleteMany({}),
    Assignment.deleteMany({}),
  ]);

  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER || 'admin@iilm.edu';

  const [admin, faculty, student1, student2] = await User.create([
    {
      studentId: 'ADM2024001',
      fullName: 'Admin User',
      email: adminEmail,
      password: 'Admin@12345!',
      department: 'Administration',
      semester: 1,
      role: 'admin',
      adminCreated: true,
      isVerified: true,
    },
    {
      studentId: 'FAC2024001',
      fullName: 'Dr. Sara Ahmed',
      email: 'sara.ahmed@iilm.edu',
      password: 'Faculty@12345!',
      department: 'Computer Science',
      semester: 1,
      role: 'faculty',
      adminCreated: true,
      isVerified: true,
    },
    {
      studentId: 'STU2024001',
      fullName: 'Ali Hassan',
      email: 'ali.hassan@iilm.edu',
      password: 'Student@12345!',
      department: 'Computer Science',
      semester: 5,
      role: 'student',
      adminCreated: true,
      isVerified: true,
      feeStatus: 'partial',
      outstandingBalance: 12500,
      paymentDueAt: new Date('2026-11-15'),
    },
    {
      studentId: 'STU2024002',
      fullName: 'Fatima Noor',
      email: 'fatima.noor@iilm.edu',
      password: 'Student@12345!',
      department: 'Business Administration',
      semester: 3,
      role: 'student',
      adminCreated: true,
      isVerified: true,
      feeStatus: 'paid',
    },
  ]);

  const courses = await Course.create([
    {
      code: 'CS301',
      name: 'Data Structures & Algorithms',
      credits: 3,
      instructor: 'Dr. Ahmed Khan',
      schedule: 'Mon/Wed 10:00-11:30',
      room: 'CS-101',
      department: 'Computer Science',
      semester: 5,
    },
    {
      code: 'CS302',
      name: 'Database Management Systems',
      credits: 3,
      instructor: 'Dr. Sara Ahmed',
      faculty: faculty._id,
      schedule: 'Tue/Thu 09:00-10:30',
      room: 'CS-102',
      department: 'Computer Science',
      semester: 5,
    },
    {
      code: 'CS303',
      name: 'Computer Networks',
      credits: 3,
      instructor: 'Prof. Usman Malik',
      schedule: 'Mon/Wed 13:00-14:30',
      room: 'CS-103',
      department: 'Computer Science',
      semester: 5,
    },
    {
      code: 'MATH301',
      name: 'Discrete Mathematics',
      credits: 3,
      instructor: 'Dr. Fatima Noor',
      schedule: 'Fri 09:00-12:00',
      room: 'MATH-201',
      department: 'Computer Science',
      semester: 5,
    },
    {
      code: 'BA201',
      name: 'Principles of Management',
      credits: 3,
      instructor: 'Prof. Khalid Mehmood',
      schedule: 'Mon/Wed 11:00-12:30',
      room: 'BA-101',
      department: 'Business Administration',
      semester: 3,
    },
    {
      code: 'BA202',
      name: 'Business Communication',
      credits: 2,
      instructor: 'Dr. Ayesha Siddiqui',
      schedule: 'Tue/Thu 14:00-15:00',
      room: 'BA-102',
      department: 'Business Administration',
      semester: 3,
    },
  ]);

  await Enrollment.create([
    { student: student1._id, course: courses[0]._id, grade: 'A', attendancePresent: 22, attendanceTotal: 25 },
    {
      student: student1._id,
      course: courses[1]._id,
      grade: 'B+',
      attendancePresent: 20,
      attendanceTotal: 24,
    },
    {
      student: student1._id,
      course: courses[2]._id,
      grade: 'A-',
      attendancePresent: 23,
      attendanceTotal: 25,
    },
    { student: student1._id, course: courses[3]._id, grade: 'B', attendancePresent: 18, attendanceTotal: 22 },
    { student: student2._id, course: courses[4]._id, grade: 'A', attendancePresent: 19, attendanceTotal: 20 },
    {
      student: student2._id,
      course: courses[5]._id,
      grade: 'B+',
      attendancePresent: 15,
      attendanceTotal: 18,
    },
  ]);

  await Assignment.create([
    {
      course: courses[1]._id,
      title: 'Database Normalisation Case Study',
      description: 'Submit a normalised schema and a short design rationale.',
      dueAt: new Date('2026-11-05T17:00:00Z'),
      maxPoints: 50,
      createdBy: faculty._id,
    },
    {
      course: courses[0]._id,
      title: 'Graph Algorithms Lab',
      description: 'Implement BFS, DFS and Dijkstra with complexity notes.',
      dueAt: new Date('2026-11-12T17:00:00Z'),
      maxPoints: 40,
      createdBy: faculty._id,
    },
  ]);

  const announcements = await Announcement.create([
    {
      title: 'Mid-Term Examination Schedule Released',
      body: 'Mid-term exams will be held from Dec 20-27. Check the exam portal for your schedule and room assignments.',
      priority: 'high',
      targetRoles: ['all'],
      createdBy: admin._id,
    },
    {
      title: 'University Annual Sports Week',
      body: 'Annual sports week starts Dec 15. Register your team at the sports office by Dec 12.',
      priority: 'medium',
      targetRoles: ['student'],
      createdBy: admin._id,
    },
    {
      title: 'Library Extended Hours During Exams',
      body: 'Library will remain open 24/7 during exam week for student convenience.',
      priority: 'low',
      targetRoles: ['all'],
      createdBy: admin._id,
    },
    {
      title: 'Faculty Meeting — Department Heads',
      body: 'Mandatory faculty meeting on Dec 18 at 10:00 AM in Conference Room A.',
      priority: 'high',
      targetRoles: ['faculty', 'admin'],
      createdBy: admin._id,
    },
  ]);

  // Seed notifications for students
  await Notification.create([
    {
      user: student1._id,
      title: announcements[0].title,
      body: announcements[0].body.slice(0, 120),
      type: 'danger',
    },
    {
      user: student1._id,
      title: announcements[1].title,
      body: announcements[1].body.slice(0, 120),
      type: 'warning',
    },
    {
      user: student1._id,
      title: announcements[2].title,
      body: announcements[2].body.slice(0, 120),
      type: 'info',
    },
    {
      user: student2._id,
      title: announcements[0].title,
      body: announcements[0].body.slice(0, 120),
      type: 'danger',
    },
    {
      user: student2._id,
      title: announcements[1].title,
      body: announcements[1].body.slice(0, 120),
      type: 'warning',
    },
  ]);

  console.log('\n✅ Seed complete:');
  console.log('  Admin    → STU ID: ADM2024001 | Pass: Admin@12345!');
  console.log('  Faculty  → STU ID: FAC2024001 | Pass: Faculty@12345!');
  console.log('  Student1 → STU ID: STU2024001 | Pass: Student@12345!');
  console.log('  Student2 → STU ID: STU2024002 | Pass: Student@12345!');
  await mongoose.disconnect();
};

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
