const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-longer-than-thirty-two-characters';
process.env.FRONTEND_URL = 'http://localhost:5500';

const { hashToken, isAllowedFrontendOrigin } = require('../config/security');
const { generateOTP } = require('../utils/mailer');
const { deviceNameFromUserAgent } = require('../utils/device');

test('hashToken is deterministic and does not reveal the token', () => {
  const token = 'sensitive-session-token';
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), token);
  assert.match(hashToken(token), /^[a-f0-9]{64}$/);
});

test('CORS permits the configured frontend but rejects unknown origins', () => {
  assert.equal(isAllowedFrontendOrigin('http://localhost:5500'), true);
  assert.equal(isAllowedFrontendOrigin('https://untrusted.example'), false);
});

test('OTP is always a six digit string', () => {
  for (let index = 0; index < 20; index += 1) assert.match(generateOTP(), /^\d{6}$/);
});

test('device labels avoid exposing the full user agent', () => {
  const label = deviceNameFromUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/120.0');
  assert.equal(label, 'Google Chrome on Windows device');
});
