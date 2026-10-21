const mongoose = require('mongoose');

const credentialSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    credentialID: { type: String, required: true, unique: true },
    publicKey: { type: Buffer, required: true, select: false },
    counter: { type: Number, required: true, default: 0 },
    transports: [{ type: String }],
    deviceType: { type: String, enum: ['singleDevice', 'multiDevice'], required: true },
    backedUp: { type: Boolean, default: false },
    aaguid: { type: String, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

credentialSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('WebAuthnCredential', credentialSchema);
