const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    targetRoles: [{ type: String, enum: ['student', 'faculty', 'admin', 'security_admin', 'all'] }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

announcementSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);
