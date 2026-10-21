const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    name: { type: String, required: true },
    credits: { type: Number, required: true },
    instructor: { type: String, required: true },
    faculty: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    schedule: { type: String, required: true },
    room: { type: String, required: true },
    department: { type: String, required: true },
    semester: { type: Number, required: true },
    description: { type: String, default: '' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Course', courseSchema);
