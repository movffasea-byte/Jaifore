/* ================================
   JAIFORE MAILER — Resend
   backend/mailer.js
   ================================ */
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

function generateOTP() { return Math.floor(1000 + Math.random() * 9000).toString(); }

async function sendOTPEmail(toEmail, name, otp) {
  await resend.emails.send({
    from: 'Jaifore Studio <onboarding@resend.dev>',
    to: toEmail,
    subject: `Your Jai'fore verification code: ${otp}`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f0e8;font-family:'Helvetica Neue',Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px;">
    <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #d8d0c4;">
    <tr><td style="padding:32px 40px 24px;border-bottom:2px solid #111;">
      <div style="font-family:Georgia,serif;font-size:24px;font-weight:900;color:#111;">Jai'fore</div>
      <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#7b5ea7;margin-top:4px;">Global Creative Studio</div>
    </td></tr>
    <tr><td style="padding:32px 40px;">
      <p style="font-size:15px;color:#555;margin:0 0 8px;">Hi ${name},</p>
      <p style="font-size:15px;color:#555;margin:0 0 32px;line-height:1.6;">Welcome to Jai'fore. Use the code below to verify your account. Expires in <strong>10 minutes</strong>.</p>
      <div style="text-align:center;margin:0 0 32px;">
        <div style="display:inline-block;background:#f5f0e8;border:2px solid #111;padding:20px 40px;">
          <span style="font-family:Georgia,serif;font-size:42px;font-weight:900;letter-spacing:0.15em;color:#4a2d7a;">${otp}</span>
        </div>
      </div>
      <p style="font-size:13px;color:#aaa;margin:0;line-height:1.6;">If you did not create an account, ignore this email.</p>
    </td></tr>
    <tr><td style="padding:20px 40px;border-top:1px solid #d8d0c4;">
      <p style="font-size:12px;color:#aaa;margin:0;">© 2026 Jai'fore Creative Studio. Worldwide. By Design.</p>
    </td></tr>
    </table></td></tr></table></body></html>`
  });
}

async function sendAdminNotification(newUser) {
  await resend.emails.send({
    from: 'Jaifore Studio <onboarding@resend.dev>',
    to: process.env.ADMIN_EMAIL,
    subject: `New Registration — ${newUser.name}`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px;">
    <table width="480" cellpadding="0" cellspacing="0" style="background:#16161f;border:1px solid rgba(237,233,224,0.07);">
    <tr><td style="padding:28px 36px 20px;border-bottom:1px solid rgba(237,233,224,0.07);">
      <div style="font-family:Georgia,serif;font-size:20px;font-weight:900;color:#ede9e0;">Jai'fore Admin</div>
      <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#9b7ec8;margin-top:4px;">New User Alert</div>
    </td></tr>
    <tr><td style="padding:28px 36px;">
      <p style="color:#888;font-size:13px;margin:0 0 20px;">A new user just registered:</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:10px 0;border-bottom:1px solid rgba(237,233,224,0.07);"><span style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#555;">Name</span><div style="font-size:15px;color:#ede9e0;font-weight:600;margin-top:4px;">${newUser.name}</div></td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid rgba(237,233,224,0.07);"><span style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#555;">Email</span><div style="font-size:15px;color:#ede9e0;margin-top:4px;">${newUser.email}</div></td></tr>
        <tr><td style="padding:10px 0;"><span style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#555;">Joined</span><div style="font-size:15px;color:#ede9e0;margin-top:4px;">${new Date().toLocaleString('en-NG',{timeZone:'Africa/Lagos'})} WAT</div></td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 36px;border-top:1px solid rgba(237,233,224,0.07);"><p style="font-size:12px;color:#444;margin:0;">Jai'fore Admin Panel</p></td></tr>
    </table></td></tr></table></body></html>`
  });
}

module.exports = { generateOTP, sendOTPEmail, sendAdminNotification };