const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, unique: true, uppercase: true },
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    department: { type: String, required: true },
    semester: { type: Number, required: true },
    // Self-registration always creates a student. Privileged roles are managed by an administrator.
    role: {
      type: String,
      enum: ['student', 'faculty', 'admin', 'security_admin'],
      default: 'student',
      index: true,
    },
    adminCreated: { type: Boolean, default: false, index: true },
    profileImage: { type: String, default: null },
    feeStatus: { type: String, enum: ['paid', 'partial', 'due'], default: 'paid' },
    outstandingBalance: { type: Number, min: 0, default: 0 },
    paymentDueAt: { type: Date, default: null },

    // OTP
    otpHash: { type: String, default: null, select: false },
    otpExpiry: { type: Date, default: null },
    otpAttempts: { type: Number, default: 0 },

    // Biometric
    // Legacy display flag. Public keys and counters are stored in WebAuthnCredential.
    biometricEnabled: { type: Boolean, default: false },

    // Security
    isVerified: { type: Boolean, default: false },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    lastLogin: { type: Date, default: null },
    mfaStep: {
      type: String,
      enum: ['none', 'otp_pending', 'biometric_pending', 'complete'],
      default: 'none',
    },
    lastLoginIpHash: { type: String, default: null },
    lastLoginUserAgent: { type: String, default: null },
    passwordChangedAt: { type: Date, default: null },
    recoveryCodeHashes: { type: [String], default: [], select: false },
    recoveryCodesGeneratedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};

module.exports = mongoose.model('User', userSchema);
