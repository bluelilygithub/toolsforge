const nodemailer = require('nodemailer');
const https = require('https');
const logger = require('../utils/logger');

const FROM_EMAIL = process.env.MAIL_FROM_EMAIL || 'noreply@curam-ai.com.au';
const FROM_NAME  = process.env.MAIL_FROM_NAME  || 'ToolsForge';

async function send({ to, subject, html, text }) {
  const apiKey = process.env.MAIL_CHANNEL_API_KEY;

  if (apiKey) {
    const from = `"${FROM_NAME}" <${FROM_EMAIL}>`;
    const payload = JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html',  value: html },
      ],
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.mailchannels.net',
          path: '/tx/v1/send',
          method: 'POST',
          headers: {
            'Content-Type':   'application/json',
            'X-Api-Key':      apiKey,
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve();
            else reject(new Error(`MailChannels error ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  // Fallback: SMTP via nodemailer
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    logger.warn('No email credentials configured — email not sent', { to });
    return;
  }

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.mailchannels.net',
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth:   { user, pass },
  });

  await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to,
    subject,
    text,
    html,
  });
}

const EmailService = {
  async sendInvitation(to, activationUrl) {
    const subject = 'You have been invited to ToolsForge';

    const text = [
      `You've been invited to join ToolsForge.`,
      ``,
      `Activate your account here (link expires in 48 hours):`,
      activationUrl,
      ``,
      `If you were not expecting this invitation, you can ignore this email.`,
    ].join('\n');

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;border:1px solid #e5e5e0;padding:40px;">
        <tr><td>
          <div style="text-align:center;margin-bottom:32px;">
            <div style="display:inline-block;width:48px;height:48px;background:#fafaf8;border:1px solid #e5e5e0;border-radius:12px;font-size:22px;line-height:48px;text-align:center;">⚒</div>
            <h1 style="margin:12px 0 4px;font-size:18px;font-weight:700;color:#1a1a1a;">ToolsForge</h1>
          </div>
          <h2 style="font-size:16px;font-weight:600;color:#1a1a1a;margin:0 0 8px;">You've been invited</h2>
          <p style="font-size:14px;color:#737373;margin:0 0 24px;line-height:1.6;">
            You've been invited to join ToolsForge. Click the button below to activate your account.
            This link expires in <strong>48 hours</strong>.
          </p>
          <div style="text-align:center;margin-bottom:24px;">
            <a href="${activationUrl}" style="display:inline-block;background:#b45309;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;text-decoration:none;">
              Activate Account
            </a>
          </div>
          <p style="font-size:12px;color:#a3a3a3;margin:0;line-height:1.6;">
            Or copy this link:<br>
            <span style="word-break:break-all;color:#737373;">${activationUrl}</span>
          </p>
          <hr style="border:none;border-top:1px solid #e5e5e0;margin:24px 0;">
          <p style="font-size:12px;color:#a3a3a3;margin:0;">
            If you were not expecting this invitation, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

    await send({ to, subject, text, html });
  },

  async sendPasswordReset(to, resetUrl) {
    const subject = 'Reset your ToolsForge password';

    const text = [
      `You requested a password reset for your ToolsForge account.`,
      ``,
      `Reset your password here (link expires in 1 hour):`,
      resetUrl,
      ``,
      `If you did not request this, you can ignore this email. Your password will not change.`,
    ].join('\n');

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;border:1px solid #e5e5e0;padding:40px;">
        <tr><td>
          <div style="text-align:center;margin-bottom:32px;">
            <div style="display:inline-block;width:48px;height:48px;background:#fafaf8;border:1px solid #e5e5e0;border-radius:12px;font-size:22px;line-height:48px;text-align:center;">⚒</div>
            <h1 style="margin:12px 0 4px;font-size:18px;font-weight:700;color:#1a1a1a;">ToolsForge</h1>
          </div>
          <h2 style="font-size:16px;font-weight:600;color:#1a1a1a;margin:0 0 8px;">Reset your password</h2>
          <p style="font-size:14px;color:#737373;margin:0 0 24px;line-height:1.6;">
            We received a request to reset the password for your ToolsForge account (<strong>${to}</strong>).
            This link expires in <strong>1 hour</strong>.
          </p>
          <div style="text-align:center;margin-bottom:24px;">
            <a href="${resetUrl}" style="display:inline-block;background:#b45309;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;text-decoration:none;">
              Reset Password
            </a>
          </div>
          <p style="font-size:12px;color:#a3a3a3;margin:0;line-height:1.6;">
            Or copy this link:<br>
            <span style="word-break:break-all;color:#737373;">${resetUrl}</span>
          </p>
          <hr style="border:none;border-top:1px solid #e5e5e0;margin:24px 0;">
          <p style="font-size:12px;color:#a3a3a3;margin:0;">
            If you did not request a password reset, you can safely ignore this email.
            Your password will not change.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

    await send({ to, subject, text, html });
  },
};

module.exports = EmailService;
