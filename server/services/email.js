const nodemailer = require('nodemailer');
const https = require('https');
const logger = require('../utils/logger');
const EmailTemplateService = require('./emailTemplates');

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
    const { subject, html, text } = await EmailTemplateService.render('invitation', { activationUrl });
    await send({ to, subject, html, text });
  },

  async sendPasswordReset(to, resetUrl) {
    const { subject, html, text } = await EmailTemplateService.render('password_reset', { resetUrl, email: to });
    await send({ to, subject, html, text });
  },
};

module.exports = { ...EmailService, send };
