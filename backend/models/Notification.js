const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    type: { type: String, enum: ['info', 'warning', 'success', 'danger'], default: 'info' },
    read: { type: Boolean, default: false, index: true },
    link: { type: String, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
