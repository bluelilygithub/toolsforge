// Default email template content — used for DB seeding and fallback.
// Variables use {{variableName}} syntax, replaced at send time.

const DEFAULTS = {
  invitation: {
    slug: 'invitation',
    tool_slug: null,
    description: 'Sent when an admin invites a new user to the platform',
    variables: ['activationUrl', 'expiresAt'],
    subject: 'You have been invited to ToolsForge',
    body_text: [
      `You've been invited to join ToolsForge.`,
      ``,
      `Activate your account here (link expires in 48 hours):`,
      `{{activationUrl}}`,
      ``,
      `If you were not expecting this invitation, you can ignore this email.`,
    ].join('\n'),
    body_html: `<!DOCTYPE html>
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
            <a href="{{activationUrl}}" style="display:inline-block;background:#b45309;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;text-decoration:none;">
              Activate Account
            </a>
          </div>
          <p style="font-size:12px;color:#a3a3a3;margin:0;line-height:1.6;">
            Or copy this link:<br>
            <span style="word-break:break-all;color:#737373;">{{activationUrl}}</span>
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
</html>`,
  },

  password_reset: {
    slug: 'password_reset',
    tool_slug: null,
    description: 'Sent when a user requests a password reset',
    variables: ['resetUrl', 'email'],
    subject: 'Reset your ToolsForge password',
    body_text: [
      `You requested a password reset for your ToolsForge account.`,
      ``,
      `Reset your password here (link expires in 1 hour):`,
      `{{resetUrl}}`,
      ``,
      `If you did not request this, you can ignore this email. Your password will not change.`,
    ].join('\n'),
    body_html: `<!DOCTYPE html>
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
            We received a request to reset the password for your ToolsForge account (<strong>{{email}}</strong>).
            This link expires in <strong>1 hour</strong>.
          </p>
          <div style="text-align:center;margin-bottom:24px;">
            <a href="{{resetUrl}}" style="display:inline-block;background:#b45309;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;text-decoration:none;">
              Reset Password
            </a>
          </div>
          <p style="font-size:12px;color:#a3a3a3;margin:0;line-height:1.6;">
            Or copy this link:<br>
            <span style="word-break:break-all;color:#737373;">{{resetUrl}}</span>
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
</html>`,
  },
};

module.exports = DEFAULTS;
