const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema(
  {
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: '', maxlength: 2000 },
    dueAt: { type: Date, required: true, index: true },
    maxPoints: { type: Number, min: 1, max: 1000, default: 100 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

assignmentSchema.index({ course: 1, dueAt: 1 });

module.exports = mongoose.model('Assignment', assignmentSchema);
