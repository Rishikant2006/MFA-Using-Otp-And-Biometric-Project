const crypto = require('crypto');
const { isProduction } = require('../config/security');

const csrfCookieOptions = {
  httpOnly: false,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
};

const issueCsrfToken = (req, res) => {
  let token = req.cookies?.csrf_token;
  if (!token) {
    token = crypto.randomBytes(32).toString('base64url');
    res.cookie('csrf_token', token, csrfCookieOptions);
  }
  return token;
};

const requireCsrf = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.get('x-csrf-token');
  if (
    !cookieToken ||
    !headerToken ||
    cookieToken.length !== headerToken.length ||
    !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))
  ) {
    return res
      .status(403)
      .json({ success: false, message: 'Security validation failed. Refresh and try again.' });
  }
  next();
};

module.exports = { issueCsrfToken, requireCsrf, csrfCookieOptions };
