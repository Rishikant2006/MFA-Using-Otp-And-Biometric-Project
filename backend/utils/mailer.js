const nodemailer = require('nodemailer');
const crypto = require('crypto');

const generateOTP = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>'"]/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[char],
  );

const getTransporter = () => {
  const resendApiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'University Portal <onboarding@resend.dev>';
  if (resendApiKey) return { provider: 'resend', from, resendApiKey };
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS?.replace(/\s+/g, '');
  if (!user || user === 'your_gmail@gmail.com' || !pass || pass === 'your_16_char_app_password') {
    throw new Error('EMAIL_NOT_CONFIGURED');
  }
  return {
    provider: 'smtp',
    user,
    from: `"University Portal" <${user}>`,
    transporter: nodemailer.createTransport({ service: 'gmail', auth: { user, pass } }),
  };
};

const sendMail = async (message) => {
  const config = getTransporter();
  if (config.provider === 'resend') {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.from, ...message }),
    });
    if (!response.ok) throw new Error('EMAIL_DELIVERY_FAILED');
    return;
  }
  await config.transporter.sendMail({ from: config.from, ...message });
};

const sendOTPEmail = async (email, otp, fullName) => {
  const expiryMinutes = process.env.OTP_EXPIRY_MINUTES || 5;

  await sendMail({
    to: email,
    subject: '🔐 University Portal — Your OTP Verification Code',
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"></head>
      <body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 0;">
          <tr><td align="center">
            <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
              <tr>
                <td style="background:linear-gradient(135deg,#1a237e,#3949ab);padding:32px 40px;text-align:center;">
                  <div style="font-size:36px;margin-bottom:8px;">🎓</div>
                  <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;letter-spacing:1px;">UNIVERSITY PORTAL</h1>
                  <p style="color:#c5cae9;margin:6px 0 0;font-size:13px;">Multi-Factor Authentication</p>
                </td>
              </tr>
              <tr>
                <td style="padding:32px 40px;">
                  <p style="color:#37474f;font-size:15px;margin:0 0 8px;">Hello, <strong>${escapeHtml(fullName)}</strong></p>
                  <p style="color:#546e7a;font-size:13px;margin:0 0 24px;">Your One-Time Password for login verification:</p>
                  <div style="background:#e8eaf6;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
                    <span style="font-size:40px;font-weight:800;letter-spacing:14px;color:#1a237e;">${otp}</span>
                  </div>
                  <div style="background:#fff3e0;border-left:4px solid #ff9800;border-radius:4px;padding:12px 16px;margin-bottom:16px;">
                    <p style="margin:0;color:#e65100;font-size:13px;">⏱ Expires in <strong>${expiryMinutes} minutes</strong>. Do not share this code.</p>
                  </div>
                  <p style="color:#90a4ae;font-size:12px;margin:0;">If you did not request this, please contact IT support immediately.</p>
                </td>
              </tr>
              <tr>
                <td style="background:#f5f5f5;padding:16px 40px;text-align:center;border-top:1px solid #e0e0e0;">
                  <p style="color:#bdbdbd;font-size:11px;margin:0;">© ${new Date().getFullYear()} University Portal. All rights reserved.</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  });
};

const sendPasswordResetEmail = async (email, resetUrl, fullName) => {
  await sendMail({
    to: email,
    subject: 'University Portal — password reset request',
    text: `Hello ${fullName}, use this link to reset your password. It expires in 15 minutes: ${resetUrl}`,
    html: `<p>Hello, <strong>${escapeHtml(fullName)}</strong>.</p><p>A password reset was requested for your University Portal account.</p><p><a href="${escapeHtml(resetUrl)}">Reset your password</a></p><p>This link expires in 15 minutes. If you did not request it, you can ignore this email.</p>`,
  });
};

const sendVerificationEmail = async (email, verifyUrl, fullName) => {
  await sendMail({
    to: email,
    subject: 'University Portal — Verify your email address',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 0;"><tr><td align="center"><table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);"><tr><td style="background:linear-gradient(135deg,#1a237e,#3949ab);padding:32px 40px;text-align:center;"><div style="font-size:36px;margin-bottom:8px;">🎓</div><h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">UNIVERSITY PORTAL</h1><p style="color:#c5cae9;margin:6px 0 0;font-size:13px;">Email Verification</p></td></tr><tr><td style="padding:32px 40px;"><p style="color:#37474f;font-size:15px;margin:0 0 8px;">Hello, <strong>${escapeHtml(fullName)}</strong></p><p style="color:#546e7a;font-size:13px;margin:0 0 24px;">Please verify your email address to activate your account.</p><div style="text-align:center;margin-bottom:24px;"><a href="${escapeHtml(verifyUrl)}" style="background:linear-gradient(135deg,#1a237e,#3949ab);color:#fff;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;display:inline-block;">Verify Email Address</a></div><p style="color:#90a4ae;font-size:12px;margin:0;">This link expires in 24 hours. If you did not register, ignore this email.</p></td></tr><tr><td style="background:#f5f5f5;padding:16px 40px;text-align:center;border-top:1px solid #e0e0e0;"><p style="color:#bdbdbd;font-size:11px;margin:0;">© ${new Date().getFullYear()} University Portal. All rights reserved.</p></td></tr></table></td></tr></table></body></html>`,
  });
};

const sendSecurityAlertEmail = async (email, fullName, { title, message }) =>
  sendMail({
    to: email,
    subject: `University Portal security alert: ${title}`,
    text: `Hello ${fullName}, ${message} If this was not you, reset your password and contact University IT support immediately.`,
    html: `<p>Hello, <strong>${escapeHtml(fullName)}</strong>.</p><p><strong>${escapeHtml(title)}</strong></p><p>${escapeHtml(message)}</p><p>If this was not you, reset your password and contact University IT support immediately.</p>`,
  });

module.exports = {
  generateOTP,
  sendOTPEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendSecurityAlertEmail,
};
