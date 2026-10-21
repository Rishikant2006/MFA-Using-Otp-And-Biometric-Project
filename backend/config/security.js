const crypto = require('crypto');
const os = require('os');

const isProduction = process.env.NODE_ENV === 'production';
const frontendOrigins = (process.env.FRONTEND_URL || 'http://localhost:5500,http://127.0.0.1:5500')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const primaryOrigin = frontendOrigins[0];
const rpID = process.env.WEBAUTHN_RP_ID || new URL(primaryOrigin).hostname;
const localNetworkOrigin = Object.values(os.networkInterfaces())
  .flat()
  .find(
    (item) =>
      item &&
      item.family === 'IPv4' &&
      !item.internal &&
      (item.address.startsWith('10.') ||
        item.address.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(item.address)),
  )?.address;
const publicFrontendOrigin =
  process.env.FRONTEND_PUBLIC_URL ||
  (localNetworkOrigin ? `http://${localNetworkOrigin}:5500` : primaryOrigin);
const isAllowedFrontendOrigin = (origin) => {
  if (!origin || frontendOrigins.includes(origin)) return true;
  if (isProduction) return false;
  try {
    const { protocol, hostname } = new URL(origin);
    return (
      protocol === 'http:' &&
      (hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        /^10\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname) ||
        /^192\.168\.(?:\d{1,3}\.)\d{1,3}$/.test(hostname) ||
        /^172\.(?:1[6-9]|2\d|3[0-1])\.(?:\d{1,3}\.)\d{1,3}$/.test(hostname))
    );
  } catch {
    return false;
  }
};

const cookieBase = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
};

const hashToken = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hashIp = (ip = '') =>
  crypto
    .createHmac('sha256', process.env.IP_HASH_SECRET || process.env.JWT_SECRET)
    .update(ip)
    .digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

const requestId = () => crypto.randomUUID();

module.exports = {
  isProduction,
  frontendOrigins,
  isAllowedFrontendOrigin,
  primaryOrigin,
  publicFrontendOrigin,
  rpID,
  cookieBase,
  hashToken,
  hashIp,
  randomToken,
  requestId,
};
