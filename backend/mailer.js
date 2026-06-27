/* ================================
   JAIFORE MAILER — Resend
   backend/mailer.js
   ================================ */
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

function generateOTP() { return Math.floor(1000 + Math.random() * 9000).toString(); }

/* ── helpers ── */
function formatCurrency(amount, currency = 'NGN') {
  const symbols = { NGN: '₦', USD: '$', GBP: '£', EUR: '€' };
  const sym = symbols[currency] || currency + ' ';
  return `${sym}${parseFloat(amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function formatItems(items) {
  if (!Array.isArray(items)) return '';
  return items.map(item => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e8e2d6;font-size:14px;color:#333;">
        ${item.name || 'Item'}${item.size ? ` <span style="color:#888;font-size:12px;">(${item.size})</span>` : ''}
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #e8e2d6;font-size:14px;color:#333;text-align:center;">
        ${item.quantity || 1}
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #e8e2d6;font-size:14px;color:#333;text-align:right;">
        ${item.price ? formatCurrency(item.price * (item.quantity || 1)) : '—'}
      </td>
    </tr>
  `).join('');
}

/* ── 1. OTP EMAIL ── */
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

/* ── 2. ADMIN NEW USER NOTIFICATION ── */
async function sendAdminNotification(newUser) {
  await resend.emails.send({
    from: 'Jaifore Media <onboarding@resend.dev>',
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

/* ── 3. ORDER CONFIRMATION (customer) ── */
async function sendOrderConfirmation(toEmail, name, order) {
  const items   = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
  const shipping = typeof order.shipping === 'string' ? JSON.parse(order.shipping) : order.shipping;
  const currency = order.currency || 'NGN';
  const orderId  = String(order.id).padStart(5, '0');

  await resend.emails.send({
    from: "Jai'fore Studio <onboarding@resend.dev>",
    to: toEmail,
    subject: `Order Confirmed — #JF${orderId}`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f0e8;font-family:'Helvetica Neue',Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px;">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #d8d0c4;">

      <!-- HEADER -->
      <tr><td style="padding:32px 40px 24px;border-bottom:2px solid #111;">
        <div style="font-family:Georgia,serif;font-size:24px;font-weight:900;color:#111;">Jai'fore</div>
        <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#7b5ea7;margin-top:4px;">Global Creative Studio</div>
      </td></tr>

      <!-- HERO -->
      <tr><td style="padding:32px 40px 20px;">
        <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#111;margin-bottom:8px;">Order Confirmed ✓</div>
        <p style="font-size:15px;color:#555;margin:0 0 4px;line-height:1.6;">Hi ${name},</p>
        <p style="font-size:15px;color:#555;margin:0;line-height:1.6;">
          Thank you for your order. We've received your payment and your order is now being processed.
        </p>
      </td></tr>

      <!-- ORDER META -->
      <tr><td style="padding:0 40px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;border:1px solid #d8d0c4;">
          <tr>
            <td style="padding:16px 20px;border-right:1px solid #d8d0c4;">
              <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#888;margin-bottom:4px;">Order ID</div>
              <div style="font-size:15px;font-weight:700;color:#111;">#JF${orderId}</div>
            </td>
            <td style="padding:16px 20px;border-right:1px solid #d8d0c4;">
              <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#888;margin-bottom:4px;">Date</div>
              <div style="font-size:15px;color:#111;">${new Date().toLocaleDateString('en-NG', { day:'numeric', month:'long', year:'numeric', timeZone:'Africa/Lagos' })}</div>
            </td>
            <td style="padding:16px 20px;">
              <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#888;margin-bottom:4px;">Status</div>
              <div style="font-size:13px;font-weight:700;color:#4a2d7a;text-transform:uppercase;letter-spacing:0.1em;">Processing</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- ITEMS TABLE -->
      <tr><td style="padding:0 40px 24px;">
        <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#888;margin-bottom:12px;">Items Ordered</div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <th style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#aaa;text-align:left;padding-bottom:8px;border-bottom:2px solid #111;">Product</th>
            <th style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#aaa;text-align:center;padding-bottom:8px;border-bottom:2px solid #111;">Qty</th>
            <th style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#aaa;text-align:right;padding-bottom:8px;border-bottom:2px solid #111;">Price</th>
          </tr>
          ${formatItems(items)}
        </table>
      </td></tr>

      <!-- TOTAL -->
      <tr><td style="padding:0 40px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${shipping?.cost ? `
          <tr>
            <td style="font-size:14px;color:#888;padding:6px 0;">Shipping</td>
            <td style="font-size:14px;color:#888;padding:6px 0;text-align:right;">${formatCurrency(shipping.cost, currency)}</td>
          </tr>` : ''}
          <tr>
            <td style="font-size:16px;font-weight:900;color:#111;padding:12px 0 0;border-top:2px solid #111;">Total Paid</td>
            <td style="font-size:16px;font-weight:900;color:#4a2d7a;padding:12px 0 0;border-top:2px solid #111;text-align:right;">${formatCurrency(order.total, currency)}</td>
          </tr>
        </table>
      </td></tr>

      <!-- SHIPPING ADDRESS -->
      ${shipping?.address ? `
      <tr><td style="padding:0 40px 28px;">
        <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#888;margin-bottom:8px;">Shipping To</div>
        <div style="font-size:14px;color:#555;line-height:1.8;">
          ${shipping.name || name}<br>
          ${shipping.address}<br>
          ${shipping.city ? shipping.city + (shipping.state ? ', ' + shipping.state : '') : ''}
          ${shipping.phone ? `<br>${shipping.phone}` : ''}
        </div>
      </td></tr>` : ''}

      <!-- FOOTER NOTE -->
      <tr><td style="padding:20px 40px;background:#f5f0e8;border-top:1px solid #d8d0c4;">
        <p style="font-size:13px;color:#888;margin:0 0 8px;line-height:1.6;">
          We'll send you another email when your order ships. Questions? Reply to this email or contact us at
          <a href="mailto:jaifore@outlook.com" style="color:#4a2d7a;text-decoration:none;">jaifore@outlook.com</a>.
        </p>
        <p style="font-size:12px;color:#aaa;margin:0;">© 2026 Jai'fore Creative Studio. Worldwide. By Design.</p>
      </td></tr>

    </table></td></tr></table></body></html>`
  });
}

/* ── 4. ADMIN NEW ORDER ALERT ── */
async function sendAdminOrderAlert(order, customerName, customerEmail) {
  const items    = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
  const shipping = typeof order.shipping === 'string' ? JSON.parse(order.shipping) : order.shipping;
  const currency = order.currency || 'NGN';
  const orderId  = String(order.id).padStart(5, '0');

  const itemSummary = Array.isArray(items)
    ? items.map(i => `${i.quantity || 1}× ${i.name || 'Item'}${i.size ? ` (${i.size})` : ''}`).join('<br>')
    : '—';

  await resend.emails.send({
    from: 'Jaifore Media <onboarding@resend.dev>',
    to: process.env.ADMIN_EMAIL,
    subject: `New Order #JF${orderId} — ${formatCurrency(order.total, currency)}`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px;">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#16161f;border:1px solid rgba(237,233,224,0.07);">

      <!-- HEADER -->
      <tr><td style="padding:28px 36px 20px;border-bottom:1px solid rgba(237,233,224,0.07);">
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:900;color:#ede9e0;">Jai'fore Admin</div>
        <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#9b7ec8;margin-top:4px;">New Order Alert</div>
      </td></tr>

      <!-- HERO -->
      <tr><td style="padding:28px 36px 20px;">
        <div style="font-family:Georgia,serif;font-size:28px;font-weight:900;color:#9b7ec8;">${formatCurrency(order.total, currency)}</div>
        <div style="font-size:13px;color:#555;margin-top:4px;">Order #JF${orderId} · ${new Date().toLocaleString('en-NG', { timeZone:'Africa/Lagos' })} WAT</div>
      </td></tr>

      <!-- DETAILS -->
      <tr><td style="padding:0 36px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0">

          <tr><td style="padding:12px 0;border-bottom:1px solid rgba(237,233,224,0.07);">
            <span style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#555;">Customer</span>
            <div style="font-size:15px;color:#ede9e0;font-weight:600;margin-top:4px;">${customerName}</div>
            <div style="font-size:13px;color:#777;margin-top:2px;">${customerEmail}</div>
          </td></tr>

          <tr><td style="padding:12px 0;border-bottom:1px solid rgba(237,233,224,0.07);">
            <span style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#555;">Items</span>
            <div style="font-size:14px;color:#ede9e0;margin-top:4px;line-height:1.8;">${itemSummary}</div>
          </td></tr>

          <tr><td style="padding:12px 0;border-bottom:1px solid rgba(237,233,224,0.07);">
            <span style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#555;">Payment</span>
            <div style="font-size:15px;color:#ede9e0;margin-top:4px;">${order.payment_method || 'card'} · Ref: ${order.payment_ref || '—'}</div>
          </td></tr>

          ${shipping?.address ? `
          <tr><td style="padding:12px 0;">
            <span style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#555;">Ship To</span>
            <div style="font-size:14px;color:#ede9e0;margin-top:4px;line-height:1.8;">
              ${shipping.address}${shipping.city ? ', ' + shipping.city : ''}${shipping.state ? ', ' + shipping.state : ''}
            </div>
          </td></tr>` : ''}

        </table>
      </td></tr>

      <!-- FOOTER -->
      <tr><td style="padding:16px 36px;border-top:1px solid rgba(237,233,224,0.07);">
        <p style="font-size:12px;color:#444;margin:0;">Jai'fore Admin Panel · Review this order in your dashboard.</p>
      </td></tr>

    </table></td></tr></table></body></html>`
  });
}

module.exports = { generateOTP, sendOTPEmail, sendAdminNotification, sendOrderConfirmation, sendAdminOrderAlert };